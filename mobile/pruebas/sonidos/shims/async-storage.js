'use strict';
const m = require('./mundo.js');
const AsyncStorage = {
  getItem: async (k) => (m.disco.has(k) ? m.disco.get(k) : null),
  setItem: async (k, v) => void m.disco.set(k, String(v)),
  removeItem: async (k) => void m.disco.delete(k),
};
module.exports = AsyncStorage;
module.exports.default = AsyncStorage;
