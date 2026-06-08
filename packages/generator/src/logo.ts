import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { buildProgrammaticAdLogoHint, domainStem } from "./constraints.js";
import { runAgentTask } from "./agentRun.js";

export interface GenerateLogoOptions {
  apiKey?: string;
  modelId?: string;
  /** 完整域名（含 TLD），用于派生品牌 stem 和文件名上下文。 */
  domain: string;
  /** 站点根目录，将写入 `img/logo.svg`。 */
  siteRoot: string;
  /** 额外风格提示（追加到默认约束之后）。 */
  brandHint?: string;
  onLog?: (line: string) => void;
  signal?: AbortSignal;
}

const MIN_SVG_BYTES = 200;

/**
 * 用 Cursor Agent 在站点目录内生成 `img/logo.svg`（300×300 矢量 Logo）。
 *
 * 规格参考 "Domain Logo Batch Generator" skill：
 *   - 时尚科技 / SaaS / 数据平台 / ad-tech / AI startup 视觉
 *   - 抽象几何符号 + 品牌文本（domain stem）
 *   - 单 SVG，viewBox 300×300，透明背景，2-3 色
 *
 * 仅这一个文件被允许修改，不触碰其它任何模板内容。
 */
export async function generateDomainLogoSvg(
  opts: GenerateLogoOptions,
): Promise<{ ok: boolean; error?: string }> {
  const { domain, siteRoot, onLog, signal, brandHint } = opts;
  const imgDir = join(siteRoot, "img");
  mkdirSync(imgDir, { recursive: true });
  const logoRel = "img/logo.svg";
  const stem = domainStem(domain);

  const styleHint = brandHint?.trim() || buildProgrammaticAdLogoHint(domain);

  const prompt = [
    `You are a senior brand designer at a digital tech studio.`,
    `Produce ONE logo SVG for the brand whose domain is "${domain}" (stem = "${stem}").`,
    `Working directory: ${siteRoot}`,
    `You MUST create or overwrite ONLY this file: ${logoRel}`,
    `Do not touch index.html, any other HTML, CSS, JS, or any other asset under ${siteRoot}.`,
    "",
    "重要：所有说明性文字（设计思路、配色解释、操作步骤、检查清单复述等）一律用【简体中文】回复；",
    `只有写入 ${logoRel} 的 SVG 代码本身保持英文/原样（其中可见品牌字仍是 "${stem}"）。`,
    "",
    "DESIGN BRIEF AND CONSTRAINTS:",
    styleHint,
    "",
    "FINAL CHECK BEFORE WRITING THE FILE:",
    `  1. The SVG must contain visible text matching exactly "${stem}" (lowercase, no TLD).`,
    "  2. The viewBox must be \"0 0 300 300\".",
    "  3. No <image>, <foreignObject>, <script>, or external href references.",
    "  4. Background must be transparent (no full-canvas filled rect).",
    "  5. 2-3 colors max, looks crisp at 36-72px display height.",
  ].join("\n");

  const r = await runAgentTask({
    apiKey: opts.apiKey,
    modelId: opts.modelId,
    cwd: siteRoot,
    prompt,
    onLog,
    signal,
    startLog: `生成 Logo：${domain}（品牌字 ${stem}）…`,
    label: "Logo Agent",
  });
  if (!r.ok) return r;

  const logoPath = join(siteRoot, "img", "logo.svg");
  if (!existsSync(logoPath) || statSync(logoPath).size < MIN_SVG_BYTES) {
    return { ok: false, error: `未生成有效 ${logoRel}（文件不存在或体积过小）` };
  }
  const v = validateLogoSvg(logoPath);
  if (!v.ok) {
    return { ok: false, error: `${logoRel} 校验失败：${v.errors.join("; ")}` };
  }
  return { ok: true };
}

/** 轻量校验：避免 Agent 写出残缺 / 含外链的 SVG。 */
function validateLogoSvg(path: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  try {
    const txt = readFileSync(path, "utf8");
    if (!/^<\?xml[^>]*\?>\s*<svg[\s>]/m.test(txt) && !/^\s*<svg[\s>]/.test(txt)) {
      errors.push("不是合法 SVG（缺少 <svg> 根元素）");
    }
    if (!/viewBox\s*=\s*["']\s*0\s+0\s+300\s+300\s*["']/.test(txt)) {
      errors.push('viewBox 不是 "0 0 300 300"');
    }
    if (/<image[\s>]/i.test(txt)) errors.push("禁止使用 <image>");
    if (/<foreignObject[\s>]/i.test(txt)) errors.push("禁止使用 <foreignObject>");
    if (/<script[\s>]/i.test(txt)) errors.push("禁止使用 <script>");
    if (/href\s*=\s*["']https?:/i.test(txt) || /xlink:href\s*=\s*["']https?:/i.test(txt)) {
      errors.push("禁止外链 href");
    }
    if (txt.length > 30 * 1024) errors.push("体积超过 30KB");
    return { ok: errors.length === 0, errors };
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)] };
  }
}
