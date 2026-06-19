const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  license: {
    check: () => ipcRenderer.invoke('license:check'),
    activate: (key) => ipcRenderer.invoke('license:activate', key),
    tier: () => ipcRenderer.invoke('license:tier'),
    refresh: () => ipcRenderer.invoke('license:refresh'),
  },
  presets: {
    load: () => ipcRenderer.invoke('presets:load'),
    save: (presets) => ipcRenderer.invoke('presets:save', presets),
    exportFile: (presets) => ipcRenderer.invoke('presets:exportFile', presets),
    importFile: () => ipcRenderer.invoke('presets:importFile'),
  },
  mcp: {
    ping: () => ipcRenderer.invoke('mcp:ping'),
    callTool: (name, args) => ipcRenderer.invoke('mcp:callTool', name, args),
    listTools: () => ipcRenderer.invoke('mcp:listTools'),
  },
  scripts: {
    list: () => ipcRenderer.invoke('scripts:list'),
    save: (s) => ipcRenderer.invoke('scripts:save', s),
    delete: (f) => ipcRenderer.invoke('scripts:delete', f),
    import: () => ipcRenderer.invoke('scripts:import'),
    importFromPath: (p) => ipcRenderer.invoke('scripts:importFromPath', p),
    encrypt: (steps) => ipcRenderer.invoke('scripts:encrypt', steps),
    decrypt: (encData) => ipcRenderer.invoke('scripts:decrypt', encData),
    obfuscate: (steps) => ipcRenderer.invoke('scripts:obfuscate', steps),
    deobfuscate: (encData) => ipcRenderer.invoke('scripts:deobfuscate', encData),
    verifyLicense: (license) => ipcRenderer.invoke('scripts:verifyLicense', license),
  },
  layout: {
    load: () => ipcRenderer.invoke('layout:load'),
    save: (l) => ipcRenderer.invoke('layout:save', l),
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (k, v) => ipcRenderer.invoke('config:set', k, v),
  },
  window: {
    resize: (w, h) => ipcRenderer.invoke('window:resize', w, h),
    getSize: () => ipcRenderer.invoke('window:getSize'),
    minimize: () => ipcRenderer.invoke('window:minimize'),
    close: () => ipcRenderer.invoke('window:close'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
  },
  icon: {
    pick: () => ipcRenderer.invoke('icon:pick'),
  },
  avatar: {
    pick: () => ipcRenderer.invoke('avatar:pick'),
  },
  store: {
    publish: (scriptData) => ipcRenderer.invoke('store:publish', scriptData),
  },
  github: {
    token: () => ipcRenderer.invoke('github:token'),
    setToken: (t) => ipcRenderer.invoke('github:setToken', t),
  },
  clipboard: {
    read: () => ipcRenderer.invoke('clipboard:read'),
  },
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.invoke('updater:install'),
    onStatus: (cb) => ipcRenderer.on('updater:status', (_, data) => cb(data)),
  },
});
