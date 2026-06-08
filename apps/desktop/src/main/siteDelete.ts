/**
 * 网站库 → 本地删除：把 `sites/<domain>/` 整个目录从磁盘移除。
 *
 * 设计要点：
 * - 只允许删除「生成站点 sites/」下的子目录，**严禁** 触碰 templates/（模板是只读资产）。
 * - 域名必须是 sitesRoot 的直接子目录；用 `resolve` + 前缀比对挡掉 `../` / 绝对路径越权。
 * - 一律走 `fs.rm({ recursive, force })`，目录不存在时不报错——幂等更友好。
 */
import { existsSync, statSync } from "node:fs";
import { resolveSiteDir } from "./siteSafety.js";
import { forceRemoveDir } from "./siteRemove.js";

export interface DeleteSiteResult {
  ok: boolean;
  /** 实际被删除的完整目录路径（便于日志 / 调试）。 */
  targetPath?: string;
  error?: string;
}

export interface DeleteSiteBatchItemResult {
  domain: string;
  ok: boolean;
  targetPath?: string;
  error?: string;
}

export interface DeleteSiteBatchResult {
  ok: boolean;
  items: DeleteSiteBatchItemResult[];
}

export function deleteSite(domain: string): DeleteSiteResult {
  const target = resolveSiteDir(domain);
  if (!target) return { ok: false, error: `域名无效: ${domain}` };
  try {
    if (!existsSync(target)) {
      // 幂等：调用方往往已经基于过时列表请求删除，目录早就没了也算成功。
      return { ok: true, targetPath: target };
    }
    if (!statSync(target).isDirectory()) {
      return { ok: false, error: `非目录: ${target}` };
    }
    // 强力删除：重试 →（Windows 受限 ACL 时）takeown+icacls 拿回权限再删 → 复核。
    forceRemoveDir(target);
    return { ok: true, targetPath: target };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function deleteSitesBatch(domains: string[]): DeleteSiteBatchResult {
  const list = Array.from(new Set((domains ?? []).map((d) => d.trim()).filter(Boolean)));
  const items: DeleteSiteBatchItemResult[] = list.map((d) => {
    const r = deleteSite(d);
    return { domain: d, ok: r.ok, targetPath: r.targetPath, error: r.error };
  });
  const failed = items.filter((it) => !it.ok).length;
  return { ok: failed === 0, items };
}
