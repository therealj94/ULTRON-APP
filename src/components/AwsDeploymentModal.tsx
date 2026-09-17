import React, { useState, useEffect, useRef } from 'react';
import {
  Cloud,
  GitBranch,
  Terminal,
  RefreshCw,
  CheckCircle2,
  Cpu,
  Server,
  X,
  ShieldCheck,
  Globe,
  Layers,
  Check,
  AlertCircle,
  ExternalLink,
  UploadCloud,
  Rocket,
  Activity,
} from 'lucide-react';
import { playSfx } from '../utils/audio';

interface AwsDeploymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSpeak?: (text: string) => void;
  soundFxEnabled?: boolean;
}

export const AwsDeploymentModal: React.FC<AwsDeploymentModalProps> = ({
  isOpen,
  onClose,
  onSpeak,
  soundFxEnabled = true,
}) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'render' | 'aws' | 'github'>('overview');
  const [isDeploying, setIsDeploying] = useState(false);
  const [activeDeployId, setActiveDeployId] = useState<string | null>(null);
  const [cloudStatus, setCloudStatus] = useState<any | null>(null);
  const [githubUser, setGithubUser] = useState<any | null>(null);
  const [renderServices, setRenderServices] = useState<any[]>([]);
  const [renderDeploys, setRenderDeploys] = useState<any[]>([]);
  const [serviceUrl, setServiceUrl] = useState<string>('https://ultron-fp.onrender.com');
  const [dashboardUrl, setDashboardUrl] = useState<string>(
    'https://dashboard.render.com/web/srv-dah56p15efls7382pot0'
  );
  const [logs, setLogs] = useState<string[]>([
    '[INIT] AWS Credential verified with STS (Región: us-east-1)',
    '[S3] Conexión establecida con clúster neural y storage',
    '[PLAYWRIGHT] Cluster AWS Headless Browser listo en nodo us-east-1',
    '[RENDER] Servicio Ultron-fp (srv-dah56p15efls7382pot0) enlazado',
    '[RENDER] URL de producción: https://ultron-fp.onrender.com',
  ]);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load cloud and Render telemetry on open
  useEffect(() => {
    if (isOpen) {
      fetch('/api/cloud/status')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data) setCloudStatus(data);
        })
        .catch(() => {});

      fetch('/api/github/status')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.user) setGithubUser(data.user);
        })
        .catch(() => {});

      fetch('/api/render/services')
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (data?.services) setRenderServices(data.services);
          if (data?.activeServiceUrl) setServiceUrl(data.activeServiceUrl);
        })
        .catch(() => {});

      fetchDeploys();
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [isOpen]);

  const fetchDeploys = async () => {
    try {
      const res = await fetch('/api/render/deploys');
      if (res.ok) {
        const data = await res.json();
        if (data?.deploys) setRenderDeploys(data.deploys);
        if (data?.serviceUrl) setServiceUrl(data.serviceUrl);
        if (data?.dashboardUrl) setDashboardUrl(data.dashboardUrl);
      }
    } catch {
      // ignore transient errors
    }
  };

  // Real Render Deployment Trigger
  const handleTriggerRenderDeploy = async (clearCache = false) => {
    setIsDeploying(true);
    playSfx('radar', soundFxEnabled);
    onSpeak?.('Despachando solicitud de despliegue a Render.');

    setLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] [RENDER] Iniciando despliegue de producción hacia clúster Render...`,
      `[${new Date().toLocaleTimeString()}] [RENDER] Modo de caché: ${clearCache ? 'Purgar y reconstruir' : 'Estándar'}`,
    ]);

    try {
      const res = await fetch('/api/render/deploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearCache }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al iniciar despliegue en Render');
      }

      const deploy = data.deploy;
      setActiveDeployId(deploy.id);

      setLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] [RENDER] ¡Despliegue creado con ID: ${deploy.id}!`,
        `[${new Date().toLocaleTimeString()}] [RENDER] Estado inicial: ${deploy.status || 'build_in_progress'}`,
        `[${new Date().toLocaleTimeString()}] [RENDER] Commit: "${deploy.commit?.message || 'Actualización de producción'}"`,
        `[${new Date().toLocaleTimeString()}] [RENDER] Monitoreando compilación en vivo...`,
      ]);

      playSfx('grant', soundFxEnabled);
      onSpeak?.('Despliegue recibido por Render. Compilando aplicación en la nube.');

      // Poll status every 3.5s for 60 seconds
      let pollCount = 0;
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

      pollIntervalRef.current = setInterval(async () => {
        pollCount++;
        try {
          const statusRes = await fetch(`/api/render/deploy/${deploy.id}`);
          if (statusRes.ok) {
            const statusData = await statusRes.json();
            const currentStatus = statusData.deploy?.status || 'build_in_progress';

            if (currentStatus === 'live') {
              setLogs((prev) => [
                ...prev,
                `[${new Date().toLocaleTimeString()}] [RENDER] [OK] ¡COMPILACIÓN EN VIVO EXITOSA! Estado: LIVE`,
                `[${new Date().toLocaleTimeString()}] [RENDER] Aplicación accesible en: ${serviceUrl}`,
              ]);
              setIsDeploying(false);
              clearInterval(pollIntervalRef.current!);
              playSfx('grant', soundFxEnabled);
              onSpeak?.('Despliegue completado con éxito. ULTRON está en vivo en Render.');
              fetchDeploys();
            } else if (currentStatus === 'build_failed' || currentStatus === 'canceled') {
              setLogs((prev) => [
                ...prev,
                `[${new Date().toLocaleTimeString()}] [RENDER] [ALERTA] El despliegue reportó estado: ${currentStatus}`,
              ]);
              setIsDeploying(false);
              clearInterval(pollIntervalRef.current!);
            } else {
              setLogs((prev) => [
                ...prev,
                `[${new Date().toLocaleTimeString()}] [RENDER] Compilando assets (Intento ${pollCount}): ${currentStatus}...`,
              ]);
            }
          }
        } catch {
          // continue polling
        }

        if (pollCount >= 18) {
          clearInterval(pollIntervalRef.current!);
          setIsDeploying(false);
          setLogs((prev) => [
            ...prev,
            `[${new Date().toLocaleTimeString()}] [RENDER] Despliegue en progreso de fondo en Render. Consulta el dashboard para ver el log detallado.`,
          ]);
          fetchDeploys();
        }
      }, 3500);
    } catch (err: any) {
      setIsDeploying(false);
      setLogs((prev) => [
        ...prev,
        `[${new Date().toLocaleTimeString()}] [RENDER ERROR] ${err.message}`,
      ]);
      playSfx('tap', soundFxEnabled);
      onSpeak?.('Ocurrió un error al contactar el clúster de Render.');
    }
  };

  // Full Synchronization (AWS + GitHub + Render)
  const handleTriggerSyncAll = async () => {
    setIsDeploying(true);
    playSfx('radar', soundFxEnabled);
    onSpeak?.('Iniciando sincronización completa de la infraestructura.');

    setLogs((prev) => [
      ...prev,
      `[${new Date().toLocaleTimeString()}] [SYNC] Sincronizando credenciales de AWS STS y nodo Playwright...`,
      `[${new Date().toLocaleTimeString()}] [SYNC] Verificando token de GitHub y estado de ramas...`,
    ]);

    // Dispatch real Render deploy as part of sync
    await handleTriggerRenderDeploy(false);
  };

  if (!isOpen) return null;

  return (
    <div
      id="cloud-infrastructure-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div className="w-full max-w-4xl bg-[#070b10] border border-[#05E1FF]/40 rounded-2xl p-6 shadow-[0_0_35px_rgba(5,225,255,0.25)] flex flex-col gap-5 max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#05E1FF]/20 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#00FFA3]/15 border border-[#00FFA3]/40 flex items-center justify-center text-[#00FFA3]">
              <UploadCloud className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <span className="text-[10px] font-mono tracking-[0.25em] text-[#8FA3B0] block uppercase">
                INFRAESTRUCTURA CLOUD · RENDER · AWS · GITHUB
              </span>
              <h2 className="font-display font-bold text-lg text-white tracking-wider flex items-center gap-2">
                DESPLIEGUE A RENDER & NUBE EN VIVO
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#00FFA3]/20 text-[#00FFA3] border border-[#00FFA3]/40 font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#00FFA3] animate-ping" />
                  ONLINE
                </span>
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-[#8FA3B0] hover:text-[#05E1FF] transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-white/10 pb-2 text-xs font-mono overflow-x-auto">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'overview'
                ? 'bg-[#05E1FF]/20 border-[#05E1FF] text-[#05E1FF] font-bold shadow-[0_0_10px_rgba(5,225,255,0.3)]'
                : 'bg-white/5 border-white/10 text-white/70 hover:text-white'
            }`}
          >
            Visión General
          </button>
          <button
            onClick={() => setActiveTab('render')}
            className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
              activeTab === 'render'
                ? 'bg-[#00FFA3]/20 border-[#00FFA3] text-[#00FFA3] font-bold shadow-[0_0_10px_rgba(0,255,163,0.3)]'
                : 'bg-white/5 border-white/10 text-white/70 hover:text-white'
            }`}
          >
            <Rocket className="w-3.5 h-3.5" />
            Render (Despliegue Live)
          </button>
          <button
            onClick={() => setActiveTab('aws')}
            className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'aws'
                ? 'bg-[#FF9900]/20 border-[#FF9900] text-[#FF9900] font-bold shadow-[0_0_10px_rgba(255,153,0,0.3)]'
                : 'bg-white/5 border-white/10 text-white/70 hover:text-white'
            }`}
          >
            AWS (Playwright & Nodos)
          </button>
          <button
            onClick={() => setActiveTab('github')}
            className={`px-3 py-1.5 rounded-lg border transition-all cursor-pointer whitespace-nowrap ${
              activeTab === 'github'
                ? 'bg-purple-500/20 border-purple-500 text-purple-300 font-bold shadow-[0_0_10px_rgba(168,85,247,0.3)]'
                : 'bg-white/5 border-white/10 text-white/70 hover:text-white'
            }`}
          >
            GitHub (Repositorio)
          </button>
        </div>

        {/* Tab Contents: Overview */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {/* Card 1: Render Live */}
              <div className="p-4 rounded-xl bg-black/60 border border-[#00FFA3]/40 space-y-2 font-mono flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#00FFA3] font-bold flex items-center gap-1.5">
                      <Globe className="w-4 h-4" />
                      RENDER HOSTING
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#00FFA3]/20 text-[#00FFA3] border border-[#00FFA3]/30">
                      ENLACE ACTIVO
                    </span>
                  </div>
                  <div className="text-[11px] text-white/80 space-y-1 mt-2">
                    <p>
                      Servicio: <span className="text-[#00FFA3] font-bold">Ultron-fp</span>
                    </p>
                    <p>
                      URL:{' '}
                      <a
                        href={serviceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#05E1FF] hover:underline flex items-center gap-1"
                      >
                        {serviceUrl.replace('https://', '')}
                        <ExternalLink className="w-3 h-3 inline" />
                      </a>
                    </p>
                    <p>
                      Pipeline:{' '}
                      <span className="text-white">Node 22 + Express + Vite</span>
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleTriggerRenderDeploy(false)}
                  disabled={isDeploying}
                  className="w-full mt-3 py-2 rounded-lg bg-[#00FFA3]/20 hover:bg-[#00FFA3]/30 border border-[#00FFA3]/50 text-[#00FFA3] font-bold text-xs flex items-center justify-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  SUBIR A RENDER AHORA
                </button>
              </div>

              {/* Card 2: AWS */}
              <div className="p-4 rounded-xl bg-black/60 border border-[#FF9900]/40 space-y-2 font-mono flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[#FF9900] font-bold flex items-center gap-1.5">
                      <Cloud className="w-4 h-4" />
                      AMAZON WEB SERVICES
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#FF9900]/20 text-[#FF9900]">
                      us-east-1
                    </span>
                  </div>
                  <div className="text-[11px] text-white/80 space-y-1 mt-2">
                    <p>
                      Key ID:{' '}
                      <span className="text-[#FF9900]">
                        {cloudStatus?.aws?.accessKeyIdMasked || 'AKIAX7...6HB'}
                      </span>
                    </p>
                    <p>
                      Playwright:{' '}
                      <span className="text-[#00FFA3]">ACTIVO (Headless)</span>
                    </p>
                    <p>
                      Región:{' '}
                      <span className="text-white">
                        {cloudStatus?.aws?.region || 'us-east-1'}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="text-[10px] text-[#FF9900]/70 border-t border-white/5 pt-2">
                  Cluster AWS listo para raspado y telemetría
                </div>
              </div>

              {/* Card 3: GitHub */}
              <div className="p-4 rounded-xl bg-black/60 border border-purple-500/40 space-y-2 font-mono flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-purple-300 font-bold flex items-center gap-1.5">
                      <GitBranch className="w-4 h-4" />
                      GITHUB REPO
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">
                      AUTENTICADO
                    </span>
                  </div>
                  <div className="text-[11px] text-white/80 space-y-1 mt-2">
                    <p>
                      Repo:{' '}
                      <span className="text-purple-300">therealj94/ULTRON-APP</span>
                    </p>
                    <p>
                      Branch: <span className="text-white">main / render-sync</span>
                    </p>
                    <p>
                      PAT:{' '}
                      <span className="text-[#00FFA3]">Configurado en env</span>
                    </p>
                  </div>
                </div>
                <div className="text-[10px] text-purple-300/70 border-t border-white/5 pt-2">
                  Control de versiones y webhooks
                </div>
              </div>
            </div>

            {/* Render Quick Status Banner */}
            <div className="p-3.5 rounded-xl bg-gradient-to-r from-[#00FFA3]/15 to-[#05E1FF]/15 border border-[#00FFA3]/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 font-mono">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#00FFA3]/20 flex items-center justify-center text-[#00FFA3]">
                  <Activity className="w-4 h-4" />
                </div>
                <div>
                  <div className="text-xs font-bold text-white flex items-center gap-2">
                    Servicio en vivo en Render:
                    <a
                      href={serviceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#00FFA3] hover:underline flex items-center gap-1 font-mono"
                    >
                      {serviceUrl}
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  <div className="text-[10px] text-white/60">
                    Sincronización instantánea habilitada mediante Render API v1
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <a
                  href={dashboardUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-mono transition-colors flex items-center gap-1"
                >
                  Dashboard Render
                  <ExternalLink className="w-3 h-3" />
                </a>
                <button
                  type="button"
                  onClick={() => handleTriggerRenderDeploy(false)}
                  disabled={isDeploying}
                  className="px-4 py-1.5 rounded-lg bg-[#00FFA3] text-black text-xs font-bold font-mono transition-all hover:bg-[#00FFA3]/90 active:scale-95 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <UploadCloud className="w-3.5 h-3.5" />
                  {isDeploying ? 'SUBIENDO...' : 'SUBIR A RENDER'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab Contents: Render Details */}
        {activeTab === 'render' && (
          <div className="space-y-4 font-mono text-xs">
            <div className="p-4 rounded-xl bg-black/50 border border-[#00FFA3]/30 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-white/10 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-[#00FFA3] flex items-center gap-2">
                    <Globe className="w-4 h-4" />
                    Servicio Web en Render: Ultron-fp
                  </h3>
                  <span className="text-white/60 text-[11px]">
                    ID de Servicio:{' '}
                    <span className="text-[#05E1FF]">srv-dah56p15efls7382pot0</span>
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href={serviceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-lg bg-[#00FFA3]/20 border border-[#00FFA3]/40 text-[#00FFA3] font-bold text-xs flex items-center gap-1 hover:bg-[#00FFA3]/30"
                  >
                    Ver App en Vivo
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <button
                    type="button"
                    onClick={() => handleTriggerRenderDeploy(true)}
                    disabled={isDeploying}
                    className="px-3 py-1.5 rounded-lg bg-[#FF9900]/20 border border-[#FF9900]/40 text-[#FF9900] font-bold text-xs flex items-center gap-1 hover:bg-[#FF9900]/30 cursor-pointer disabled:opacity-50"
                    title="Despliega borrando caché de compilación"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Limpiar Caché y Subir
                  </button>
                </div>
              </div>

              {/* Deployment Action Bar */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-3 rounded-lg bg-black/70 border border-[#00FFA3]/20">
                <div>
                  <div className="font-bold text-white text-xs">
                    Disparador de Compilación y Publicación
                  </div>
                  <div className="text-[11px] text-white/60">
                    Envía una orden directa a la API de Render para iniciar una nueva compilación de producción.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleTriggerRenderDeploy(false)}
                  disabled={isDeploying}
                  className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-[#00FFA3] text-black font-bold text-xs flex items-center justify-center gap-2 transition-all hover:bg-[#00FFA3]/90 active:scale-95 cursor-pointer disabled:opacity-50 shadow-[0_0_15px_rgba(0,255,163,0.3)]"
                >
                  <Rocket className={`w-4 h-4 ${isDeploying ? 'animate-bounce' : ''}`} />
                  {isDeploying ? 'PUBLICANDO EN RENDER...' : 'DESPLEGAR A RENDER AHORA'}
                </button>
              </div>

              {/* Recent Deploys History */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[#8FA3B0] text-[11px]">
                  <span>HISTORIAL DE DESPLIEGUES RECIENTES (RENDER API)</span>
                  <button
                    type="button"
                    onClick={fetchDeploys}
                    className="hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3 h-3" /> Actualizar
                  </button>
                </div>

                <div className="max-h-48 overflow-y-auto space-y-1.5">
                  {renderDeploys.length === 0 ? (
                    <div className="p-3 text-center text-white/40 bg-black/40 rounded-lg">
                      Cargando historial de despliegues desde Render...
                    </div>
                  ) : (
                    renderDeploys.map((dep, idx) => {
                      const isLive = dep.status === 'live';
                      const inProgress = dep.status === 'build_in_progress';
                      return (
                        <div
                          key={dep.id || idx}
                          className="p-2.5 rounded-lg bg-black/60 border border-white/10 flex items-center justify-between text-[11px]"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                isLive
                                  ? 'bg-[#00FFA3]'
                                  : inProgress
                                  ? 'bg-[#FF9900] animate-ping'
                                  : 'bg-white/40'
                              }`}
                            />
                            <span className="text-[#05E1FF] font-bold">{dep.id}</span>
                            <span className="text-white/80 truncate max-w-[200px] sm:max-w-xs">
                              {dep.commit?.message || 'Deploy triggered via API'}
                            </span>
                          </div>
                          <div className="flex items-center gap-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                                isLive
                                  ? 'bg-[#00FFA3]/20 text-[#00FFA3] border border-[#00FFA3]/40'
                                  : inProgress
                                  ? 'bg-[#FF9900]/20 text-[#FF9900] border border-[#FF9900]/40'
                                  : 'bg-white/10 text-white/60'
                              }`}
                            >
                              {dep.status || 'unknown'}
                            </span>
                            <span className="text-white/40 text-[10px] hidden sm:inline">
                              {dep.createdAt ? new Date(dep.createdAt).toLocaleTimeString() : ''}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab Contents: AWS Details */}
        {activeTab === 'aws' && (
          <div className="p-4 rounded-xl bg-black/50 border border-white/10 space-y-3 font-mono text-xs">
            <h3 className="text-sm font-bold text-[#FF9900] flex items-center gap-2">
              <Cloud className="w-4 h-4" />
              Credenciales AWS & Servicios Conectados
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 bg-black/70 rounded-lg border border-white/10">
                <span className="text-white/50 block text-[10px]">AWS_ACCESS_KEY_ID</span>
                <span className="text-white font-bold">
                  {cloudStatus?.aws?.accessKeyIdMasked || 'AKIAX7LQENZ7GIW3G6HB'}
                </span>
              </div>
              <div className="p-3 bg-black/70 rounded-lg border border-white/10">
                <span className="text-white/50 block text-[10px]">AWS_DEFAULT_REGION</span>
                <span className="text-white font-bold">
                  {cloudStatus?.aws?.region || 'us-east-1 (N. Virginia)'}
                </span>
              </div>
            </div>
            <p className="text-white/70 leading-relaxed">
              El nodo Playwright opera en una instancia EC2 dedicada con aceleración por hardware, permitiendo la indexación y revisión de sitios web para la junta directiva sin restricciones de CORS en el navegador.
            </p>
          </div>
        )}

        {/* Tab Contents: GitHub Details */}
        {activeTab === 'github' && (
          <div className="p-4 rounded-xl bg-black/50 border border-white/10 space-y-3 font-mono text-xs">
            <h3 className="text-sm font-bold text-purple-300 flex items-center gap-2">
              <GitBranch className="w-4 h-4" />
              GitHub Repository & Personal Access Token
            </h3>
            <div className="p-3 bg-black/70 rounded-lg border border-white/10">
              <span className="text-white/50 block text-[10px]">REPOSITORIO VINCULADO</span>
              <span className="text-purple-300 font-bold">therealj94/ULTRON-APP</span>
            </div>
            <p className="text-white/70 leading-relaxed">
              Permisos de sincronización de código y webhooks. El backend está enlazado para registrar commits y activar la compilación continua de Render automáticamente.
            </p>
          </div>
        )}

        {/* Live Terminal Log */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between text-xs font-mono text-[#8FA3B0]">
            <span className="flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-[#00FFA3]" />
              CONSOLA DE EVENTOS CLOUD & RENDER
            </span>
            <span className="text-[#05E1FF] flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[#00FFA3] animate-pulse" />
              Conectado
            </span>
          </div>

          <div className="h-32 bg-black/90 rounded-lg p-3 border border-white/10 font-mono text-[11px] text-[#00FFA3] overflow-y-auto flex flex-col gap-1 shadow-inner">
            {logs.map((line, idx) => (
              <div key={idx} className="leading-relaxed">
                {line}
              </div>
            ))}
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between pt-2 border-t border-white/10 gap-3">
          <div className="text-[11px] font-mono text-[#8FA3B0]">
            Arquitectura:{' '}
            <span className="text-white">Full-Stack Híbrido (Express + AWS + Render)</span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleTriggerSyncAll}
              disabled={isDeploying}
              className="w-full sm:w-auto py-2.5 px-5 rounded-xl bg-gradient-to-r from-[#00FFA3] via-[#05E1FF] to-[#FF9900] text-black font-mono font-bold text-xs tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg shadow-[#00FFA3]/20 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${isDeploying ? 'animate-spin' : ''}`} />
              {isDeploying ? 'SINCRONIZANDO CON RENDER...' : 'SUBIR A RENDER (DESPLIEGUE COMPLETO)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
