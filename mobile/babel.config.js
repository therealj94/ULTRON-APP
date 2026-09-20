module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    // Frame processors de react-native-vision-camera: transforma las funciones marcadas con 'worklet'.
    plugins: [['react-native-worklets-core/plugin']],
  };
};
