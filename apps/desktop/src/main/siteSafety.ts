/**
 * 站点目录的统一安全守卫（删除 / 导出 / 查产物 / 建站共用同一把锁）。
 *
 * 两道闸：
 *  - isInvalidDomain：空串 / 含 `/` `\` / 含 `..` 一律拒绝。
 *  - resolveSiteDir：resolve(sitesRoot, domain) + 前缀比对，确保目标只能落在
 *    `sites/` 子目录里，挡掉 symlink / 绝对路径 / 多重 `..` 越权。
 *
 * 之前这两个函数在 siteDelete / siteInfo / siteExport / chat 各有一份且口径略有出入，
 * 收敛到此处避免「几乎相同但不完全一致」的守卫漏防。
 */
import { normalize, resolve, sep, join } from "node:path";
import { getSitesRoot } from "./paths.js";

export function isInvalidDomain(domain: string): boolean {
  return !domain?.trim() || /[\\/]/.test(domain) || domain.includes("..");
}

/**
 * 安全解析 `sites/<domain>` 的绝对路径：
 * - 域名非法 → 返回 null；
 * - 路径越出 sitesRoot → 返回 null（防御 symlink / `..` / 绝对路径绕过）。
 */
export function resolveSiteDir(domain: string): string | null {
  const d = domain.trim();
  if (isInvalidDomain(d)) return null;
  const root = resolve(getSitesRoot());
  const target = normalize(join(root, d));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (!target.startsWith(rootWithSep)) return null;
  return target;
}
