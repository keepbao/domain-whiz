#!/usr/bin/env node
/**
 * 批量部署脚本（适配自原 bash 部署脚本）
 *
 * 行格式（与原脚本一致，可选第 4 列 username）：
 *     <域名> <远程主机> <私钥路径> [username]
 *
 *   - 以 `#` 开头或空行将被跳过。
 *   - 未显式指定 username 时：远程主机以 `10.` 开头使用 root，否则使用 ubuntu
 *     （沿用原脚本约定）。
 *   - 本地站点目录为 `sites/<域名>/`，不存在则跳过并写入 `.deploy-logs/error.log`。
 *
 * 远端动作（复用 `@domain-whiz/deployer` 的 deploySiteWithNginx）：
 *   - 上传 `sites/<域名>/` 到 `/var/www/<域名>/`
 *   - 写入 nginx site config 到 `/etc/nginx/sites-enabled/<域名>`
 *   - `sudo nginx -t && sudo nginx -s reload`（非 root 自动用 sudo + /tmp 中转）
 *
 * 用法：
 *     npm run deploy:batch                       # 默认读取 scripts/deploy.list.txt
 *     npm run deploy:batch -- path/to/list.txt   # 指定列表文件
 *     node scripts/deploy-batch.mjs my-list.txt
 *
 * 环境变量：
 *     SSH_KEY_PASSPHRASE   私钥统一口令（可选）。
 *     WEB_ROOT             远端站点根，默认 /var/www
 *     NGINX_SITES_DIR      nginx 启用目录，默认 /etc/nginx/sites-enabled
 *     NO_RELOAD=1          上传后不重载 nginx
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

const deployerEntry = join(repoRoot, "packages", "deployer", "dist", "index.js");
if (!existsSync(deployerEntry)) {
  console.error(
    `[fatal] 未找到 ${deployerEntry}\n` +
      `请先构建 deployer：npm run -w @domain-whiz/deployer build`,
  );
  process.exit(2);
}
const { deploySiteWithNginx } = await import(pathToFileURL(deployerEntry).href);

const listArg = process.argv[2] ?? "scripts/deploy.list.txt";
const listPath = isAbsolute(listArg) ? listArg : resolve(repoRoot, listArg);

if (!existsSync(listPath)) {
  console.error(
    `[fatal] 列表文件不存在：${listPath}\n` +
      `可参考示例 scripts/deploy.list.example.txt 创建一份。`,
  );
  process.exit(2);
}

const logDir = join(repoRoot, ".deploy-logs");
mkdirSync(logDir, { recursive: true });
const errorLogPath = join(logDir, "error.log");

function logError(line) {
  const ts = new Date().toISOString();
  appendFileSync(errorLogPath, `[${ts}] ${line}\n`, "utf8");
}

function parseLine(line) {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 3) return null;
  const [domain, host, sshKey, usernameOverride] = parts;
  const username = usernameOverride || (host.startsWith("10.") ? "root" : "ubuntu");
  return { domain, host, sshKey, username };
}

function fmtPct(p) {
  return p == null ? "" : ` ${p.toFixed(1)}%`;
}

const raw = readFileSync(listPath, "utf8");
const entries = raw
  .split(/\r?\n/)
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"))
  .map((l, i) => ({ raw: l, parsed: parseLine(l), lineNo: i + 1 }));

if (entries.length === 0) {
  console.log("[info] 列表为空，无可部署条目。");
  process.exit(0);
}

const webRoot = process.env.WEB_ROOT || "/var/www";
const nginxSitesDir = process.env.NGINX_SITES_DIR || "/etc/nginx/sites-enabled";
const reloadNginx = process.env.NO_RELOAD !== "1";
const passphrase = process.env.SSH_KEY_PASSPHRASE || undefined;

console.log(`[info] 仓库根目录：${repoRoot}`);
console.log(`[info] 列表文件  ：${listPath}`);
console.log(`[info] 待部署条目：${entries.length}`);
console.log("");

let okCount = 0;
let failCount = 0;
let skipCount = 0;
const missingDirs = [];

for (const item of entries) {
  if (!item.parsed) {
    console.warn(`[warn] 第 ${item.lineNo} 行格式不合法，已跳过：${item.raw}`);
    logError(`格式不合法 (line ${item.lineNo}): ${item.raw}`);
    skipCount++;
    continue;
  }
  const { domain, host, sshKey, username } = item.parsed;
  const localDir = join(repoRoot, "sites", domain);

  if (!existsSync(localDir) || !statSync(localDir).isDirectory()) {
    console.warn(`[warn] 本地目录不存在，跳过 ${domain}：${localDir}`);
    logError(`本地目录不存在: ${localDir}`);
    missingDirs.push(localDir);
    skipCount++;
    continue;
  }

  const keyPath = isAbsolute(sshKey) ? sshKey : resolve(repoRoot, sshKey);
  if (!existsSync(keyPath)) {
    console.warn(`[warn] 私钥不存在，跳过 ${domain}：${keyPath}`);
    logError(`私钥不存在 (${domain}): ${keyPath}`);
    skipCount++;
    continue;
  }

  console.log(`──────── ${domain} → ${username}@${host} ────────`);
  const started = Date.now();
  try {
    const result = await deploySiteWithNginx(
      {
        host,
        port: 22,
        username,
        privateKeyPath: keyPath,
        passphrase,
        localDir,
        domain,
        webRoot,
        nginxSitesEnabledDir: nginxSitesDir,
        reloadNginx,
      },
      (p) => {
        const tag = `[${p.phase}]`.padEnd(10);
        const pct = fmtPct(
          p.bytesUploaded != null && p.totalBytes
            ? (p.bytesUploaded / p.totalBytes) * 100
            : undefined,
        );
        process.stdout.write(`  ${tag}${pct} ${p.message}\n`);
      },
    );

    if (result.ok) {
      okCount++;
      const kb = (result.bytesUploaded / 1024).toFixed(1);
      console.log(
        `[ok]   ${domain}：${kb} KB, ${result.ms} ms → ${result.remoteWebPath}`,
      );
    } else {
      failCount++;
      console.error(`[fail] ${domain}：${result.error}`);
      logError(`部署失败 (${domain} @ ${host}): ${result.error}`);
    }
  } catch (e) {
    failCount++;
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[fail] ${domain}：${msg}`);
    logError(`部署异常 (${domain} @ ${host}): ${msg}`);
  } finally {
    console.log(`       耗时 ${Date.now() - started} ms\n`);
  }
}

if (missingDirs.length > 0) {
  appendFileSync(
    errorLogPath,
    `[${new Date().toISOString()}] 缺失本地目录汇总：\n${missingDirs.join("\n")}\n`,
    "utf8",
  );
}

console.log("════════ 部署汇总 ════════");
console.log(`  成功 ${okCount} / 失败 ${failCount} / 跳过 ${skipCount}`);
if (failCount > 0 || skipCount > 0) {
  console.log(`  详细错误：${errorLogPath}`);
}

process.exit(failCount > 0 ? 1 : 0);
