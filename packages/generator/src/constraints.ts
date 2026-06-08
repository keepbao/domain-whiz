/** 默认整站约束：程序化广告落地页 + 全英文界面（注入到 AI Prompt）。 */
export const PROGRAMMATIC_AD_SITE_CONSTRAINTS = [
  "Site style: programmatic advertising / performance marketing landing page.",
  "All visible UI copy must be in English only (headings, buttons, labels, body text).",
  "Static HTML + CSS + JS only; relative asset paths; index.html at site root.",
].join("\n");

/**
 * 域名 → 品牌 slug / stem（小写、保留连字符）：取首段。
 *   foo.com         → foo
 *   cloud-cubby.com → cloud-cubby
 *   build-ship.com  → build-ship
 *
 * 这个值同时也是 Logo 里允许出现的"可见品牌字"（无 TLD、无空格）。
 */
export function domainSlug(domain: string): string {
  const d = domain.trim().toLowerCase();
  return d.split(".")[0] ?? d;
}

/** `domainSlug` 的语义别名：当只在"Logo 可见文本"语境下使用时用 `domainStem` 更清楚。 */
export const domainStem = domainSlug;

/** 域名 → 品牌 Title Case：foo.com → Foo（用于页面 H1 / 标题）。 */
export function brandTitle(domain: string): string {
  const s = domainSlug(domain);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** 语义关键字 → 视觉方向提示（用于 Logo Agent 的 light semantic influence）。 */
const SEMANTIC_HINTS: Array<{ test: RegExp; hint: string }> = [
  {
    test: /(cloud|sky|orbit|atlas|nimbus|halo)/i,
    hint: "cloud / orbit theme: soft container forms, clouds, orbits, halos.",
  },
  {
    test: /(data|metric|insight|analyt|stat|graph|node|grid)/i,
    hint: "data / metrics theme: nodes, bars, waves, pulse, geometric grids.",
  },
  {
    test: /(flow|signal|click|stream|route|pulse|beacon)/i,
    hint: "flow / signal theme: arrows, motion lines, routes, rings, channels.",
  },
  {
    test: /(forge|build|ship|craft|kit|yard|nest|raft)/i,
    hint: "forge / build / ship theme: angular forms, structural blocks, momentum, assembly cues.",
  },
  {
    test: /(boost|growth|harbor|spring|reach|lift|summit|peak|vista)/i,
    hint: "growth / momentum theme: rising arcs, upward strokes, layered peaks, expansion rings.",
  },
  {
    test: /(ad|promo|market|brand|funnel|grove)/i,
    hint: "ad-tech / growth theme: funnel cues, concentric targets, channels feeding a focal point.",
  },
];

function pickSemanticHints(stem: string): string[] {
  const hits: string[] = [];
  for (const { test, hint } of SEMANTIC_HINTS) {
    if (test.test(stem)) hits.push(hint);
    if (hits.length >= 2) break;
  }
  return hits;
}

/**
 * Logo Agent 提示词（约束 + 风格指南，注入到 generateDomainLogoSvg 的 prompt）。
 *
 * 参考: "Domain Logo Batch Generator" skill —— 时尚科技 / SaaS / 数据平台 / ad-tech / AI startup
 * 视觉，单 SVG，300×300，抽象符号 + 品牌文本（domain stem，无 TLD）。
 */
export function buildProgrammaticAdLogoHint(domain: string, extra?: string): string {
  const stem = domainStem(domain);
  const semantic = pickSemanticHints(stem);

  const lines: string[] = [
    "GOAL: produce a brand-ready logo SVG suitable for a SaaS product / data platform / ad-tech tool / AI startup.",
    `BRAND TEXT (visible in the mark): "${stem}" — exact lowercase stem, preserve any dashes, no TLD, no spaces.`,
    "",
    "STYLE DIRECTION:",
    "  · Fashionable, tech-forward, modern, minimal, premium.",
    "  · Clean, sharp lines; web / SaaS / AI / data / growth oriented.",
    "  · Composition: abstract geometric symbol on the LEFT or TOP, brand text on the RIGHT or BOTTOM.",
    "  · Visual language to draw from: geometric marks, motion, signal, cloud, pulse, grid, orbit, flow, cube, data, growth.",
    "  · Avoid: cartoon mascots, clutter, heavy skeuomorphism, gradients-on-gradients, low-end clipart, over-detailed illustration, emoji-style.",
  ];

  if (semantic.length > 0) {
    lines.push("", "SEMANTIC HINTS (light influence from the stem, stay abstract):");
    for (const h of semantic) lines.push(`  · ${h}`);
  }

  lines.push(
    "",
    "OUTPUT SPEC (hard rules):",
    "  · Single SVG file at `img/logo.svg` (no extra files, no PNG fallback).",
    "  · Root element: <svg viewBox=\"0 0 300 300\" xmlns=\"http://www.w3.org/2000/svg\"> — square canvas.",
    "  · Transparent background; do not draw a full-canvas filled rect as background.",
    "  · 2-3 colors max from a coherent palette; high contrast; legible on both #ffffff and a dark header (e.g. #0958d9).",
    "  · All shapes inline (path / rect / circle / polygon / line / text); NO external href, NO <image>, NO <foreignObject>, NO <script>.",
    "  · Use system fonts only for the wordmark (font-family=\"Inter, system-ui, sans-serif\") OR draw the wordmark as <path>; never reference webfonts.",
    "  · Final SVG must be valid, human-readable, and under 30KB.",
    "",
    "QUALITY BAR: presentation-ready. The logo must look like it could ship today on the homepage of a real SaaS startup — not a placeholder, not a stock template.",
  );

  if (extra?.trim()) lines.push("", `ADDITIONAL: ${extra.trim()}`);
  return lines.join("\n");
}
