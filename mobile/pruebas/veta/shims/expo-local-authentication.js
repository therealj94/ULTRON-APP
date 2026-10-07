// `nivel`: SecurityLevel del teléfono (0 = sin bloqueo de pantalla). `confirma`: lo que contesta el diálogo del sistema
// (true = huella/PIN correctos, false = cancelado). `pedidas` anota cada vez que se pidió.
const st = globalThis.__la || (globalThis.__la = { hw: true, enrolado: true, tipos: [1], nivel: 3, confirma: true, pedidas: [] });
exports.AuthenticationType = { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 };
exports.SecurityLevel = { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 };
exports.hasHardwareAsync = async () => st.hw;
exports.isEnrolledAsync = async () => st.enrolado;
exports.supportedAuthenticationTypesAsync = async () => st.tipos;
exports.getEnrolledLevelAsync = async () => (st.nivel === undefined ? 3 : st.nivel);
exports.authenticateAsync = async (o) => {
  (st.pedidas || (st.pedidas = [])).push(o || {});
  return st.confirma === false ? { success: false, error: 'user_cancel' } : { success: true };
};
