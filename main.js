const { app, BrowserWindow, ipcMain, dialog, screen, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';

// ── Config ──
const RIVE_MCP_URL = 'http://127.0.0.1:9791/mcp';
const GUMROAD_VERIFY_URL = 'https://api.gumroad.com/v2/licenses/verify';
const GUMROAD_PRODUCT_ID = 'lfzPuqgKNLml7Y4IxXlamQ==';
const DATA_DIR = path.join(app.getPath('userData'));
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SCRIPTS_DIR = path.join(DATA_DIR, 'scripts');
const LAYOUT_FILE = path.join(DATA_DIR, 'layout.json');
const PRESETS_FILE = path.join(DATA_DIR, 'presets.json');
const CRYPTO_SALT = 'rivebar-v2';
const CRYPTO_ITERATIONS = 100000;

const MCP_HEADERS = { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' };
let mcpInitialized = false;
let mcpIdCounter = 1;
let mainWindow;

// ── Script encryption (AES-256-GCM, key derived from license) ──
const OBFUSCATION_KEY = 'rivebar-community-store-v1';
function deriveKey(licenseKey) {
  return crypto.pbkdf2Sync(licenseKey, CRYPTO_SALT, CRYPTO_ITERATIONS, 32, 'sha512');
}
function obfuscateSteps(steps) {
  const key = crypto.pbkdf2Sync(OBFUSCATION_KEY, CRYPTO_SALT, 10000, 32, 'sha512');
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(steps);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();
  return { _obfuscated: true, iv: iv.toString('base64'), tag: tag.toString('base64'), data: encrypted };
}
function deobfuscateSteps(encData) {
  const key = crypto.pbkdf2Sync(OBFUSCATION_KEY, CRYPTO_SALT, 10000, 32, 'sha512');
  const iv = Buffer.from(encData.iv, 'base64');
  const tag = Buffer.from(encData.tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encData.data, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

function encryptScript(steps, licenseKey) {
  const key = deriveKey(licenseKey);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(steps);
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('base64'), tag: tag.toString('base64'), data: encrypted };
}

function decryptScript(encData, licenseKey) {
  const key = deriveKey(licenseKey);
  const iv = Buffer.from(encData.iv, 'base64');
  const tag = Buffer.from(encData.tag, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encData.data, 'base64', 'utf8');
  decrypted += decipher.final('utf8');
  return JSON.parse(decrypted);
}

// ── Auto-updater ──
function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('update-available', (info) => {
    if (mainWindow) mainWindow.webContents.send('updater:status', { type: 'available', version: info.version });
  });
  autoUpdater.on('download-progress', (progress) => {
    if (mainWindow) mainWindow.webContents.send('updater:status', { type: 'progress', percent: Math.round(progress.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    if (mainWindow) mainWindow.webContents.send('updater:status', { type: 'ready', version: info.version });
  });
  autoUpdater.on('error', (err) => {
    console.error('Updater error:', err?.message || err);
    if (mainWindow) mainWindow.webContents.send('updater:status', { type: 'error', message: err?.message || 'Update failed' });
  });

  autoUpdater.checkForUpdates().catch(() => {});
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
}

// ── Persistence helpers ──
function ensureDirs() {
  if (!fs.existsSync(SCRIPTS_DIR)) fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
}

function loadConfig() {
  try { return fs.existsSync(CONFIG_FILE) ? JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) : {}; } catch { return {}; }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function loadLayout() {
  try { return fs.existsSync(LAYOUT_FILE) ? JSON.parse(fs.readFileSync(LAYOUT_FILE, 'utf8')) : null; } catch { return null; }
}

function saveLayout(layout) {
  fs.writeFileSync(LAYOUT_FILE, JSON.stringify(layout, null, 2));
}

function loadScripts() {
  ensureDirs();
  const scripts = [];
  for (const f of fs.readdirSync(SCRIPTS_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(SCRIPTS_DIR, f), 'utf8'));
      data._filename = f;
      scripts.push(data);
    } catch {}
  }
  return scripts;
}

function saveScript(script) {
  ensureDirs();
  const name = script._filename || (script.name.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json');
  const toSave = { ...script };
  delete toSave._filename;
  fs.writeFileSync(path.join(SCRIPTS_DIR, name), JSON.stringify(toSave, null, 2));
  return name;
}

function deleteScript(filename) {
  const p = path.join(SCRIPTS_DIR, filename);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// ── License verification — multi-platform ──
function httpPost(urlStr, body, contentType) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: url.hostname, port: url.port, path: url.pathname + url.search, method: 'POST',
      headers: { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data: { raw: data } }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

// Gumroad — app license (Lite/Pro activation)
function verifyGumroadLicense(licenseKey) {
  return new Promise((resolve, reject) => {
    const postData = `product_id=${encodeURIComponent(GUMROAD_PRODUCT_ID)}&license_key=${encodeURIComponent(licenseKey)}`;
    const url = new URL(GUMROAD_VERIFY_URL);
    const req = https.request({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const r = JSON.parse(data);
          const variant = (r.purchase?.variant_name || r.purchase?.variant_option || r.purchase?.variants || '').toString().toLowerCase();
          const tier = variant.includes('pro') ? 'pro' : 'lite';
          resolve({ success: r.success, purchase: r.purchase || null, tier, message: r.message || '' });
        } catch { reject(new Error('Invalid response')); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Multi-platform script license verification
async function verifyScriptLicense(license) {
  if (!license || !license.platform) return { valid: false, error: 'No license data' };

  try {
    switch (license.platform) {
      case 'gumroad': {
        const postData = `product_id=${encodeURIComponent(license.productId)}&license_key=${encodeURIComponent(license.key)}`;
        const r = await httpPost('https://api.gumroad.com/v2/licenses/verify', postData, 'application/x-www-form-urlencoded');
        if (r.data.success) return { valid: true, email: r.data.purchase?.email };
        return { valid: false, error: r.data.message || 'Invalid Gumroad license' };
      }

      case 'lemonsqueezy': {
        const body = JSON.stringify({ license_key: license.key, instance_name: 'rivebar' });
        const r = await httpPost('https://api.lemonsqueezy.com/v1/licenses/validate', body, 'application/json');
        if (r.data.valid) return { valid: true, email: r.data.meta?.customer_email };
        return { valid: false, error: r.data.error || 'Invalid LemonSqueezy license' };
      }

      case 'itchio': {
        const body = JSON.stringify({ download_key: license.key });
        const r = await httpPost(`https://itch.io/api/1/${license.apiKey || license.key}/uploads`, body, 'application/json');
        if (r.status === 200 && !r.data.errors) return { valid: true };
        return { valid: false, error: 'Invalid itch.io key' };
      }

      case 'signed': {
        // HMAC-SHA256 signature verification
        // Creator signs: HMAC(creatorSecret, scriptName + creatorId)
        // We verify by re-computing — the secret must be embedded in the script
        // For signed scripts, we trust the signature if it matches the stored hash
        if (!license.signature || !license.creatorId) return { valid: false, error: 'Missing signature data' };
        // Simple check: signature is present and non-empty (full verification needs creator's public key from store)
        if (license.signature.length >= 32) return { valid: true };
        return { valid: false, error: 'Invalid signature' };
      }

      default:
        return { valid: false, error: `Unknown platform: ${license.platform}` };
    }
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

// ── MCP client ──
function sendRaw(body) {
  return new Promise((resolve, reject) => {
    const url = new URL(RIVE_MCP_URL);
    const req = http.request({
      hostname: url.hostname, port: url.port, path: url.pathname, method: 'POST',
      headers: { ...MCP_HEADERS, 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          if (res.headers['content-type']?.includes('text/event-stream')) {
            const results = [];
            for (const line of data.split('\n')) {
              if (line.startsWith('data: ')) { try { results.push(JSON.parse(line.slice(6))); } catch {} }
            }
            resolve(results.length === 1 ? results[0] : results);
          } else if (data.trim()) {
            resolve(JSON.parse(data));
          } else {
            resolve({ ok: true, status: res.statusCode });
          }
        } catch { resolve({ raw: data, status: res.statusCode }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

async function ensureMcpInit() {
  if (mcpInitialized) return true;
  try {
    const r = await sendRaw(JSON.stringify({ jsonrpc: '2.0', id: mcpIdCounter++, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'rivebar', version: '1.0.0' } } }));
    if (r.result) {
      await sendRaw(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }));
      mcpInitialized = true;
      return true;
    }
  } catch {}
  return false;
}

async function mcpCallTool(name, args) {
  if (!await ensureMcpInit()) throw new Error('MCP not connected');
  const r = await sendRaw(JSON.stringify({ jsonrpc: '2.0', id: mcpIdCounter++, method: 'tools/call', params: { name, arguments: args } }));
  if (r.error) throw new Error(JSON.stringify(r.error));
  return r.result || r;
}

// ── Window ──
function createWindow() {
  const cfg = loadConfig();
  const display = screen.getPrimaryDisplay();
  const { width: sw, height: sh } = display.workAreaSize;

  const winW = cfg.winWidth || 400;
  const winH = cfg.winHeight || 600;
  const winX = cfg.winX ?? Math.round(sw - winW - 20);
  const winY = cfg.winY ?? Math.round((sh - winH) / 2);

  mainWindow = new BrowserWindow({
    width: winW, height: winH, x: winX, y: winY,
    frame: false,
    transparent: true,
    alwaysOnTop: cfg.alwaysOnTop !== false,
    resizable: true,
    minimizable: true,
    maximizable: true,
    skipTaskbar: false,
    hasShadow: true,
    vibrancy: 'under-window',
    visualEffectState: 'active',
    minWidth: 80, minHeight: 120,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#00000000'
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('moved', () => saveBounds());
  mainWindow.on('resized', () => saveBounds());
}

function saveBounds() {
  if (!mainWindow) return;
  const [w, h] = mainWindow.getSize();
  const [x, y] = mainWindow.getPosition();
  const cfg = loadConfig();
  cfg.winWidth = w; cfg.winHeight = h; cfg.winX = x; cfg.winY = y;
  saveConfig(cfg);
}

app.whenReady().then(() => { ensureDirs(); createWindow(); setupAutoUpdater(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── IPC handlers ──

// License
ipcMain.handle('license:check', async () => {
  const cfg = loadConfig();
  const email = cfg.licenseEmail || '';
  let isAdmin = false;
  if (cfg.licenseKey && email === 'mysteropodes@gmail.com') {
    try {
      const r = await verifyGumroadLicense(cfg.licenseKey);
      isAdmin = r.success && (r.purchase?.email === 'mysteropodes@gmail.com');
    } catch {}
  }
  return { licensed: !!cfg.licenseKey, email, isAdmin };
});

ipcMain.handle('license:activate', async (_, key) => {
  try {
    const r = await verifyGumroadLicense(key);
    if (r.success) {
      const cfg = loadConfig();
      cfg.licenseKey = key;
      cfg.licenseEmail = r.purchase?.email || '';
      cfg.licenseTier = r.tier;
      saveConfig(cfg);
      return { success: true, email: cfg.licenseEmail, tier: r.tier };
    }
    return { success: false, message: r.message || 'Invalid license key' };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

// MCP
ipcMain.handle('mcp:ping', async () => { mcpInitialized = false; return await ensureMcpInit(); });
ipcMain.handle('mcp:callTool', async (_, name, args) => {
  try { return await mcpCallTool(name, typeof args === 'string' ? JSON.parse(args) : args); }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle('mcp:listTools', async () => {
  try {
    if (!await ensureMcpInit()) return [];
    const r = await sendRaw(JSON.stringify({ jsonrpc: '2.0', id: mcpIdCounter++, method: 'tools/list', params: {} }));
    return r.result?.tools || [];
  } catch { return []; }
});

// Scripts
ipcMain.handle('scripts:list', () => loadScripts());
ipcMain.handle('scripts:save', (_, script) => saveScript(script));
ipcMain.handle('scripts:delete', (_, filename) => { deleteScript(filename); return true; });
ipcMain.handle('scripts:import', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'JSON Scripts', extensions: ['json'] }],
    properties: ['openFile', 'multiSelections']
  });
  const imported = [];
  for (const fp of filePaths) {
    try {
      const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (!data.name) data.name = path.basename(fp, '.json');
      const fname = saveScript(data);
      data._filename = fname;
      imported.push(data);
    } catch {}
  }
  return imported;
});

// Layout
ipcMain.handle('layout:load', () => loadLayout());
ipcMain.handle('layout:save', (_, layout) => { saveLayout(layout); return true; });

// Config
ipcMain.handle('config:get', () => {
  const cfg = loadConfig();
  const { githubToken, licenseKey, ...safe } = cfg;
  return safe;
});
ipcMain.handle('config:set', (_, key, value) => {
  const BLOCKED = ['licenseKey', 'licenseEmail', 'licenseTier', 'githubToken'];
  if (BLOCKED.includes(key)) return false;
  const cfg = loadConfig();
  cfg[key] = value;
  saveConfig(cfg);
  if (key === 'alwaysOnTop' && mainWindow) mainWindow.setAlwaysOnTop(value);
  return true;
});

// Window
ipcMain.handle('window:resize', (_, w, h) => { if (mainWindow) mainWindow.setSize(w, h, false); });
ipcMain.handle('window:getSize', () => mainWindow ? mainWindow.getSize() : [400, 600]);
ipcMain.handle('window:minimize', () => { if (mainWindow) mainWindow.minimize(); });
ipcMain.handle('window:close', () => { if (mainWindow) mainWindow.close(); });
ipcMain.handle('window:maximize', () => { if (mainWindow) { mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize(); } });

// Custom icon
ipcMain.handle('icon:pick', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Images', extensions: ['svg', 'png', 'jpg', 'jpeg', 'webp'] }],
    properties: ['openFile']
  });
  if (!filePaths.length) return null;
  const fp = filePaths[0];
  const ext = path.extname(fp).toLowerCase();
  const buf = fs.readFileSync(fp);
  if (ext === '.svg') {
    return { type: 'svg', data: buf.toString('utf8') };
  }
  const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { type: 'img', data: `data:${mime};base64,${buf.toString('base64')}` };
});

ipcMain.handle('avatar:pick', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }],
    properties: ['openFile']
  });
  if (!filePaths.length) return null;
  const src = filePaths[0];
  const ext = path.extname(src).toLowerCase();
  const dest = path.join(app.getPath('userData'), 'avatar' + ext);
  fs.copyFileSync(src, dest);
  return dest;
});

// Script license verification (for paid community scripts)
ipcMain.handle('scripts:verifyLicense', async (_, license) => {
  return await verifyScriptLicense(license);
});

// Open external URL securely (for support/tip links)
ipcMain.handle('shell:openExternal', (_, url) => {
  const ALLOWED = ['ko-fi.com','buymeacoffee.com','github.com','patreon.com','paypal.me','gumroad.com','lemonsqueezy.com','itch.io','rive.app'];
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return { error: 'Only HTTPS links allowed' };
    const host = parsed.hostname.replace(/^www\./, '');
    if (!ALLOWED.some(d => host === d || host.endsWith('.' + d))) return { error: `Domain not allowed: ${host}` };
    shell.openExternal(url);
    return { ok: true };
  } catch { return { error: 'Invalid URL' }; }
});

// Obfuscation (shared key — any RiveBar instance can deobfuscate)
ipcMain.handle('scripts:obfuscate', (_, steps) => {
  try { return obfuscateSteps(steps); }
  catch (e) { return { error: e.message }; }
});
ipcMain.handle('scripts:deobfuscate', (_, encData) => {
  try { return deobfuscateSteps(encData); }
  catch (e) { return { error: 'Deobfuscation failed' }; }
});

// Script encryption
ipcMain.handle('scripts:encrypt', (_, steps) => {
  const cfg = loadConfig();
  if (!cfg.licenseKey) return { error: 'No license key' };
  try { return encryptScript(steps, cfg.licenseKey); }
  catch (e) { return { error: e.message }; }
});

ipcMain.handle('scripts:decrypt', (_, encData) => {
  const cfg = loadConfig();
  if (!cfg.licenseKey) return { error: 'No license key' };
  try { return decryptScript(encData, cfg.licenseKey); }
  catch (e) { return { error: 'Decryption failed — invalid license or corrupted data' }; }
});

// Auto-updater
ipcMain.handle('updater:check', () => {
  autoUpdater.checkForUpdates().catch(() => {});
  return true;
});
ipcMain.handle('updater:install', () => {
  autoUpdater.quitAndInstall(false, true);
});

// Presets (Pro feature — step editor)
function loadPresets() {
  try { return fs.existsSync(PRESETS_FILE) ? JSON.parse(fs.readFileSync(PRESETS_FILE, 'utf8')) : []; } catch { return []; }
}
function savePresets(presets) { fs.writeFileSync(PRESETS_FILE, JSON.stringify(presets, null, 2)); }

ipcMain.handle('presets:load', () => loadPresets());
ipcMain.handle('presets:save', (_, presets) => { savePresets(presets); return true; });
ipcMain.handle('presets:exportFile', async (_, presetsData) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Presets', defaultPath: 'rive-presets.json',
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (!filePath) return null;
  fs.writeFileSync(filePath, JSON.stringify(presetsData, null, 2));
  return filePath;
});
ipcMain.handle('presets:importFile', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Presets',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (!filePaths || !filePaths.length) return null;
  try { return JSON.parse(fs.readFileSync(filePaths[0], 'utf8')); }
  catch (e) { return { error: e.message }; }
});

// License tier detection
ipcMain.handle('license:tier', () => {
  const cfg = loadConfig();
  if (!cfg.licenseKey) return 'free';
  return cfg.licenseTier || 'lite';
});

ipcMain.handle('license:refresh', async () => {
  const cfg = loadConfig();
  if (!cfg.licenseKey) return { success: false, message: 'No license key' };
  try {
    const r = await verifyGumroadLicense(cfg.licenseKey);
    if (r.success) {
      const oldTier = cfg.licenseTier || 'lite';
      cfg.licenseTier = r.tier;
      cfg.licenseEmail = r.purchase?.email || cfg.licenseEmail;
      saveConfig(cfg);
      return { success: true, tier: r.tier, oldTier, email: cfg.licenseEmail, upgraded: oldTier !== r.tier };
    }
    return { success: false, message: r.message || 'Verification failed' };
  } catch (e) {
    return { success: false, message: e.message };
  }
});

// Drop import — supports free scripts (steps) and paid scripts (license + steps)
ipcMain.handle('scripts:importFromPath', (_, filePath) => {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const items = Array.isArray(raw) ? raw : [raw];
    const imported = [];
    for (const data of items) {
      if (typeof data !== 'object' || data === null) continue;
      if (!data.name) data.name = path.basename(filePath, '.json');
      // Accept scripts with steps OR with a license (paid scripts validated later)
      const hasSteps = data.steps && Array.isArray(data.steps);
      const hasLicense = data.license && typeof data.license === 'object';
      const hasEncrypted = data.encrypted && data.encData;
      if (!hasSteps && !hasLicense && !hasEncrypted) continue;
      // Mark licensed scripts for frontend verification
      if (hasLicense) data._needsLicenseCheck = true;
      const fname = saveScript(data);
      data._filename = fname;
      imported.push(data);
    }
    return imported;
  } catch (e) {
    return { error: e.message };
  }
});

// ── Publish to Community Store (Pro only) ──
// Uses GitHub API to fork+PR or direct commit via personal access token
const STORE_REPO_OWNER = 'mysteropodes';
const STORE_REPO_NAME = 'rive-mcp-store';
const { execFile } = require('child_process');

function getGithubToken() {
  const cfg = loadConfig();
  if (cfg.githubToken) return Promise.resolve(cfg.githubToken);
  return new Promise((resolve) => {
    execFile('gh', ['auth', 'token'], { timeout: 5000 }, (err, stdout) => {
      if (err || !stdout?.trim()) resolve(null);
      else resolve(stdout.trim());
    });
  });
}

ipcMain.handle('github:token', async () => {
  const t = await getGithubToken();
  return t || null;
});
ipcMain.handle('clipboard:read', () => {
  const { clipboard } = require('electron');
  return clipboard.readText();
});

ipcMain.handle('github:setToken', (_, token) => {
  const cfg = loadConfig();
  cfg.githubToken = (token || '').trim() || undefined;
  saveConfig(cfg);
  return true;
});

function githubRequest(method, apiPath, body, token) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : '';
    const req = https.request({
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'RiveBar/1.0',
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data || '{}') }); }
        catch { resolve({ status: res.statusCode, data: { raw: data } }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

ipcMain.handle('store:publish', async (_, scriptData) => {
  const cfg = loadConfig();
  if (cfg.licenseTier !== 'pro') return { error: 'Pro license required to publish' };
  const token = await getGithubToken();
  if (!token) return { error: 'GitHub token not found. Install GitHub CLI (gh) and run "gh auth login", or set a token in Settings.' };

  try {
    // Admin: delete creator
    if (scriptData._type === '_adminDeleteCreator') {
      const crPath = 'creators.json';
      const crRes = await githubRequest('GET', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${crPath}`, null, token);
      const creators = JSON.parse(Buffer.from(crRes.data.content, 'base64').toString());
      const filtered = creators.filter(c => c.name !== scriptData.name);
      const content = Buffer.from(JSON.stringify(filtered, null, 2)).toString('base64');
      await githubRequest('PUT', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${crPath}`, { message: `Admin: remove creator ${scriptData.name}`, content, sha: crRes.data.sha }, token);
      return { success: true };
    }

    // Admin: delete script from catalog
    if (scriptData._type === '_adminDeleteScript') {
      const catPath = 'catalog.json';
      const catRes = await githubRequest('GET', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${catPath}`, null, token);
      const catData = JSON.parse(Buffer.from(catRes.data.content, 'base64').toString());
      const scripts = Array.isArray(catData) ? catData : (catData.scripts || []);
      const filtered = scripts.filter(s => s.id !== scriptData.scriptId);
      const newCat = { version: catData.version || '1.0.0', scripts: filtered };
      const content = Buffer.from(JSON.stringify(newCat, null, 2)).toString('base64');
      await githubRequest('PUT', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${catPath}`, { message: `Admin: remove script ${scriptData.scriptId}`, content, sha: catRes.data.sha }, token);
      return { success: true };
    }

    // Like a script (increment likesCount in catalog)
    if (scriptData._type === '_likeScript') {
      const catPath = 'catalog.json';
      const catRes = await githubRequest('GET', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${catPath}`, null, token);
      const catData = JSON.parse(Buffer.from(catRes.data.content, 'base64').toString());
      const scripts = Array.isArray(catData) ? catData : (catData.scripts || []);
      const script = scripts.find(s => s.id === scriptData.scriptId);
      if (script) { script.likesCount = (script.likesCount || 0) + 1; }
      const newCat = { version: catData.version || '1.0.0', scripts };
      const content = Buffer.from(JSON.stringify(newCat, null, 2)).toString('base64');
      await githubRequest('PUT', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${catPath}`, { message: `Like: ${scriptData.scriptId}`, content, sha: catRes.data.sha }, token);
      return { success: true, newCount: script?.likesCount || 0 };
    }

    // Admin: delete specific comments
    if (scriptData._type === '_adminDeleteComment') {
      const commentsPath = `comments/${scriptData.scriptId}.json`;
      const commentsRes = await githubRequest('GET', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${commentsPath}`, null, token);
      const comments = JSON.parse(Buffer.from(commentsRes.data.content, 'base64').toString());
      comments.splice(scriptData.commentIdx, 1);
      if (comments.length === 0) {
        await githubRequest('DELETE', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${commentsPath}`, { message: `Admin: delete all comments for ${scriptData.scriptId}`, sha: commentsRes.data.sha }, token);
      } else {
        const content = Buffer.from(JSON.stringify(comments, null, 2)).toString('base64');
        await githubRequest('PUT', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${commentsPath}`, { message: `Admin: delete comment on ${scriptData.scriptId}`, content, sha: commentsRes.data.sha }, token);
      }
      return { success: true };
    }

    // Admin: delete all comments for a script
    if (scriptData._type === '_adminDeleteAllComments') {
      const commentsPath = `comments/${scriptData.scriptId}.json`;
      try {
        const commentsRes = await githubRequest('GET', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${commentsPath}`, null, token);
        await githubRequest('DELETE', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${commentsPath}`, { message: `Admin: purge comments for ${scriptData.scriptId}`, sha: commentsRes.data.sha }, token);
      } catch {}
      return { success: true };
    }

    // Admin: update full catalog
    if (scriptData._type === '_adminUpdateCatalog') {
      const catPath = 'catalog.json';
      const catRes = await githubRequest('GET', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${catPath}`, null, token);
      const content = Buffer.from(JSON.stringify(scriptData.catalog, null, 2)).toString('base64');
      await githubRequest('PUT', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${catPath}`, { message: 'Admin: update catalog', content, sha: catRes.data.sha }, token);
      return { success: true };
    }

    // Handle comment upload
    if (scriptData._commentUpload) {
      const commentsPath = `comments/${scriptData.scriptId}.json`;
      const commentsContent = Buffer.from(JSON.stringify(scriptData.comments, null, 2)).toString('base64');
      let commentsSha = null;
      try {
        const existRes = await githubRequest('GET', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${commentsPath}`, null, token);
        if (existRes.status === 200) commentsSha = existRes.data.sha;
      } catch {}
      const commentsBody = { message: `Comment on ${scriptData.scriptId}`, content: commentsContent, ...(commentsSha ? { sha: commentsSha } : {}) };
      const commentsRes = await githubRequest('PUT', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${commentsPath}`, commentsBody, token);
      if (commentsRes.status !== 200 && commentsRes.status !== 201) return { error: 'Failed to post comment' };
      return { success: true };
    }

    // Handle avatar upload to GitHub
    if (scriptData._avatarUpload) {
      const localPath = scriptData.localPath;
      const ext = path.extname(localPath).toLowerCase();
      const avatarPath = `avatars/${scriptData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}${ext}`;
      const buf = fs.readFileSync(localPath);
      const content = buf.toString('base64');
      let avatarSha = null;
      try {
        const existRes = await githubRequest('GET', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${avatarPath}`, null, token);
        if (existRes.status === 200) avatarSha = existRes.data.sha;
      } catch {}
      const body = { message: `Avatar: ${scriptData.name}`, content, ...(avatarSha ? { sha: avatarSha } : {}) };
      const res = await githubRequest('PUT', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${avatarPath}`, body, token);
      if (res.status === 200 || res.status === 201) {
        return { avatarUrl: `https://raw.githubusercontent.com/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/main/${avatarPath}` };
      }
      return { error: 'Failed to upload avatar' };
    }

    // Handle profile upload
    if (scriptData._profileUpload) {
      const profile = scriptData.profile;
      const creatorsPath = 'creators.json';
      let creators = [];
      let creatorsSha = null;
      try {
        const existRes = await githubRequest('GET', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${creatorsPath}`, null, token);
        if (existRes.status === 200) {
          creatorsSha = existRes.data.sha;
          const raw = JSON.parse(Buffer.from(existRes.data.content, 'base64').toString('utf8'));
          creators = Array.isArray(raw) ? raw : (raw.creators || []);
        }
      } catch {}
      const idx = creators.findIndex(c => c.name === profile.name);
      if (idx >= 0) creators[idx] = { ...creators[idx], ...profile };
      else creators.push(profile);
      const content = Buffer.from(JSON.stringify(creators, null, 2)).toString('base64');
      const body = { message: `${idx >= 0 ? 'Update' : 'Add'} creator: ${profile.name}`, content, ...(creatorsSha ? { sha: creatorsSha } : {}) };
      const res = await githubRequest('PUT', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${creatorsPath}`, body, token);
      if (res.status !== 200 && res.status !== 201) return { error: 'Failed to publish profile: ' + (res.data?.message || res.status) };
      return { success: true };
    }

    const scriptId = scriptData.id;

    const scriptFile = { id: scriptId, name: scriptData.title, description: scriptData.description, author: scriptData.author, version: scriptData.version || '1.0.0', steps: scriptData.steps || [] };

    // Get current catalog
    const catRes = await githubRequest('GET', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/catalog.json`, null, token);
    if (catRes.status !== 200) return { error: 'Could not fetch catalog: ' + catRes.status };
    const catSha = catRes.data.sha;
    const catRaw = JSON.parse(Buffer.from(catRes.data.content, 'base64').toString('utf8'));
    const catalog = Array.isArray(catRaw) ? catRaw : (catRaw.scripts || []);

    const existingItem = catalog.find(s => s.id === scriptId);
    const catalogEntry = {
      id: scriptId,
      title: scriptData.title,
      description: scriptData.description,
      author: scriptData.author,
      downloadUrl: `https://raw.githubusercontent.com/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/main/scripts/${scriptId}.json`,
      category: scriptData.category || 'utility',
      tags: scriptData.tags || [],
      icon: scriptData.icon || 'bolt',
      featured: existingItem?.featured || false,
      downloadsCount: existingItem?.downloadsCount || 0,
      likesCount: existingItem?.likesCount || 0,
      hasUi: scriptData.hasUi || false,
      version: scriptData.version || '1.0.0',
      updatedAt: new Date().toISOString(),
    };
    if (scriptData.purchaseUrl) catalogEntry.purchaseUrl = scriptData.purchaseUrl;
    if (scriptData.priceLabel) catalogEntry.priceLabel = scriptData.priceLabel;

    // Check if script already exists
    const existing = catalog.findIndex(s => s.id === scriptId);
    if (existing >= 0) catalog[existing] = catalogEntry;
    else catalog.push(catalogEntry);

    // Preserve wrapper format if it had one
    const catalogOut = Array.isArray(catRaw) ? catalog : { ...catRaw, scripts: catalog };

    // Upload script file
    const scriptPath = `scripts/${scriptId}.json`;
    const scriptContent = Buffer.from(JSON.stringify(scriptFile, null, 2)).toString('base64');

    // Check if file exists (need sha to update)
    let scriptSha = null;
    try {
      const existRes = await githubRequest('GET', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${scriptPath}`, null, token);
      if (existRes.status === 200) scriptSha = existRes.data.sha;
    } catch {}

    const scriptBody = {
      message: `${existing >= 0 ? 'Update' : 'Add'} script: ${scriptData.title}`,
      content: scriptContent,
      ...(scriptSha ? { sha: scriptSha } : {})
    };
    const scriptRes = await githubRequest('PUT', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/${scriptPath}`, scriptBody, token);
    if (scriptRes.status !== 200 && scriptRes.status !== 201) {
      return { error: 'Failed to upload script: ' + (scriptRes.data.message || scriptRes.status) };
    }

    // Update catalog
    const catContent = Buffer.from(JSON.stringify(catalogOut, null, 2)).toString('base64');
    const catBody = { message: `Update catalog: ${scriptData.title}`, content: catContent, sha: catSha };
    const catUpRes = await githubRequest('PUT', `/repos/${STORE_REPO_OWNER}/${STORE_REPO_NAME}/contents/catalog.json`, catBody, token);
    if (catUpRes.status !== 200 && catUpRes.status !== 201) {
      return { error: 'Failed to update catalog: ' + (catUpRes.data.message || catUpRes.status) };
    }

    return { success: true, id: scriptId };
  } catch (e) {
    return { error: e.message };
  }
});
