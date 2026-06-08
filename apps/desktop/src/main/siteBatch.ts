/**
 * 模板批量建站工具：
 * - 列出 `templates/<id>/` 下可用模板
 * - 按策略（固定 / 随机 / 轮询）为某个域名选择模板
 * - 复制模板到 `sites/<域名>/` 并做关键字替换
 *
 * 替换规则（**模板目录名 = 源域名**）：
 *   假设模板目录是 `templates/adliftlab.com/`，用户输入 `foo.com`：
 *
 *     adliftlab.com   →  foo.com         （完整域名，最先匹配）
 *     ADLIFTLAB       →  FOO             （全大写品牌）
 *     Adliftlab       →  Foo             （首字母大写品牌）
 *     adliftlab       →  foo             （小写品牌 slug，最后匹配，避免吃掉前缀）
 *
 *   并且把模板里固定的 logo 图片路径改写到 AI 生成的 svg：
 *     img/1000.png            →  img/logo.svg
 *     img/200-50.png          →  img/logo.svg
 *     img/200-50_white.png    →  img/logo.svg
 *
 *   改写完后，把 `img/1000.png` / `img/200-50.png` / `img/200-50_white.png`
 *   这三个 PNG 从输出目录删掉（HTML/CSS 已经不再引用，留着白白上传 ~10MB）。
 *
 *   `CONSTRAINTS.md` 视为模板设计说明，不进入成品站，跳过。
 */
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { extname, join, relative } from "node:path";
import { brandTitle, domainSlug } from "@domain-whiz/generator";
import { getTemplatesRoot } from "./paths.js";

export type TemplatePickStrategy = "随机" | "轮询";

const TEXT_EXTS = new Set([
  ".html",
  ".htm",
  ".css",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".txt",
  ".md",
  ".svg",
  ".xml",
]);

/** AI 生成的 logo 在成品站点中的固定路径。 */
export const SITE_LOGO_PATH = "img/logo.svg";

/** 模板里被认为是"logo 位"的 PNG 路径（成品里都会被改写到 SITE_LOGO_PATH 并删掉源文件）。 */
const TEMPLATE_LOGO_FILES = ["img/1000.png", "img/200-50.png", "img/200-50_white.png"];

/** 列出 templates 根目录下所有子目录名（视为可用模板 ID）。 */
export function listAvailableTemplateSources(): string[] {
  const root = getTemplatesRoot();
  try {
    return readdirSync(root)
      .filter((name) => {
        try {
          return statSync(join(root, name)).isDirectory();
        } catch {
          return false;
        }
      })
      .sort();
  } catch {
    return [];
  }
}

/**
 * 根据策略 + 索引为下一个域名挑一个模板。
 * @param templates 可用模板 ID 列表
 * @param index 该批次中的第几个域名（0-based）
 * @param strategy "round-robin" 按顺序循环；"random" 随机
 */
export function pickTemplateForIndex(
  templates: string[],
  index: number,
  strategy: TemplatePickStrategy,
): string | undefined {
  if (templates.length === 0) return undefined;
  if (strategy === "轮询") {
    return templates[index % templates.length];
  }
  return templates[Math.floor(Math.random() * templates.length)];
}

export interface PrepareSiteFromTemplateInput {
  /** 模板目录名（同时被视为"源域名"） */
  templateId: string;
  /** 用户输入的目标域名 */
  domain: string;
  outputDir: string;
}

