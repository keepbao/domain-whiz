import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Menu } from "electron";
import { registerIpcHandlers } from "./ipc.js";
import { ensureUserConfigBootstrap } from "./config.js";
import { getApprovalService } from "./approvalService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 源码位于 `apps/desktop/resources/icon.png`；开发时主进程在 `out/main`，向上两级到应用根。 */
function resolveAppIconPath(): string | undefined {
  const p = join(__dirname, "..", "..", "resources", "icon.png");
  return existsSync(p) ? p : undefined;
}

function createMainWindow(): BrowserWindow {
  const icon = resolveAppIconPath();
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    autoHideMenuBar: true,
    ...(icon ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  win.setMenuBarVisibility(false);

  const devServerUrl = process.env.ELECTRON_RENDERER_URL;
  if (!app.isPackaged && devServerUrl) {
    void win.loadURL(devServerUrl);
    win.webContents.openDevTools({ mode: "detach" });
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return win;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  ensureUserConfigBootstrap();
  registerIpcHandlers();
  // 审批轮询：飞书配置不齐时 service 会保持 idle，跟踪表照样能恢复显示。
  getApprovalService().start();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on("before-quit", () => {
  try {
    getApprovalService().flush();
    getApprovalService().stop();
  } catch {
    /* 退出阶段不阻塞 */
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
