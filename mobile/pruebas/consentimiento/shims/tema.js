// ../nucleo/tema de mentira: una paleta fija y las medidas de la app (las de verdad leen Appearance de react-native).
const PALETA = {
  oscuro: true,
  fondo: '#1C1D20',
  superficie: '#2C2E32',
  borde: '#46484D',
  texto: '#ECE8E2',
  texto2: '#B9B2A8',
  texto3: '#A8A197',
  acento: '#D6B56C',
  acentoTexto: '#E0C27F',
  acentoFondo: '#3D3829',
  sobreAcento: '#1C1D20',
  aviso: '#D9825F',
  velo: 'rgba(0,0,0,0.5)',
};
const MEDIDA = {
  radio: { s: 10, m: 16, l: 24, xl: 32, redondo: 999 },
  espacio: { xs: 4, s: 8, m: 12, l: 16, xl: 24, xxl: 32 },
};
module.exports = { useTema: () => PALETA, MEDIDA };
