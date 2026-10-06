'use strict';
module.exports = {
  Platform: { OS: 'android', select: (o) => o.android ?? o.default },
  AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) },
};
