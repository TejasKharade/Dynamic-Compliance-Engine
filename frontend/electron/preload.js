// frontend/electron/preload.js
// Safe bridge between Electron and the web page (keep minimal)
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  platform: process.platform,
  isDesktop: true,
});