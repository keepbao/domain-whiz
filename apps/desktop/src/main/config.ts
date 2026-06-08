import { existsSync, mkdirSync, readFileSync, copyFileSync } from "node:fs";
import { app } from "electron";
import type { FeishuConfigBlock } from "@domain-whiz/feishu";
import { getAppRoot, getConfigExamplePath, getUserConfigPath } from "./paths.js";
import { writeJsonFileAtomic } from "./jsonStore.js";

export interface DeployServerConfig {
  host: string;
  port?: number;
  username?: string;
  privateKeyPem?: string;
  privateKeyPath?: string;
  privateKeyPassphrase?: string;
}

export interface DesktopConfig {
  /** Cursor API Key（明文保存在安装目录 desktop.config.json）。 */
  cursorApiKey?: string;
  /** 按 IP 配置的部署服务器 SSH。远端站点路径与 nginx 路径在 main 进程的 deployConstants.ts 中写死。 */
  deployServers?: DeployServerConfig[];
  /** 飞书审批接入：app 凭据 + 两类审批的 approval_code + widget 映射 + 通知规则。 */
  feishu?: FeishuConfigBlock;
}

function deepMerge<T extends Record<string, unknown>>(base: T, patch: Partial<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      out[k] &&
      typeof out[k] === "object" &&
      !Array.isArray(out[k])
    ) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

export function toPublicConfig(c: DesktopConfig): DesktopConfig {
  return JSON.parse(JSON.stringify(c)) as DesktopConfig;
}

function defaultConfig(): DesktopConfig {
  return { cursorApiKey: "", deployServers: [] };
}

function readConfigFile(path: string): DesktopConfig {
  return JSON.parse(readFileSync(path, "utf8")) as DesktopConfig;
}

export function loadDesktopConfig(): DesktopConfig {
  const configPath = getUserConfigPath();

  // 打包后：安装目录内已附带 desktop.config.json，直接作为运行时配置（部署页改服务器会写回同文件）。
  if (app.isPackaged) {
    if (existsSync(configPath)) {
      return readConfigFile(configPath);
    }
    return defaultConfig();
  }

  // 开发态：example 作底，再与仓库根 desktop.config.json 深合并。
  const examplePath = getConfigExamplePath();
  const base = existsSync(examplePath) ? readConfigFile(examplePath) : defaultConfig();

  if (existsSync(configPath)) {
    const patch = readConfigFile(configPath) as Partial<DesktopConfig>;
    return deepMerge(
      base as unknown as Record<string, unknown>,
      patch as unknown as Record<string, unknown>,
    ) as DesktopConfig;
  }
  return base;
}

export function saveUserDesktopConfig(patch: Partial<DesktopConfig>): DesktopConfig {
  const current = loadDesktopConfig();
  const next = deepMerge(current as unknown as Record<string, unknown>, patch as Record<string, unknown>) as DesktopConfig;
  writeJsonFileAtomic(getUserConfigPath(), next);
  return next;
}

export function ensureUserConfigBootstrap(): void {
  // 安装包已内置 desktop.config.json，无需从 example 复制空配置覆盖。
  if (app.isPackaged) return;

  const userPath = getUserConfigPath();
  if (existsSync(userPath)) return;

  const examplePath = getConfigExamplePath();
  if (existsSync(examplePath)) {
    mkdirSync(getAppRoot(), { recursive: true });
    copyFileSync(examplePath, userPath);
    return;
  }
  writeJsonFileAtomic(userPath, defaultConfig());
}
