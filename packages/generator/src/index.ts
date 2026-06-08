import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildProgrammaticAdLogoHint } from "./constraints.js";
import { runAgentTask } from "./agentRun.js";

export {
  PROGRAMMATIC_AD_SITE_CONSTRAINTS,
  buildProgrammaticAdLogoHint,
  domainSlug,
  domainStem,
  brandTitle,
} from "./constraints.js";
export { generateDomainLogoSvg, type GenerateLogoOptions } from "./logo.js";

export interface GenerateOptions {
  apiKey?: string;
  modelId?: string;
  /** 完整域名（含 TLD），用于生成品牌字 / Logo / 文件名上下文。 */
  domain: string;
  /** 用户的中文需求描述（落地页主题、卖点、CTA 等）。 */
  userGoals: string;
  /** 站点输出目录（`sites/<域名>/`）。 */
  outputDir: string;
  onLog: (line: string) => void;
  signal?: AbortSignal;
  /** 为 true 时 `outputDir` 已是成品静态站；强调就地增量修改、保持相对资源有效。 */
  editExistingSite?: boolean;
  /** 追加在 userGoals 前的整站约束（如程序化广告、全英文） */
  siteStyleConstraints?: string;
  /** Cursor SDK 关联回调（用于上层把 agentId/runId 写入聊天历史，便于以后用 Agent.getRun 复盘）。 */
  onAgentId?: (agentId: string) => void;
  onRunId?: (runId: string) => void;
}

/**
 * FR-3.3: ensure index.html exists and linked relative assets exist.
 */
export function validateStaticSite(siteRoot: string): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const indexPath = join(siteRoot, "index.html");
  if (!existsSync(indexPath)) {
    errors.push("缺少 index.html");
    return { ok: false, errors };
  }
  let html: string;
  try {
    html = readFileSync(indexPath, "utf8");
  } catch (e) {
    errors.push(`无法读取 index.html: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, errors };
  }

  const refs = extractRelativeRefs(html);
  for (const ref of refs) {
    const target = resolve(siteRoot, ref);
    if (!existsSync(target)) {
      errors.push(`index.html 引用缺失: ${ref}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

function extractRelativeRefs(html: string): string[] {
  const out = new Set<string>();
  const attr = /(?:href|src)=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = attr.exec(html)) !== null) {
    const u = m[1].trim();
    if (!u || u.startsWith("data:") || u.startsWith("http:") || u.startsWith("https:") || u.startsWith("//"))
      continue;
    if (u.startsWith("#") || u.startsWith("mailto:")) continue;
    const pathOnly = u.split("?")[0].split("#")[0];
    if (pathOnly.startsWith("/")) continue;
    out.add(pathOnly);
  }
  return [...out];
}

function buildSystemPrompt(domain: string): string {
  const logoHint = buildProgrammaticAdLogoHint(domain);
  return [
    "你是一名资深前端 / 品牌设计师，正在为单个域名生成一个独立的纯静态落地页。",
    `目标域名: ${domain}`,
    "",
    "硬性产物要求：",
    "  · 只产出纯静态资源：HTML + CSS + JS + 图片（SVG / PNG / WebP 均可），不引入任何 npm 构建链、不引入 React/Vue 等运行时框架。",
    "  · 入口必须是 `index.html`，位于站点根目录。所有 `href` / `src` 引用必须是相对路径，且对应的文件必须真实存在于输出目录里。",
    "  · 不要参考或依赖任何外部模板目录；本任务完全从约束 + 用户需求出发自由设计。",
    "  · 目录结构清晰即可（推荐：`index.html` / `css/` / `js/` / `img/`），不强制具体子目录名。",
    "  · 不要使用 webfont（如 Google Fonts CDN）；字体一律用 `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif` 这种系统栈。",
    "",
    "Logo 必须就地生成为 `img/logo.svg`，遵守以下设计简报：",
    logoHint,
  ].join("\n");
}

export async function runStaticSiteGenerate(opts: GenerateOptions): Promise<{ ok: boolean; error?: string }> {
  const { domain, userGoals, outputDir, onLog, signal, editExistingSite, siteStyleConstraints } = opts;
  if (!domain?.trim()) return { ok: false, error: "缺少 domain" };

  const outInstructions = editExistingSite
    ? [
        `当前工作目录已经是成品静态站（根路径: ${outputDir}）。请仅按用户说明做必要的增量修改。`,
        "不要无故删除整站或大面积重写，除非用户明确要求；保持 index.html 与相对 href/src 资源均可解析。",
        "如果用户要求改 Logo，仅重写 `img/logo.svg`，不要碰其它 PNG。",
      ].join("\n")
    : [
        `请将完整静态站点（含 \`img/logo.svg\`）写入目录: ${outputDir}`,
        "从零设计；先建好目录结构，再写文件。最终必须能在浏览器直接打开 `index.html` 看到完整页面。",
      ].join("\n");

  const prompt = [
    buildSystemPrompt(domain),
    "",
    ...(siteStyleConstraints?.trim()
      ? ["整站风格约束（必须遵守）:", siteStyleConstraints.trim(), ""]
      : []),
    "用户目标（中文需求描述）:",
    userGoals,
    "",
    outInstructions,
  ].join("\n");

  const r = await runAgentTask({
    apiKey: opts.apiKey,
    modelId: opts.modelId,
    cwd: outputDir,
    prompt,
    onLog,
    signal,
    startLog: "Agent.send: 开始生成…",
    label: "Agent",
    onAgentId: opts.onAgentId,
    onRunId: opts.onRunId,
  });
  if (!r.ok) return r;

  const v = validateStaticSite(outputDir);
  if (!v.ok) {
    return { ok: false, error: v.errors.join("; ") };
  }
  return { ok: true };
}
