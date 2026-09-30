// expo-av de mentira: el timbre y el tono de las llamadas «suenan» sin sonar.
module.exports = {
  Audio: {
    Sound: {
      createAsync: async () => ({ sound: { stopAsync: async () => {}, unloadAsync: async () => {} } }),
    },
  },
};
