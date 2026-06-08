/**
 * 异步部署任务：返回 deployId 后通过 webContents 广播 `deploy:event` 推送实时进度，
 * 同时把详细日志落到 <appRoot>/.deploy-logs/<domain>__<host>__<ts>.log。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, normalize, posix, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { deploySiteWithNginx } from "@domain-whiz/deployer";
import { getAppRoot, getSitesRoot } from "./paths.js";
import { resolveDeployServer } from "./deployServers.js";
import { NGINX_SITES_ENABLED_DIR, WEB_ROOT } from "./deployConstants.js";
import type { DesktopConfig } from "./config.js";

const LOG_DIR_NAME = ".deploy-logs";

export type DeployEventType =
  | "start"
  | "connect"
  | "upload"
  | "delete_extra"
  | "apply"
  | "done"
  | "error";

export interface DeployEvent {
  deployId: string;
  domain: string;
  host: string;
  type: DeployEventType;
  message?: string;
  filename?: string;
  bytesUploaded?: number;
  totalBytes?: number;
  totalFiles?: number;
  fileIndex?: number;
  percent?: number;
  error?: string;
  ts: number;
}

export interface DeployStartInput {
  domain: string;
  host: string;
}

export interface DeployLogMeta {
  name: string;
  domain: string;
  host: string;
  mtime: number;
  sizeBytes: number;
}

type Listener = (e: DeployEvent) => void;
const listeners = new Set<Listener>();

export function addDeployListener(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(e: DeployEvent): void {
  for (const fn of listeners) {
    try {
      fn(e);
    } catch {
      /* listener errors are not fatal */
    }
  }
}

function getLogsDir(): string {
  const p = join(getAppRoot(), LOG_DIR_NAME);
  mkdirSync(p, { recursive: true });
  return p;
}

function appendLog(file: string, line: string): void {
  try {
    appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* best-effort */
  }
}

function logFilename(domain: string, host: string): string {
  const safeDomain = domain.replace(/[\\/]/g, "_");
  const safeHost = host.replace(/[\\/:]/g, "_");
  return `${safeDomain}__${safeHost}__${Date.now()}.log`;
}

function listFilesRecursive(root: string): { size: number; count: number } {
  let size = 0;
  let count = 0;
  const stack = [root];
  while (stack.length) {
    const d = stack.pop()!;
    let children: import("node:fs").Dirent[];
    try {
      children = readdirSync(d, { withFileTypes: true });
    } catch {
      // 受限 / 越权子目录（如 Cursor 沙箱留下的 fonts/font-awesome）无法列举：跳过，
      // 不让一个目录拖垮整个统计 / 部署。
      continue;
    }
    for (const child of children) {
      const full = join(d, child.name);
      if (child.isDirectory()) {
        stack.push(full);
      } else if (child.isFile()) {
        try {
          size += statSync(full).size;
          count++;
        } catch {
          /* 单个文件 stat 失败也跳过 */
        }
      }
    }
  }
  return { size, count };
}

