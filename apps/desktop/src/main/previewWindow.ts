import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { BrowserWindow } from "electron";

let previewWin: BrowserWindow | null = null;

/** 预览时抑制横向滚动（适用于各模板，无需逐个改 CSS）。 */
const PREVIEW_NO_HORIZONTAL_SCROLL_CSS = `
  html, body {
    overflow-x: hidden !important;
    max-width: 100%;
  }
  img, video, iframe, svg, table {
    max-width: 100%;
  }
`;

/**
 * 用独立窗口加载本地 index.html，便于预览 templates / sites 下的静态站。
 */
export function openLocalSitePreview(siteDir: string): { ok: true } | { ok: false; error: string } {
  const dir = resolve(siteDir);
  const indexPath = join(dir, "index.html");
  if (!existsSync(indexPath) || !statSync(indexPath).isFile()) {
    return { ok: false, error: `未找到 index.html: ${indexPath}` };
  }
  if (previewWin && !previewWin.isDestroyed()) {
    previewWin.close();
  }
  previewWin = new BrowserWindow({
    show: false,
    title: "站点预览",
    frame: true,
    minimizable: true,
    maximizable: true,
    closable: true,
    fullscreenable: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  previewWin.on("closed", () => {
    previewWin = null;
  });
  previewWin.webContents.on("did-finish-load", () => {
    void previewWin?.webContents.insertCSS(PREVIEW_NO_HORIZONTAL_SCROLL_CSS);
  });
  previewWin.once("ready-to-show", () => {
    previewWin?.maximize();
    previewWin?.show();
  });
  void previewWin.loadFile(indexPath);
  return { ok: true };
}
