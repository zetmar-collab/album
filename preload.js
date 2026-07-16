const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  listItems: () => ipcRenderer.invoke('items:list'),
  saveItem: (item) => ipcRenderer.invoke('items:save', item),
  deleteItem: (id) => ipcRenderer.invoke('items:delete', id),
  searchRemote: (params) => ipcRenderer.invoke('search:remote', params),
  fetchTracks: (params) => ipcRenderer.invoke('lookup:tracks', params),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (s) => ipcRenderer.invoke('settings:set', s),
  settingsStatus: () => ipcRenderer.invoke('settings:status'),
  openDiscogsTokenPage: () => ipcRenderer.invoke('open:discogsTokenPage'),
  pickCover: () => ipcRenderer.invoke('cover:pick'),
  phoneInfo: () => ipcRenderer.invoke('phone:info'),
  exportBackup: () => ipcRenderer.invoke('backup:export'),
  exportExcel: () => ipcRenderer.invoke('export:excel'),
  importBackup: () => ipcRenderer.invoke('backup:import'),
  onPhoneEvent: (cb) => ipcRenderer.on('phone-event', (ev, data) => cb(data)),
  onDataChanged: (cb) => ipcRenderer.on('data-changed', () => cb())
});
