/**
 * 网站库 → 本地导出：把 `sites/<domain>/` 整个目录递归复制到用户选定的目标目录下。
 *
 * 设计：
 * - 不打 zip（避免引入新依赖；按 Windows 资源管理器 / macOS Finder 习惯，原样文件夹更友好）。
 * - dialog 选目录由调用方决定是否传入（批量场景共用一次 dialog 即可，逐站不再弹）。
 * - 目标已存在同名目录时，默认在末尾追加数字 `<domain>-1 / -2 ...`，避免覆盖既有内容。
 * - 文件名 / 路径全部经过基础校验（拒绝 ../ 等），防止主进程被诱导写出仓库外。
 */
import { cpSync, existsSync, mkdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { BrowserWindow, dialog } from "electron";
import { isInvalidDomain, resolveSiteDir } from "./siteSafety.js";

export interface ExportSiteResult {
  ok: boolean;
  /** 实际写入的完整目录路径（用户验收 / "在文件管理器中打开"）。 */
  targetPath?: string;
  error?: string;
}

export interface ExportSiteBatchItemResult {
  domain: string;
  ok: boolean;
  targetPath?: string;
  error?: string;
}

export interface ExportSiteBatchResult {
  ok: boolean;
  /** 用户选的根目录；为 undefined 表示用户取消。 */
  targetDir?: string;
  items: ExportSiteBatchItemResult[];
  /** 用户主动取消选目录时 ok=false 且 items=[]，error="已取消"。 */
  error?: string;
}

/**
 * 询问用户选一个目标目录；ownerWin 用于让 dialog 居中在主窗口上。
 * 用户取消返回 undefined。
 */
async function pickTargetDir(ownerWin: BrowserWindow | null): Promise<string | undefined> {
  const opts = {
    title: "选择导出目录",
    properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">,
    buttonLabel: "导出到此处",
  };
  const r = ownerWin
    ? await dialog.showOpenDialog(ownerWin, opts)
    : await dialog.showOpenDialog(opts);
  if (r.canceled || r.filePaths.length === 0) return undefined;
  return r.filePaths[0];
}

/** 若 base/name 已存在，自动加 -1 / -2 直到一个不存在的路径。 */
function uniqueTargetPath(base: string, name: string): string {
  let candidate = join(base, name);
  let i = 1;
  while (existsSync(candidate)) {
    candidate = join(base, `${name}-${i}`);
    i++;
  }
  return candidate;
}

/** 导出单个站点；若 targetDir 不传，则当场弹 dialog。 */
export async function exportSite(
  ownerWin: BrowserWindow | null,
  domain: string,
  targetDir?: string,
): Promise<ExportSiteResult> {
  const d = domain.trim();
  const sourceDir = resolveSiteDir(d);
  if (!sourceDir) return { ok: false, error: `域名无效: ${domain}` };
  if (!existsSync(sourceDir) || !statSync(sourceDir).isDirectory()) {
    return { ok: false, error: `源目录不存在: ${sourceDir}` };
  }

  const base = targetDir?.trim() || (await pickTargetDir(ownerWin));
  if (!base) return { ok: false, error: "已取消" };

  const target = uniqueTargetPath(base, basename(d));
  try {
    mkdirSync(target, { recursive: true });
    cpSync(sourceDir, target, { recursive: true, errorOnExist: false });
    return { ok: true, targetPath: target };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 批量导出多个站点到同一个根目录（一次 dialog 选择 → 串行复制）。 */
export async function exportSitesBatch(
  ownerWin: BrowserWindow | null,
  domains: string[],
  targetDir?: string,
): Promise<ExportSiteBatchResult> {
  const list = domains.map((d) => d.trim()).filter(Boolean);
  if (list.length === 0) return { ok: false, items: [], error: "没有可导出的网站" };

  const base = targetDir?.trim() || (await pickTargetDir(ownerWin));
  if (!base) return { ok: false, items: [], error: "已取消" };

  const items: ExportSiteBatchItemResult[] = [];
  for (const d of list) {
    if (isInvalidDomain(d)) {
      items.push({ domain: d, ok: false, error: "域名无效" });
      continue;
    }
    const r = await exportSite(ownerWin, d, base);
    items.push({ domain: d, ok: r.ok, targetPath: r.targetPath, error: r.error });
  }
  const failed = items.filter((it) => !it.ok).length;
  return { ok: failed === 0, targetDir: base, items };
}
