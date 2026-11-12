'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('idrive', {
    state: () => ipcRenderer.invoke('state'),
    confirmParked: value => ipcRenderer.invoke('confirm-parked', value),
    search: query => ipcRenderer.invoke('search', query),
    play: input => ipcRenderer.invoke('play', input),
    tv: () => ipcRenderer.invoke('tv'),
    fullscreen: () => ipcRenderer.invoke('fullscreen'),
    onState: callback => ipcRenderer.on('state-update', (_event, state) => callback(state))
});
