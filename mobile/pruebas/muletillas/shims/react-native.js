'use strict';
module.exports = {
  Platform: { OS: 'android', select: (o) => o.android ?? o.default },
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
  PermissionsAndroid: {
    PERMISSIONS: { RECORD_AUDIO: 'RECORD_AUDIO' },
    RESULTS: { GRANTED: 'granted' },
    request: async () => 'granted',
  },
};
