/**
 * 非破坏性的中文恢复脚本（应对 Windows 上编辑器把 UTF-8 中文存成 "?" 的偶发问题）。
 *
 * 背景：本机某些工具在外部改写过文件后再编辑，会把 CJK 字符误存为 ASCII "?"，
 * 导致整文件中文丢失（甚至破坏正则字面量而无法编译）。
 *
 * 本脚本的策略（重要——与旧版完全不同）：
 *   - **绝不**用硬编码模板整体重写文件，因此不会回退任何近期改动；
 *   - 只在「当前文件」里，把被损坏成 "?" 的片段，用最新构建产物（out/renderer/assets/index-*.js）
 *     里的原始中文逐段回填；
 *   - 回填基于「掩码正则」（每个 "?" → 一个非 ASCII 字符）在 bundle 中做唯一匹配，
 *     与行号、位置无关，对结构改动健壮；
 *   - 注释/正则字面量不在 bundle 的字符串里、无法自动恢复，脚本会在结束时
 *     列出仍含 "?" 的可疑行，供人工核对。
 *
 * 用法：
 *   node scripts/restore-buildchat.mjs [目标文件相对路径]
 *   默认目标：apps/desktop/src/renderer/src/BuildChat.tsx
 *
 * 注意：务必先 `npm run build -w @domain-whiz/desktop`（或运行过应用）以保证
 * out/renderer/assets 下的 bundle 是最新的，否则较新的中文可能恢复不全。
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";

const tsx = process.argv[2] || "apps/desktop/src/renderer/src/BuildChat.tsx";
const assetsDir = "apps/desktop/out/renderer/assets";

function latestBundle() {
  const files = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
  if (files.length === 0) throw new Error(`未找到构建产物：${assetsDir}/*.js（请先执行构建）`);
  // 取体积最大的那个 js（通常就是包含全部业务字符串的主 chunk）。
  let best = null;
  for (const f of files) {
    const p = path.join(assetsDir, f);
    const size = readFileSync(p).length;
    if (!best || size > best.size) best = { p, size };
  }
  return best.p;
}

const bundle = readFileSync(latestBundle(), "utf8");
let src = readFileSync(tsx, "utf8");

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function searchUnique(pat) {
  const re = new RegExp(pat, "g");
  const found = new Set();
  let m;
  while ((m = re.exec(bundle)) !== null) {
    found.add(m[1] !== undefined ? m[1] : m[0]);
    if (found.size > 1) break;
  }
  return found.size === 1 ? [...found][0] : null;
}

function recoverSegment(seg) {
  if (!seg.includes("?")) return seg;
  const core = escapeRe(seg).replace(/\\\?/g, "[^\\x00-\\x7F]");
  // 优先匹配「完整字符串字面量/模板片段/JSX 文本」边界内的唯一结果，避免命中更长串的前缀。
  const bounded = searchUnique(`(?<=["'\`\\n{}>])(${core})(?=["'\`\\n{}<]|\\$\\{)`);
  if (bounded != null) return bounded;
  return searchUnique(core);
}

let recovered = 0;
src = src.replace(/(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g, (full, q, body) => {
  if (!body.includes("?")) return full;
  if (q === "`") {
    // 模板字符串：跳过 ${...} 占位（其中的 ? 多为三元/可选链运算符），仅恢复静态片段。
    const parts = body.split(/(\$\{[^}]*\})/);
    let ok = true;
    const rebuilt = parts.map((p) => {
      if (p.startsWith("${") || !p.includes("?")) return p;
      const r = recoverSegment(p);
      if (r != null) return r;
      ok = false;
      return p;
    });
    const next = rebuilt.join("");
    if (ok && next !== body) {
      recovered++;
      return q + next + q;
    }
    return full;
  }
  const r = recoverSegment(body);
  if (r != null && r !== body) {
    recovered++;
    return q + r + q;
  }
  return full;
});

writeFileSync(tsx, src, "utf8");

// 结束报告：列出仍疑似损坏的行，供人工核对（注释/正则无法从 bundle 字符串自动恢复）。
// 仅保守地报告「明显损坏」的特征，避免误报健康的运算符（?? / ?.）与正则（(?:...)? 等）：
//   - 连续 3 个及以上 "?"（CJK 串被整体损坏）
//   - "?" 紧贴引号/JSX 大括号（字符串/文本两端的损坏 CJK）
const lines = src.split(/\r?\n/);
const suspicious = [];
const reSuspicious = /\?{3,}|["'`]\?|\?["'`]|\{"\?|\?"\}/;
lines.forEach((l, i) => {
  if (reSuspicious.test(l)) suspicious.push(`  L${i + 1}: ${l}`);
});

console.log(`已恢复字符串/模板片段：${recovered} 段`);
console.log(`当前中文字符数：${(src.match(/[\u4e00-\u9fff]/g) || []).length}`);
if (suspicious.length) {
  console.log(
    `\n⚠️ 以下 ${suspicious.length} 行仍疑似损坏（注释/正则无法从 bundle 自动恢复，请人工核对）：`,
  );
  console.log(suspicious.join("\n"));
} else {
  console.log("\n✅ 未发现疑似损坏行。");
}
