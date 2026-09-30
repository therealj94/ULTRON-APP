const { randomBytes } = require('node:crypto');
exports.getRandomBytes = (n) => new Uint8Array(randomBytes(n));
