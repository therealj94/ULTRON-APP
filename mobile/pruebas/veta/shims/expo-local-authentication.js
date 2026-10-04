const st = globalThis.__la || (globalThis.__la = { hw: true, enrolado: true, tipos: [1] });
exports.AuthenticationType = { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 };
exports.hasHardwareAsync = async () => st.hw;
exports.isEnrolledAsync = async () => st.enrolado;
exports.supportedAuthenticationTypesAsync = async () => st.tipos;
