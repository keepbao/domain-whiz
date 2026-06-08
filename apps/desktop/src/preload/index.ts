import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

/** 订阅主进程广播：统一 on/removeListener 套路，返回取消订阅函数。 */
function subscribe(channel: string, cb: (payload: unknown) => void): () => void {
  const handler = (_e: IpcRendererEvent, payload: unknown): void => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("dw", {
  getConfig: () => ipcRenderer.invoke("config:get"),

  previewOpenTemplate: (variant: string) => ipcRenderer.invoke("preview:openTemplate", variant),
  previewOpenSite: (domain: string) => ipcRenderer.invoke("preview:openSite", domain),

  siteExport: (domain: string) => ipcRenderer.invoke("site:export", domain),
  siteExportBatch: (domains: string[]) => ipcRenderer.invoke("site:exportBatch", domains),
  siteDelete: (domain: string) => ipcRenderer.invoke("site:delete", domain),
  siteDeleteBatch: (domains: string[]) => ipcRenderer.invoke("site:deleteBatch", domains),

  catalogListAll: () => ipcRenderer.invoke("catalog:listAll"),

  siteProducts: (domains: string[]) => ipcRenderer.invoke("site:products", domains),
  siteReveal: (domain: string) => ipcRenderer.invoke("site:reveal", domain),

  chatRun: (input: unknown) => ipcRenderer.invoke("chat:run", input),
  chatCancel: () => ipcRenderer.invoke("chat:cancel"),
  onChatChunk: (cb: (chunk: unknown) => void) => subscribe("chat:chunk", cb),

  historyList: () => ipcRenderer.invoke("history:list"),
  historyGet: (id: string) => ipcRenderer.invoke("history:get", id),
  historyDelete: (id: string) => ipcRenderer.invoke("history:delete", id),
  historyClear: () => ipcRenderer.invoke("history:clear"),
  onHistoryChanged: (cb: (payload: unknown) => void) => subscribe("history:changed", cb),

  deployListServerStatus: () => ipcRenderer.invoke("deploy:listServerStatus"),
  deployStart: (input: unknown) => ipcRenderer.invoke("deploy:start", input),
  deployListLogs: () => ipcRenderer.invoke("deploy:listLogs"),
  deployReadLog: (name: string) => ipcRenderer.invoke("deploy:readLog", name),
  onDeployEvent: (cb: (ev: unknown) => void) => subscribe("deploy:event", cb),

  serversUpsert: (input: unknown) => ipcRenderer.invoke("servers:upsert", input),
  serversDelete: (host: string) => ipcRenderer.invoke("servers:delete", host),
  serversImportKey: (host: string) => ipcRenderer.invoke("servers:importKey", host),

  approvalSubmit: (input: unknown) => ipcRenderer.invoke("approval:submit", input),
  approvalList: () => ipcRenderer.invoke("approval:list"),
  approvalRefresh: (instanceCode: string) =>
    ipcRenderer.invoke("approval:refresh", instanceCode),
  approvalCancel: (instanceCode: string) =>
    ipcRenderer.invoke("approval:cancel", instanceCode),
  onApprovalEvent: (cb: (ev: unknown) => void) => subscribe("approval:event", cb),

  feishuLogin: () => ipcRenderer.invoke("feishu:login"),
  feishuLogout: () => ipcRenderer.invoke("feishu:logout"),
  feishuWhoAmI: () => ipcRenderer.invoke("feishu:whoami"),
});
