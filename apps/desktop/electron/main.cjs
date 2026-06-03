const { app, BrowserWindow, shell, ipcMain } = require("electron");
const path = require("node:path");
const os = require("node:os");

const isDev = !app.isPackaged;
const appIconPath = isDev
  ? path.join(__dirname, "../build/icon.png")
  : path.join(process.resourcesPath, "icon.png");

function getLanIp() {
  const interfaces = os.networkInterfaces();

  for (const items of Object.values(interfaces)) {
    for (const item of items || []) {
      if (
        item.family === "IPv4" &&
        !item.internal &&
        !item.address.startsWith("169.254.")
      ) {
        return item.address;
      }
    }
  }

  return "127.0.0.1";
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1320,
    height: 860,
    minWidth: 1120,
    minHeight: 760,
    title: "Muhaseb",
    icon: appIconPath,
    backgroundColor: "#050B10",
    frame: false,
    titleBarStyle: process.platform === "darwin" ? "hidden" : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.setMenuBarVisibility(false);

  if (isDev) {
    win.loadURL("http://localhost:5173");
  } else {
    win.loadFile(path.join(__dirname, "../dist/index.html"));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function windowFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

async function printReceipt(payload) {
  const url = typeof payload === "string" ? payload : payload.url;
  const options = typeof payload === "string" ? {} : payload.options || {};

  const widthMm = Number(options.widthMm || 80);
  const widthMicrons = Math.round(widthMm * 1000);

  return new Promise((resolve, reject) => {
    const printWindow = new BrowserWindow({
      width: widthMm === 58 ? 360 : 460,
      height: 720,
      show: false,
      backgroundColor: "#ffffff",
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    printWindow.loadURL(url);

    printWindow.webContents.once("did-finish-load", async () => {
      try {
        await printWindow.webContents.insertCSS(`
          @page {
            size: ${widthMm}mm auto;
            margin: 0;
          }

          html,
          body {
            margin: 0 !important;
            padding: 0 !important;
            background: white !important;
          }

          body {
            width: ${widthMm}mm !important;
            max-width: ${widthMm}mm !important;
          }

          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        `);

        printWindow.webContents.print(
          {
            silent: false,
            printBackground: true,
            margins: {
              marginType: "none"
            },
            pageSize: {
              width: widthMicrons,
              height: 297000
            }
          },
          (success, failureReason) => {
            printWindow.close();

            if (!success) {
              reject(new Error(failureReason || "Print failed"));
              return;
            }

            resolve(true);
          }
        );
      } catch (error) {
        printWindow.close();
        reject(error);
      }
    });

    printWindow.webContents.once("did-fail-load", (_event, _code, description) => {
      printWindow.close();
      reject(new Error(description || "Receipt load failed"));
    });
  });
}

ipcMain.handle("print-receipt", async (_event, payload) => {
  await printReceipt(payload);
  return true;
});

ipcMain.on("system:get-lan-api-base-url", (event, port = 4000) => {
  event.returnValue = `http://${getLanIp()}:${port}`;
});

ipcMain.handle("window:minimize", (event) => {
  windowFromEvent(event)?.minimize();
});

ipcMain.handle("window:toggle-maximize", (event) => {
  const win = windowFromEvent(event);

  if (!win) {
    return false;
  }

  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }

  return win.isMaximized();
});

ipcMain.handle("window:is-maximized", (event) => {
  return windowFromEvent(event)?.isMaximized() ?? false;
});

ipcMain.handle("window:toggle-full-screen", (event) => {
  const win = windowFromEvent(event);

  if (!win) {
    return false;
  }

  win.setFullScreen(!win.isFullScreen());
  return win.isFullScreen();
});

ipcMain.handle("window:is-full-screen", (event) => {
  return windowFromEvent(event)?.isFullScreen() ?? false;
});

ipcMain.handle("window:close", (event) => {
  windowFromEvent(event)?.close();
});

app.whenReady().then(() => {
  if (process.platform === "win32") {
    app.setAppUserModelId("af.muhaseb.desktop");
  }

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
