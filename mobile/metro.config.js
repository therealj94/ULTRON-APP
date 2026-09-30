/**
 * Metro de siempre (el de Expo) más una sola cosa: los modelos 3D (.glb) se empaquetan como archivos,
 * igual que las fotos y los sonidos. Los lleva el avatar 3D de AURA (src/avatar3d, assets/avatar3d/).
 * Sin esto, `require('…/aura.glb')` no se resuelve.
 */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts = [...new Set([...config.resolver.assetExts, 'glb'])];

module.exports = config;
