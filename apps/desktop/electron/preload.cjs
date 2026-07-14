const { contextBridge, ipcRenderer } = require("electron");

const windowControls = {
  minimize() {
    return ipcRenderer.invoke("window:minimize");
  },

  toggleMaximize() {
    return ipcRenderer.invoke("window:toggle-maximize");
  },

  isMaximized() {
    return ipcRenderer.invoke("window:is-maximized");
  },

  toggleFullScreen() {
    return ipcRenderer.invoke("window:toggle-full-screen");
  },

  isFullScreen() {
    return ipcRenderer.invoke("window:is-full-screen");
  },

  close() {
    return ipcRenderer.invoke("window:close");
  }
};

contextBridge.exposeInMainWorld("electronAPI", {
  getLanApiBaseUrl(port = 4000) {
    return ipcRenderer.sendSync("system:get-lan-api-base-url", port);
  },

  printReceipt(url, options = {}) {
    return ipcRenderer.invoke("print-receipt", {
      url,
      options
    });
  },

  listPrinters() {
    return ipcRenderer.invoke("printers:list");
  },

  minimizeWindow() {
    return windowControls.minimize();
  },

  toggleMaximizeWindow() {
    return windowControls.toggleMaximize();
  },

  isWindowMaximized() {
    return windowControls.isMaximized();
  },

  toggleFullScreenWindow() {
    return windowControls.toggleFullScreen();
  },

  isWindowFullScreen() {
    return windowControls.isFullScreen();
  },

  closeWindow() {
    return windowControls.close();
  }
});

contextBridge.exposeInMainWorld("desktopApp", {
  windowControls
});