export interface PrepareSiteFromTemplateResult {
  ok: boolean;
  copied: number;
  skipped: number;
  /** 实际替换发生次数（所有规则 × 所有文本文件） */
  replacements: number;
  /** 每条规则的命中次数（调试 / UI 提示用） */
  breakdown: Record<string, number>;
  /** 删除的 logo 文件相对路径 */
  removedLogoFiles: string[];
  error?: string;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface ReplaceRule {
  key: string;
  from: string;
  to: string;
}

/**
 * 根据源域名（模板目录名）和目标域名构造替换规则。
 * 顺序敏感：完整域名最先、小写品牌最后，避免 `adliftlab.com` 被 `adliftlab` → `foo` 提前
 * 切碎后再无法匹配。
 */
function buildReplaceRules(srcDomain: string, dstDomain: string): ReplaceRule[] {
  const srcBrand = domainSlug(srcDomain);
  const dstBrand = domainSlug(dstDomain);
  const srcTitle = brandTitle(srcDomain);
  const dstTitle = brandTitle(dstDomain);
  const srcUpper = srcBrand.toUpperCase();
  const dstUpper = dstBrand.toUpperCase();

  const rules: ReplaceRule[] = [];

  // 只在两端不同的情况下追加（避免原地替换无意义占满 breakdown）。
  if (srcDomain !== dstDomain) {
    rules.push({ key: srcDomain, from: srcDomain, to: dstDomain });
  }
  if (srcUpper !== dstUpper) {
    rules.push({ key: srcUpper, from: srcUpper, to: dstUpper });
  }
  if (srcTitle !== dstTitle) {
    rules.push({ key: srcTitle, from: srcTitle, to: dstTitle });
  }
  if (srcBrand !== dstBrand) {
    rules.push({ key: srcBrand, from: srcBrand, to: dstBrand });
  }

  // logo 路径硬性收敛到 AI 生成位
  for (const path of TEMPLATE_LOGO_FILES) {
    rules.push({ key: path, from: path, to: SITE_LOGO_PATH });
  }
  return rules;
}

/**
 * 复制 templates/<templateId>/ → outputDir，执行：
 *  1. 文本文件做品牌名 + logo 路径替换
 *  2. 删除 logo PNG（已经没有引用）
 *
 * 跳过 `CONSTRAINTS.md`（模板设计说明，不进入成品）。
 */
export function prepareSiteFromTemplate(
  input: PrepareSiteFromTemplateInput,
): PrepareSiteFromTemplateResult {
  const { templateId, domain, outputDir } = input;
  const templateDir = join(getTemplatesRoot(), templateId);
  try {
    if (!statSync(templateDir).isDirectory()) {
      return failed(`模板不存在: ${templateId}`);
    }
  } catch {
    return failed(`模板不存在: ${templateId}`);
  }

  const rules = buildReplaceRules(templateId, domain);
  let copied = 0;
  let skipped = 0;
  let replacements = 0;
  const breakdown: Record<string, number> = Object.fromEntries(rules.map((r) => [r.key, 0]));

  const applyReplacements = (s: string): string => {
    let out = s;
    for (const rule of rules) {
      const re = new RegExp(escapeRegex(rule.from), "g");
      const hits = out.match(re);
      if (hits) {
        breakdown[rule.key] += hits.length;
        replacements += hits.length;
      }
      out = out.replace(re, rule.to);
    }
    return out;
  };

  const walk = (src: string, dst: string): void => {
    mkdirSync(dst, { recursive: true });
    for (const name of readdirSync(src)) {
      const s = join(src, name);
      const d = join(dst, name);
      const st = statSync(s);
      if (st.isDirectory()) {
        walk(s, d);
        continue;
      }
      const rel = relative(templateDir, s).replace(/\\/g, "/");
      if (rel === "CONSTRAINTS.md") {
        skipped++;
        continue;
      }
      const ext = extname(name).toLowerCase();
      if (TEXT_EXTS.has(ext)) {
        try {
          const content = readFileSync(s, "utf8");
          const replaced = applyReplacements(content);
          writeFileSync(d, replaced, "utf8");
        } catch {
          copyFileSync(s, d);
        }
      } else {
        copyFileSync(s, d);
      }
      copied++;
    }
  };

  try {
    walk(templateDir, outputDir);
  } catch (e) {
    return {
      ok: false,
      copied,
      skipped,
      replacements,
      breakdown,
      removedLogoFiles: [],
      error: e instanceof Error ? e.message : String(e),
    };
  }

  // 删 logo 文件
  const removedLogoFiles: string[] = [];
  for (const rel of TEMPLATE_LOGO_FILES) {
    const full = join(outputDir, rel);
    try {
      if (statSync(full).isFile()) {
        rmSync(full, { force: true });
        removedLogoFiles.push(rel);
      }
    } catch {
      /* 文件不存在就跳过 */
    }
  }

  return { ok: true, copied, skipped, replacements, breakdown, removedLogoFiles };

  function failed(error: string): PrepareSiteFromTemplateResult {
    return {
      ok: false,
      copied: 0,
      skipped: 0,
      replacements: 0,
      breakdown: {},
      removedLogoFiles: [],
      error,
    };
  }
}