export function listDeployLogs(): DeployLogMeta[] {
  const dir = getLogsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith(".log"))
    .map((name) => {
      const full = join(dir, name);
      const st = statSync(full);
      const m = name.match(/^(.+?)__(.+?)__(\d+)\.log$/);
      return {
        name,
        domain: m?.[1] ?? name,
        host: m?.[2] ?? "",
        mtime: st.mtimeMs,
        sizeBytes: st.size,
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

export function readDeployLog(name: string): { ok: true; content: string } | { ok: false; error: string } {
  const dir = getLogsDir();
  const full = join(dir, name);
  if (!full.startsWith(dir)) return { ok: false, error: "非法日志路径" };
  if (!existsSync(full)) return { ok: false, error: "日志不存在" };
  try {
    return { ok: true, content: readFileSync(full, "utf8") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface DeployStartResult {
  ok: boolean;
  deployId?: string;
  error?: string;
}

export function startDeployTask(cfg: DesktopConfig, input: DeployStartInput): DeployStartResult {
  const domain = input.domain?.trim();
  const host = input.host?.trim();
  if (!domain) return { ok: false, error: "请选择域名" };
  if (!host) return { ok: false, error: "请选择部署目标服务器" };
  if (/[\\/]/.test(domain) || domain.includes("..")) return { ok: false, error: "域名格式无效" };

  const sitesRoot = resolve(getSitesRoot());
  const localDir = normalize(join(sitesRoot, domain));
  if (!existsSync(localDir) || !statSync(localDir).isDirectory()) {
    return { ok: false, error: `站点目录不存在: ${localDir}` };
  }

  const server = resolveDeployServer(cfg, host);
  if (!server) return { ok: false, error: `服务器 ${host} 未在设置中配置 SSH` };
  const missing: string[] = [];
  if (!server.username) missing.push("用户名");
  if (!server.privateKeyPem && !server.privateKeyPath) missing.push("私钥（PEM 或路径）");
  if (missing.length) {
    return { ok: false, error: `服务器 ${host} 缺少：${missing.join("、")}` };
  }

  const deployId = randomUUID();
  const logPath = join(getLogsDir(), logFilename(domain, host));
  const { size: totalBytes, count: totalFiles } = listFilesRecursive(localDir);
  const remoteDir = posix.join(WEB_ROOT, domain);

  appendLog(
    logPath,
    `start domain=${domain} host=${host} files=${totalFiles} bytes=${totalBytes} remote=${remoteDir}`,
  );

  let fileIndex = 0;

  // Delay emit until next tick so the renderer has time to bind `deployId`
  // returned from this synchronous call.
  void (async () => {
    await Promise.resolve();
    emit({
      deployId,
      domain,
      host,
      type: "start",
      totalBytes,
      totalFiles,
      message: `start ${domain} -> ${server.username}@${host}:${remoteDir} (${totalFiles} files, ${totalBytes}B)`,
      ts: Date.now(),
    });
    const r = await deploySiteWithNginx(
      {
        host: server.host,
        port: server.port,
        username: server.username,
        privateKeyPem: server.privateKeyPem || undefined,
        privateKeyPath: server.privateKeyPem ? undefined : server.privateKeyPath || undefined,
        passphrase: server.privateKeyPassphrase,
        localDir,
        domain,
        webRoot: WEB_ROOT,
        nginxSitesEnabledDir: NGINX_SITES_ENABLED_DIR,
      },
      (p) => {
        // 仅「站点文件」计入 X/Y files。nginx 配置（message 形如 "nginx config → …"）
        // 同样走 upload 阶段，但它不在 localDir 的 totalFiles 里，若一并计数就会出现
        // 5/4 这种越界进度。这里按既有约定（与部署详情面板一致）将其排除。
        const isSiteFileUpload =
          p.phase === "upload" && !/nginx config\s*→/.test(p.message ?? "");
        if (isSiteFileUpload) fileIndex = Math.min(fileIndex + 1, totalFiles);
        const ev: DeployEvent = {
          deployId,
          domain,
          host,
          type: p.phase,
          message: p.message,
          filename: p.phase === "upload" ? p.message : undefined,
          bytesUploaded: p.bytesUploaded,
          totalBytes,
          totalFiles,
          fileIndex,
          percent:
            totalBytes > 0 && p.bytesUploaded != null
              ? Math.min(100, Math.round((p.bytesUploaded / totalBytes) * 100))
              : undefined,
          ts: Date.now(),
        };
        emit(ev);
        const sizePart = p.bytesUploaded != null ? ` (${p.bytesUploaded}B)` : "";
        appendLog(logPath, `[${p.phase}] ${p.message ?? ""}${sizePart}`);
      },
    );

    if (r.ok) {
      emit({
        deployId,
        domain,
        host,
        type: "done",
        bytesUploaded: r.bytesUploaded,
        totalBytes,
        totalFiles,
        fileIndex,
        percent: 100,
        message: `done bytes=${r.bytesUploaded} ms=${r.ms}`,
        ts: Date.now(),
      });
      appendLog(logPath, `done bytes=${r.bytesUploaded} ms=${r.ms}`);
    } else {
      emit({
        deployId,
        domain,
        host,
        type: "error",
        error: r.error ?? "deploy failed",
        message: r.error ?? "deploy failed",
        ts: Date.now(),
      });
      appendLog(logPath, `error: ${r.error}`);
    }
  })().catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    emit({ deployId, domain, host, type: "error", error: msg, message: msg, ts: Date.now() });
    appendLog(logPath, `error: ${msg}`);
  });

  return { ok: true, deployId };
}
