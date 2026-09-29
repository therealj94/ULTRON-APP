#!/usr/bin/env node
/**
 * El runtime (huella) de la APK Android de la variante en ULTRON_APP, calculado como lo calculan
 * Gradle al compilar y `eas update` al publicar. Se corre desde `mobile/`.
 *
 * Falla si la huella salió «ciega»: si `@expo/fingerprint` no logra cargar la configuración de
 * Expo (pasa cuando `@expo/env` no queda en la raíz de node_modules), calcula la huella SIN
 * app.config — sin paquete, permisos ni plugins— y las dos apps salen con la misma. Nada avisa.
 */
import { execFileSync } from 'node:child_process';

const salida = execFileSync('npx', ['expo-updates', 'runtimeversion:resolve', '--platform', 'android', '--debug'], {
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
});
const r = JSON.parse(salida);
if (!r.runtimeVersion) throw new Error('sin runtimeVersion: ¿falta `runtimeVersion` en app.json?');
if (!(r.fingerprintSources || []).some((s) => s.id === 'expoConfig')) {
  console.error('La huella no incluye app.config: no vería un cambio de permisos, plugins ni paquete. ¿Falta @expo/env en la raíz de node_modules?');
  process.exit(1);
}
process.stdout.write(r.runtimeVersion + '\n');
