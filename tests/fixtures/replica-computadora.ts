/**
 * UNA RÉPLICA del servidor para tests/computadora-replicas.test.ts (P5/A6): un proceso del sistema operativo con las
 * rutas REALES de la computadora (server/computadora.ts) y del panel de tareas (server/trabajos.ts), cableadas como en
 * server.ts, sobre un S3 condicional y un nodo de computadora SINTÉTICOS que viven en el proceso de la prueba.
 *
 * Nada sale de la máquina: S3 (*.amazonaws.com) va al S3 sintético (`FIXTURE_URL/s3/...`) y cualquier otro destino que
 * no sea localhost se rechaza. La sesión es sintética (cabecera `x-quien`); no se prueba aquí el login.
 *
 * Al arrancar imprime `READY {"port":…,"pid":…}`.
 */
import express from 'express';

const FIXTURE = String(process.env.FIXTURE_URL || '');
if (!FIXTURE) throw new Error('falta FIXTURE_URL');

const fetchRed = globalThis.fetch;
globalThis.fetch = (async (url: any, init: any) => {
  const u = new URL(String(url instanceof Request ? url.url : url));
  if (u.hostname.endsWith('.amazonaws.com')) return fetchRed(`${FIXTURE}/s3${u.pathname}${u.search}`, init);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error(`red externa prohibida en la prueba: ${u.hostname}`);
  return fetchRed(url, init);
}) as typeof fetch;

const pc: any = await import('../../server/computadora');
const tr: any = await import('../../server/trabajos');
const td: any = await import('../../lib/tareas-durables');

// Los tiempos del seguimiento, cortos para la prueba (el seguimiento y su lease son los de producción).
Object.assign(pc.TIEMPOS_SEGUIR, { sondeoMs: 250, silencioTrasTurnoMs: 0, reintentoMs: 100, leaseMs: 1500 });

const app = express();
app.use(express.json());
const pasa = (_q: any, _s: any, next: any) => next();
const sesionDe = (req: any) => (req.headers['x-quien'] ? { correo: String(req.headers['x-quien']), token: 'sesion-sintetica' } : null);

pc.montarRutasComputadora(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe, motorDe: async () => null });

/*
 * El adaptador del panel de tareas. Con P5 lo da server/computadora.ts (el mismo que usa server.ts). Antes de P5,
 * server.ts lo armaba con la memoria del proceso (historialDe + duenoDe): se reproduce igual para que la prueba falle
 * por el comportamiento y no por una importación.
 */
const computadora = pc.adaptadorTrabajos
  ? pc.adaptadorTrabajos()
  : {
      misiones: (correo: string) => pc.historialDe(correo),
      parar: async (correo: string, id: string) => {
        const h = pc.historialDe(correo).find((x: any) => x.id === id || x.tareaId === id);
        if (!h || pc.duenoDe(h.tareaId) !== correo) throw new Error('esa misión no es de esta persona (o ya no está)');
        return pc.pararTarea(h.tareaId);
      },
    };
tr.montarRutasTrabajos(app, { exigirMesa: pasa, limitar: () => pasa, sesionDe, computadora });

/** Solo la prueba: una tarea durable enlazada a una misión de la computadora (como la crea el chat). */
app.post('/prueba/enlazar', async (req: any, res: any) => {
  const correo = String(req.headers['x-quien'] || '');
  const r = await td.crearTarea(correo, {
    requestId: String(req.body.requestId),
    titulo: 'Tarea enlazada sintética',
    estado: 'running',
    entorno: { kind: 'computadora', id: String(req.body.id), displayName: 'Tu computadora' },
    origen: { kind: 'chat' },
    criterios: td.criteriosDeEncargo(String(req.body.instruccion || 'Revisa la página')),
    enlace: { tipo: 'computadora', id: String(req.body.id) },
  });
  res.status(r.ok ? 200 : 503).json(r);
});

const srv = app.listen(0, '127.0.0.1', () => console.log(`READY ${JSON.stringify({ port: (srv.address() as any).port, pid: process.pid })}`));
process.on('SIGTERM', () => process.exit(0));
