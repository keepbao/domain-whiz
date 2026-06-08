import type { DesktopConfig } from "./config.js";

/** 内置展示的服务器 IP 列表（可在「部署」面板为每台配置 SSH）。 */
export const DEFAULT_DEPLOY_SERVER_HOSTS = ["10.102.4.210"] as const;

export interface DeployServerEntry {
  host: string;
  port: number;
  username: string;
  privateKeyPem?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
}

export interface DeployServerStatus {
  host: string;
  configured: boolean;
  ready: boolean;
  missing: string[];
  port: number;
  username: string;
}

export function listKnownServerHosts(cfg: DesktopConfig): string[] {
  const fromCfg = (cfg.deployServers ?? []).map((s) => s.host.trim()).filter(Boolean);
  return [...new Set([...DEFAULT_DEPLOY_SERVER_HOSTS, ...fromCfg])];
}

export function resolveDeployServer(cfg: DesktopConfig, host: string): DeployServerEntry | null {
  const h = host.trim();
  if (!h) return null;
  const row = cfg.deployServers?.find((s) => s.host.trim() === h);
  if (!row) return null;
  return {
    host: h,
    port: row.port ?? 22,
    username: row.username?.trim() || "",
    privateKeyPem: row.privateKeyPem?.trim(),
    privateKeyPath: row.privateKeyPath?.trim(),
    privateKeyPassphrase: row.privateKeyPassphrase?.trim(),
  };
}

export function checkDeployServerSsh(entry: DeployServerEntry | null): { ready: boolean; missing: string[] } {
  if (!entry) {
    return { ready: false, missing: ["未在「部署」面板为该 IP 配置 SSH"] };
  }
  const missing: string[] = [];
  if (!entry.username) missing.push("username");
  if (!entry.privateKeyPem && !entry.privateKeyPath) missing.push("privateKeyPem 或 privateKeyPath");
  if (!entry.port || entry.port < 1) missing.push("port");
  return { ready: missing.length === 0, missing };
}

export function listDeployServerStatus(cfg: DesktopConfig): DeployServerStatus[] {
  return listKnownServerHosts(cfg).map((host) => {
    const entry = resolveDeployServer(cfg, host);
    const { ready, missing } = checkDeployServerSsh(entry);
    return {
      host,
      configured: entry !== null,
      ready,
      missing,
      port: entry?.port ?? 22,
      username: entry?.username ?? "",
    };
  });
}
