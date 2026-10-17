// The wire protocol lives at the repo root (shared/protocol.ts) so the server and the app compile against the same
// file. Metro only sees the project folder by default, so add it as a watch folder.
const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
config.watchFolders = [...(config.watchFolders ?? []), path.resolve(__dirname, "../shared")];
module.exports = config;
