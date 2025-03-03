// const { app, BrowserWindow } = require("electron");

import { app, BrowserWindow } from 'electron';
import path from 'path'
// Sunucu dosyamızı import edelim
require("./server.js");

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 900,
        height: 600,
        webPreferences: {
            nodeIntegration: true, // demo için basitlik sağlıyor
            contextIsolation: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
    createWindow();
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
});
