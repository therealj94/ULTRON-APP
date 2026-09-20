module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Sin plugin de worklets: la detección facial nativa está desactivada (ver CamaraVision.tsx).
    // Si se reactiva, vuelve aquí ['react-native-worklets-core/plugin'] (o el de react-native-worklets).
  };
};
