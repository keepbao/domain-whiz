import { BrowserWindow, ipcMain, webContents as wcModule } from "electron";
import { join } from "node:path";
import {
  ensureUserConfigBootstrap,
  loadDesktopConfig,
  toPublicConfig,
} from "./config.js";
import { getSitesRoot, getTemplatesRoot } from "./paths.js";
import { cancelActiveTask, startNewTaskAbortController } from "./taskLifecycle.js";
import { openLocalSitePreview } from "./previewWindow.js";
import { listDeployServerStatus } from "./deployServers.js";
import { listCatalog } from "./catalog.js";
import {
  addDeployListener,
  listDeployLogs,
  readDeployLog,
  startDeployTask,
  type DeployStartInput,
} from "./deployService.js";
import {
  deleteServer,
  importServerPrivateKey,
  upsertServer,
  type ServerUpsertInput,
} from "./servers.js";
import { addChatStreamListener, runChatTurn, type ChatRunInput } from "./chat.js";
import {
  getApprovalService,
  type ApprovalEvent,
  type SubmitApprovalInput,
} from "./approvalService.js";
import { getFeishuSessionService } from "./feishuSession.js";
import { getChatHistoryService, type ChatSession } from "./chatHistoryStore.js";
import { exportSite, exportSitesBatch } from "./siteExport.js";
import { deleteSite, deleteSitesBatch } from "./siteDelete.js";
import { getSiteProducts, revealSiteDir } from "./siteInfo.js";

let running = false;

function broadcast(channel: string, payload: unknown): void {
  for (const wc of wcModule.getAllWebContents()) {
    if (wc.isDestroyed()) continue;
    try {
      wc.send(channel, payload);
    } catch {
      /* ignore */
    }
  }
}

let listenersInstalled = false;
function ensureBroadcastListeners(): void {
  if (listenersInstalled) return;
  listenersInstalled = true;
  addDeployListener((ev) => broadcast("deploy:event", ev));
  addChatStreamListener((c) => broadcast("chat:chunk", c));
  getApprovalService().addListener((ev: ApprovalEvent) => broadcast("approval:event", ev));
  getChatHistoryService().addListener((items: ChatSession[]) =>
    broadcast("history:changed", { items }),
  );
}

export function registerIpcHandlers(): void {
  ensureBroadcastListeners();

  ipcMain.handle("config:get", async () => {
    ensureUserConfigBootstrap();
    return toPublicConfig(loadDesktopConfig());
  });

  ipcMain.handle("preview:openTemplate", (_e, variant: string) => {
    if (!variant?.trim()) return { ok: false as const, error: "请选择模板" };
    return openLocalSitePreview(join(getTemplatesRoot(), variant.trim()));
  });

  ipcMain.handle("preview:openSite", (_e, domain: string) => {
    if (!domain?.trim()) return { ok: false as const, error: "请选择网站" };
    return openLocalSitePreview(join(getSitesRoot(), domain.trim()));
  });

  ipcMain.handle("site:export", async (event, domain: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return await exportSite(win, domain);
  });

  ipcMain.handle("site:exportBatch", async (event, domains: string[]) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return await exportSitesBatch(win, domains);
  });

  ipcMain.handle("site:delete", (_e, domain: string) => deleteSite(domain));

  ipcMain.handle("site:deleteBatch", (_e, domains: string[]) => deleteSitesBatch(domains));

  ipcMain.handle("catalog:listAll", () => listCatalog());

  ipcMain.handle("site:products", (_e, domains: string[]) => getSiteProducts(domains ?? []));

  ipcMain.handle("site:reveal", (_e, domain: string) => revealSiteDir(domain));

  ipcMain.handle("deploy:listServerStatus", () => ({
    servers: listDeployServerStatus(loadDesktopConfig()),
  }));

  ipcMain.handle("deploy:start", (_e, input: DeployStartInput) =>
    startDeployTask(loadDesktopConfig(), input),
  );

  ipcMain.handle("deploy:listLogs", () => ({ logs: listDeployLogs() }));

  ipcMain.handle("deploy:readLog", (_e, name: string) => readDeployLog(name));

  ipcMain.handle("servers:upsert", (_e, input: ServerUpsertInput) => upsertServer(input));

  ipcMain.handle("servers:delete", (_e, host: string) => deleteServer(host));

  ipcMain.handle("servers:importKey", async (event, host: string) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    return importServerPrivateKey(win, host);
  });

  ipcMain.handle("chat:run", async (_e, input: ChatRunInput) => {
    if (running) {
      return { ok: false, error: "已有任务在执行，请等待结束或先取消。" };
    }
    running = true;
    const ac = startNewTaskAbortController();
    try {
      const cfg = loadDesktopConfig();
      return await runChatTurn(cfg, input, ac.signal);
    } finally {
      running = false;
    }
  });

  ipcMain.handle("chat:cancel", () => {
    if (!running) return { ok: false as const, error: "当前没有正在执行的任务" };
    cancelActiveTask();
    return { ok: true as const };
  });

  ipcMain.handle("history:list", () => ({ items: getChatHistoryService().list() }));
  ipcMain.handle("history:get", (_e, id: string) => ({
    session: getChatHistoryService().get(id),
  }));
  ipcMain.handle("history:delete", (_e, id: string) => {
    getChatHistoryService().delete(id);
    return { ok: true as const };
  });
  ipcMain.handle("history:clear", () => {
    getChatHistoryService().clear();
    return { ok: true as const };
  });

  ipcMain.handle("approval:submit", (_e, input: SubmitApprovalInput) =>
    getApprovalService().submit(input),
  );

  ipcMain.handle("approval:list", () => ({ items: getApprovalService().listTracked() }));

  ipcMain.handle("approval:refresh", (_e, instanceCode: string) =>
    getApprovalService().refreshOne(instanceCode),
  );

  ipcMain.handle("approval:cancel", (_e, instanceCode: string) =>
    getApprovalService().cancel(instanceCode),
  );

  ipcMain.handle("feishu:login", () => getFeishuSessionService().login());
  ipcMain.handle("feishu:logout", () => {
    getFeishuSessionService().logout();
    return { ok: true as const };
  });
  ipcMain.handle("feishu:whoami", () => ({ session: getFeishuSessionService().whoAmI() }));
}
