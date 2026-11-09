// Tests del frontend: se sirve ../index.html en local; el API de Apps Script se intercepta en cada test.
const { defineConfig } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Si la versión de Playwright pide un Chromium que no está descargado, usa el que ya haya en la
// máquina (o el indicado en CHROMIUM_PATH) en vez de bajar uno nuevo.
function chromiumLocal() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const raiz = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright');
  try {
    for (const d of fs.readdirSync(raiz).filter(n => n.startsWith('chromium-')).sort().reverse()) {
      const exe = path.join(raiz, d, 'chrome-win64', 'chrome.exe');
      if (fs.existsSync(exe)) return exe;
    }
  } catch (e) { /* sin caché: Playwright usa el suyo */ }
  return undefined;
}

module.exports = defineConfig({
  testDir: '.',
  testMatch: /frontend\.spec\.js/,
  timeout: 20000,
  reporter: 'list',
  outputDir: 'test-results',
  use: {
    baseURL: 'http://localhost:4173', browserName: 'chromium', locale: 'es-UY',
    launchOptions: { executablePath: chromiumLocal() },
  },
  webServer: {
    command: 'node static-server.js',
    url: 'http://localhost:4173/',
    reuseExistingServer: true,
    timeout: 10000,
  },
});
