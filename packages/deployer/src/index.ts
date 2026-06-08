import SftpClient from "ssh2-sftp-client";
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";

export interface SshDeployConfig {
  host: string;
  port?: number;
  username: string;
  privateKeyPath?: string;
  privateKeyPem?: string;
  remoteBasePath: string;
  localDir: string;
  deleteRemoteExtra?: boolean;
  passphrase?: string;
}

export interface DeployProgress {
  phase: "connect" | "upload" | "delete_extra" | "apply" | "done";
  message: string;
  bytesUploaded?: number;
}

export interface DeployResult {
  ok: boolean;
  remoteSummary: string;
  bytesUploaded: number;
  ms: number;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function listFilesRecursive(root: string, base = root): string[] {
  void base;
  const out: string[] = [];
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    // 受限 / 越权子目录（如 Cursor 沙箱留下的 fonts/font-awesome）无法列举：跳过该子树，
    // 不让一个目录中断整次上传。
    return out;
  }
  for (const name of entries) {
    const full = join(root, name.name);
    if (name.isDirectory()) {
      out.push(...listFilesRecursive(full, base));
    } else if (name.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function classifySshError(err: unknown): string {
  if (!err) return "未知错误";
  const m = err instanceof Error ? err.message : String(err);
  if (/ENOENT|no such file/i.test(m)) return "私钥路径不存在或不可读。";
  if (/passphrase|encrypted/i.test(m)) return "私钥需要口令：请设置环境变量 SSH_KEY_PASSPHRASE（或文档中的等价名）。";
  if (/handshake|host key|known_hosts/i.test(m)) return "主机密钥校验失败：请检查 known_hosts 或主机是否变更。";
  if (/Authentication|auth fail|All configured authentication/i.test(m)) return "认证失败：用户名、私钥或口令不正确。";
  if (/Permission denied/i.test(m)) return "权限被拒绝：请检查远端目录权限。";
  return m.replace(/-----BEGIN[\s\S]*?-----END[^-]+-----/g, "[REDACTED_KEY]");
}

function quoteShell(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

function randomTag(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

interface RemoteExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runRemoteCmd(client: SftpClient, cmd: string): Promise<RemoteExecResult> {
  const inner = (client as unknown as { client?: { exec?: Function } }).client;
  if (!inner || typeof inner.exec !== "function") {
    throw new Error("SFTP 客户端缺少底层 ssh2 Client，无法执行远端命令。");
  }
  return new Promise<RemoteExecResult>((resolveCb, rejectCb) => {
    inner.exec!(cmd, (err: Error | null, stream: NodeJS.ReadableStream & { stderr: NodeJS.ReadableStream }) => {
      if (err) return rejectCb(err);
      let stdout = "";
      let stderr = "";
      stream.on("data", (d: Buffer) => {
        stdout += d.toString("utf8");
      });
      stream.stderr.on("data", (d: Buffer) => {
        stderr += d.toString("utf8");
      });
      stream.on("close", (code: number) => {
        resolveCb({ code: code ?? 0, stdout, stderr });
      });
    });
  });
}

/* ------------------------------------------------------------------ */
/* 通用：上传目录（保留旧 API）                                          */
/* ------------------------------------------------------------------ */

export async function deployDirectory(
  cfg: SshDeployConfig,
  onProgress?: (p: DeployProgress) => void,
): Promise<DeployResult> {
  const started = Date.now();
  const hasPem = Boolean(cfg.privateKeyPem?.trim());
  const hasPath = Boolean(cfg.privateKeyPath && existsSync(cfg.privateKeyPath));
  if (!hasPem && !hasPath) {
    return {
      ok: false,
      remoteSummary: cfg.remoteBasePath,
      bytesUploaded: 0,
      ms: Date.now() - started,
      error: "缺少 SSH 私钥：请提供私钥文件路径或 PEM 文本。",
    };
  }
  let attempt = 0;
  const maxAttempts = 2;
  let lastErr: unknown;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      return await deployDirectoryOnce(cfg, onProgress, started);
    } catch (e) {
      lastErr = e;
      if (attempt >= maxAttempts) break;
      onProgress?.({ phase: "connect", message: "上传失败，1.5s 后重试一次…" });
      await sleep(1500);
    }
  }

  return {
    ok: false,
    remoteSummary: cfg.remoteBasePath,
    bytesUploaded: 0,
    ms: Date.now() - started,
    error: classifySshError(lastErr),
  };
}

async function deployDirectoryOnce(
  cfg: SshDeployConfig,
  onProgress: ((p: DeployProgress) => void) | undefined,
  started: number,
): Promise<DeployResult> {
  const client = new SftpClient();
  let bytesUploaded = 0;
  const remoteRoot = posix.join(cfg.remoteBasePath.replace(/\\/g, "/"));

  onProgress?.({ phase: "connect", message: `连接 ${cfg.host}:${cfg.port ?? 22} …` });

  const privateKey =
    cfg.privateKeyPem?.trim() ||
    (cfg.privateKeyPath ? readFileSync(cfg.privateKeyPath, "utf8") : "");
  if (!privateKey) throw new Error("缺少 SSH 私钥");
  await client.connect({
    host: cfg.host,
    port: cfg.port ?? 22,
    username: cfg.username,
    privateKey,
    passphrase: cfg.passphrase,
  });

  try {
    await client.mkdir(remoteRoot, true).catch(() => undefined);
    const files = listFilesRecursive(cfg.localDir);
    const uploadedRel = new Set<string>();
    for (const abs of files) {
      const rel = toPosix(relative(cfg.localDir, abs));
      const remotePath = posix.join(remoteRoot, rel);
      await client.mkdir(posix.dirname(remotePath), true).catch(() => undefined);
      const st = statSync(abs);
      await client.fastPut(abs, remotePath);
      bytesUploaded += st.size;
      uploadedRel.add(rel);
      onProgress?.({ phase: "upload", message: rel, bytesUploaded });
    }
    // if (cfg.deleteRemoteExtra) {
    //   onProgress?.({ phase: "delete_extra", message: "扫描并删除远端多余文件…" });
    //   await deleteRemoteExtras(client, remoteRoot, uploadedRel, onProgress);
    // }
    onProgress?.({ phase: "done", message: "完成", bytesUploaded });
    return {
      ok: true,
      remoteSummary: remoteRoot,
      bytesUploaded,
      ms: Date.now() - started,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function deleteRemoteExtras(
  client: SftpClient,
  remoteRoot: string,
  uploadedRel: Set<string>,
  onProgress?: (p: DeployProgress) => void,
): Promise<void> {
  const walk = async (rdir: string): Promise<void> => {
    const list = await client.list(rdir);
    for (const ent of list) {
      const full = posix.join(rdir, ent.name);
      const rel = posix.relative(remoteRoot, full);
      if (ent.type === "d") {
        await walk(full);
        const stillHas = (await client.list(full).catch(() => [])).length > 0;
        if (!stillHas) await client.rmdir(full, true).catch(() => undefined);
      } else if (ent.type === "-") {
        if (!uploadedRel.has(rel)) {
          onProgress?.({ phase: "delete_extra", message: `删除远端多余: ${rel}` });
          await client.delete(full).catch(() => undefined);
        }
      }
    }
  };
  await walk(remoteRoot);
}

/* ------------------------------------------------------------------ */
/* 新流程：上传站点 + 写 nginx site config + 远端 sudo mv / reload          */
/* ------------------------------------------------------------------ */

export interface DeploySiteConfig {
  host: string;
  port?: number;
  username: string;
  privateKeyPath?: string;
  privateKeyPem?: string;
  passphrase?: string;

  /** 本地站点目录（递归上传整目录）。 */
  localDir: string;
  /** 域名，用于 nginx `server_name` / 远端 web 目录名 / nginx conf 文件名。 */
  domain: string;

  /** 静态资源根目录，默认 `/var/www`。最终站点会落到 `<webRoot>/<domain>/`。 */
  webRoot?: string;
  /** Nginx 启用站点目录，默认 `/etc/nginx/sites-enabled`。配置文件名 = domain。 */
  nginxSitesEnabledDir?: string;
  /** server_name 别名列表；默认 `[domain, "www." + domain]`。 */
  serverNameAliases?: string[];
  /** 显式覆盖是否使用 sudo；默认 username !== "root" 即用 sudo + /tmp 中转。 */
  useSudo?: boolean;
  /** 部署完成后是否重载 nginx；默认 true。 */
  reloadNginx?: boolean;
}

export interface DeploySiteResult {
  ok: boolean;
  remoteWebPath: string;
  remoteConfPath: string;
  bytesUploaded: number;
  ms: number;
  error?: string;
}

function renderNginxConfig(opts: { serverNames: string; webPath: string }): string {
  return [
    "server {",
    "    listen 80;",
    "    listen [::]:80;",
    "",
    `    server_name ${opts.serverNames};`,
    "",
    `    root ${opts.webPath};`,
    "    index index.html;",
    "",
    "    location / {",
    "        try_files $uri $uri/ =404;",
    "    }",
    "}",
    "",
  ].join("\n");
}

interface DeploySiteCtx {
  webRoot: string;
  confDir: string;
  useSudo: boolean;
  reloadNginx: boolean;
  serverNames: string;
  finalWebPath: string;
  finalConfPath: string;
  tmpWebPath: string;
  tmpConfPath: string;
  started: number;
}

export async function deploySiteWithNginx(
  cfg: DeploySiteConfig,
  onProgress?: (p: DeployProgress) => void,
): Promise<DeploySiteResult> {
  const started = Date.now();
  const hasPem = Boolean(cfg.privateKeyPem?.trim());
  const hasPath = Boolean(cfg.privateKeyPath && existsSync(cfg.privateKeyPath));
  if (!hasPem && !hasPath) {
    return {
      ok: false,
      remoteWebPath: "",
      remoteConfPath: "",
      bytesUploaded: 0,
      ms: Date.now() - started,
      error: "缺少 SSH 私钥：请提供私钥文件路径或 PEM 文本。",
    };
  }
  const domain = cfg.domain?.trim();
  if (!domain) {
    return {
      ok: false,
      remoteWebPath: "",
      remoteConfPath: "",
      bytesUploaded: 0,
      ms: Date.now() - started,
      error: "缺少域名。",
    };
  }

  const webRoot = (cfg.webRoot?.trim() || "/var/www").replace(/\\/g, "/").replace(/\/+$/, "");
  const confDir = (cfg.nginxSitesEnabledDir?.trim() || "/etc/nginx/sites-enabled")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  const useSudo = cfg.useSudo ?? cfg.username.trim().toLowerCase() !== "root";
  const reloadNginx = cfg.reloadNginx ?? true;
  const serverNames = (cfg.serverNameAliases?.length
    ? cfg.serverNameAliases
    : [domain, `www.${domain}`]
  ).join(" ");

  const tag = randomTag();
  const ctx: DeploySiteCtx = {
    webRoot,
    confDir,
    useSudo,
    reloadNginx,
    serverNames,
    finalWebPath: posix.join(webRoot, domain),
    finalConfPath: posix.join(confDir, domain),
    tmpWebPath: posix.join("/tmp", `dwz-${domain}-${tag}`),
    tmpConfPath: posix.join("/tmp", `dwz-${domain}-${tag}.conf`),
    started,
  };

  let attempt = 0;
  const maxAttempts = 2;
  let lastErr: unknown;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      return await deploySiteOnce(cfg, ctx, onProgress);
    } catch (e) {
      lastErr = e;
      if (attempt >= maxAttempts) break;
      onProgress?.({ phase: "connect", message: "部署失败，1.5s 后重试一次…" });
      await sleep(1500);
    }
  }
  return {
    ok: false,
    remoteWebPath: ctx.finalWebPath,
    remoteConfPath: ctx.finalConfPath,
    bytesUploaded: 0,
    ms: Date.now() - started,
    error: classifySshError(lastErr),
  };
}

async function deploySiteOnce(
  cfg: DeploySiteConfig,
  ctx: DeploySiteCtx,
  onProgress?: (p: DeployProgress) => void,
): Promise<DeploySiteResult> {
  const client = new SftpClient();
  let bytesUploaded = 0;

  const privateKey =
    cfg.privateKeyPem?.trim() ||
    (cfg.privateKeyPath ? readFileSync(cfg.privateKeyPath, "utf8") : "");
  if (!privateKey) throw new Error("缺少 SSH 私钥");

  onProgress?.({ phase: "connect", message: `连接 ${cfg.host}:${cfg.port ?? 22} …` });
  await client.connect({
    host: cfg.host,
    port: cfg.port ?? 22,
    username: cfg.username,
    privateKey,
    passphrase: cfg.passphrase,
  });

  try {
    const nginxConfig = renderNginxConfig({
      serverNames: ctx.serverNames,
      webPath: ctx.finalWebPath,
    });

    const uploadDir = ctx.useSudo ? ctx.tmpWebPath : ctx.finalWebPath;
    const uploadConfPath = ctx.useSudo ? ctx.tmpConfPath : ctx.finalConfPath;
 
    onProgress?.({ phase: "connect", message: `准备远端目录 ${uploadDir}` });
    await client.mkdir(uploadDir, true).catch(() => undefined);
    if (!ctx.useSudo) {
      await client.mkdir(ctx.confDir, true).catch(() => undefined);
    }

    const files = listFilesRecursive(cfg.localDir);
    for (const abs of files) {
      const rel = toPosix(relative(cfg.localDir, abs));
      const remotePath = posix.join(uploadDir, rel);
      await client.mkdir(posix.dirname(remotePath), true).catch(() => undefined);
      const st = statSync(abs);
      await client.fastPut(abs, remotePath);
      bytesUploaded += st.size;
      onProgress?.({ phase: "upload", message: rel, bytesUploaded });
    }

    onProgress?.({
      phase: "upload",
      message: `nginx config → ${uploadConfPath}`,
      bytesUploaded,
    });
    await client.put(Buffer.from(nginxConfig, "utf8"), uploadConfPath);
    bytesUploaded += Buffer.byteLength(nginxConfig, "utf8");

    const sudo = ctx.useSudo ? "sudo " : "";
    const commands: string[] = [];

    if (ctx.useSudo) {
      commands.push(
        `${sudo}mkdir -p ${quoteShell(ctx.webRoot)} ${quoteShell(ctx.confDir)}`,
      );
      commands.push(`${sudo}rm -rf ${quoteShell(ctx.finalWebPath)}`);
      commands.push(
        `${sudo}mv ${quoteShell(ctx.tmpWebPath)} ${quoteShell(ctx.finalWebPath)}`,
      );
      commands.push(
        `${sudo}chown -R root:root ${quoteShell(ctx.finalWebPath)}`,
      );
      commands.push(
        `${sudo}mv ${quoteShell(ctx.tmpConfPath)} ${quoteShell(ctx.finalConfPath)}`,
      );
      commands.push(
        `${sudo}chown root:root ${quoteShell(ctx.finalConfPath)}`,
      );
    }

    if (ctx.reloadNginx) {
      commands.push(`${sudo}nginx -t`);
      commands.push(`${sudo}nginx -s reload`);
    }

    for (const cmd of commands) {
      onProgress?.({ phase: "apply", message: cmd });
      const res = await runRemoteCmd(client, cmd);
      if (res.code !== 0) {
        const tail = (res.stderr || res.stdout || "").trim().split(/\r?\n/).slice(-6).join("\n");
        throw new Error(`远端命令失败 (exit=${res.code}): ${cmd}\n${tail}`);
      }
    }

    onProgress?.({ phase: "done", message: "完成", bytesUploaded });
    return {
      ok: true,
      remoteWebPath: ctx.finalWebPath,
      remoteConfPath: ctx.finalConfPath,
      bytesUploaded,
      ms: Date.now() - ctx.started,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
}
