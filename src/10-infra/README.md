# 10 — Infra

- `sesionCliente.ts`: token de sesión firmada (`x-ultron-sesion`) en `localStorage`.
- `secretos.ts`: solo lectura de env; nunca claves en el cliente.
- CI: `.github/workflows/web.yml` (tests + tsc + build) y `android-apk.yml` (APK release por prebuild + Gradle, dispara en `main`, `cursor/**`, `claude/**`).
- `scripts/grabar-banco.ts`: graba los clips hablados con la voz de Voicebox (URL y llave en el entorno).
- Nodo Qwen `34.207.148.69:8443`: no se toca.
