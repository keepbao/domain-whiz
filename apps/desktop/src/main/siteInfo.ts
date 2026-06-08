/**
 * 站点产物信息 + 在系统文件管理器中打开站点目录。
 *
 * 给「历史会话详情」用：
 * - getSiteProducts(domains)：按域名批量返回 { domain, dir, logoDataUrl, hasIndex }，
 *   渲染层据此展示产物缩略图（Logo）+ 本地路径。
 * - revealSiteDir(domain)：在资源管理器 / Finder 里定位到 `sites/<域名>/`。
 *
 * 安全：所有路径都走 resolve + 前缀守卫，只允许命中 `sites/` 子目录，
 * 防御 `../` / 绝对路径 / symlink 越权（与 siteDelete.ts 同款闸门）。
 */
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { shell } from "electron";
import { getSitesRoot } from "./paths.js";
import { pickLogoDataUrl } from "./catalog.js";
import { resolveSiteDir } from "./siteSafety.js";

export interface SiteProduct {
  domain: string;
  /** 站点目录绝对路径（不存在时为 sites/<域名> 的预期路径）。 */
  dir: string;
  /** 产物缩略图（优先 img/logo.svg）；无则 null。 */
  logoDataUrl: string | null;
  /** index.html 是否存在（=站点是否已生成）。 */
  hasIndex: boolean;
  /** 目录是否真实存在于磁盘。 */
  exists: boolean;
}

export function getSiteProducts(domains: string[]): { items: SiteProduct[] } {
  const seen = new Set<string>();
  const items: SiteProduct[] = [];
  for (const raw of domains ?? []) {
    const domain = (raw ?? "").trim();
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    const dir = resolveSiteDir(domain);
    if (!dir) {
      items.push({
        domain,
        dir: join(resolve(getSitesRoot()), domain),
        logoDataUrl: null,
        hasIndex: false,
        exists: false,
      });
      continue;
    }
    const exists = existsSync(dir) && statSync(dir).isDirectory();
    items.push({
      domain,
      dir,
      logoDataUrl: exists ? pickLogoDataUrl(dir) : null,
      hasIndex: exists && existsSync(join(dir, "index.html")),
      exists,
    });
  }
  return { items };
}

export async function revealSiteDir(
  domain: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const target = resolveSiteDir(domain);
  if (!target) return { ok: false, error: `域名无效: ${domain}` };
  if (!existsSync(target)) return { ok: false, error: `目录不存在: ${target}` };
  try {
    const err = await shell.openPath(target);
    if (err) return { ok: false, error: err };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
