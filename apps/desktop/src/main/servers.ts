import { existsSync, readFileSync } from "node:fs";
import { BrowserWindow, dialog } from "electron";
import {
  loadDesktopConfig,
  saveUserDesktopConfig,
  toPublicConfig,
  type DeployServerConfig,
  type DesktopConfig,
} from "./config.js";
import { DEFAULT_DEPLOY_SERVER_HOSTS } from "./deployServers.js";

export interface ServerUpsertInput {
  /** 原 host（用于编辑时定位），缺省视为新增 */
  originalHost?: string;
  server: DeployServerConfig;
}

function dedupeByHost(list: DeployServerConfig[]): DeployServerConfig[] {
  const out: DeployServerConfig[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const h = item.host?.trim();
    if (!h || seen.has(h)) continue;
    seen.add(h);
    out.push({ ...item, host: h });
  }
  return out;
}

export function upsertServer(input: ServerUpsertInput): DesktopConfig {
  const cfg = loadDesktopConfig();
  const list = [...(cfg.deployServers ?? [])];
  const newHost = input.server.host?.trim();
  if (!newHost) throw new Error("host 不能为空");
  const idx = list.findIndex((s) => s.host.trim() === (input.originalHost?.trim() || newHost));
  const next: DeployServerConfig = {
    host: newHost,
    port: input.server.port ?? 22,
    username: input.server.username?.trim() || "",
    privateKeyPem: input.server.privateKeyPem ?? "",
    privateKeyPath: input.server.privateKeyPath?.trim() || "",
    privateKeyPassphrase: input.server.privateKeyPassphrase ?? "",
  };
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  return toPublicConfig(saveUserDesktopConfig({ deployServers: dedupeByHost(list) }));
}

export function deleteServer(host: string): DesktopConfig {
  // 内置 IP 不真正删除，重置为空配置即可（与下面一行同效，统一保留入口便于未来扩展）
  void DEFAULT_DEPLOY_SERVER_HOSTS;
  const cfg = loadDesktopConfig();
  const list = (cfg.deployServers ?? []).filter((s) => s.host.trim() !== host.trim());
  return toPublicConfig(saveUserDesktopConfig({ deployServers: dedupeByHost(list) }));
}

export async function importServerPrivateKey(
  sender: BrowserWindow | null,
  host: string,
): Promise<DesktopConfig> {
  const r = await dialog.showOpenDialog(sender ?? undefined, {
    title: `为 ${host} 选择 SSH 私钥`,
    properties: ["openFile"],
    filters: [{ name: "Key", extensions: ["pem", "key", "ppk", ""] }],
  });
  const cfg = loadDesktopConfig();
  if (r.canceled || !r.filePaths[0]) return toPublicConfig(cfg);
  const filePath = r.filePaths[0];
  if (!existsSync(filePath)) return toPublicConfig(cfg);
  const pem = readFileSync(filePath, "utf8");
  const list = [...(cfg.deployServers ?? [])];
  const idx = list.findIndex((s) => s.host.trim() === host.trim());
  const base: DeployServerConfig = idx >= 0 ? list[idx]! : { host, port: 22, username: "" };
  const next: DeployServerConfig = { ...base, host, privateKeyPem: pem, privateKeyPath: filePath };
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  return toPublicConfig(saveUserDesktopConfig({ deployServers: dedupeByHost(list) }));
}
