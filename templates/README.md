# templates/ —— 模板目录

每个子目录 = 一个站点模板。**目录名必须是一个有效域名**（如 `adliftlab.com`），因为系统会把它当作"源域名"用来推导关键字替换规则。

## 命名约定

```
templates/
├─ adliftlab.com/        ← 模板目录 = 源域名
│  ├─ index.html         ← 文件里包含 Adliftlab / ADLIFTLAB / adliftlab / adliftlab.com 四种品牌字形态
│  ├─ css/index.css
│  ├─ js/...
│  ├─ img/
│  │  ├─ 1000.png        ← favicon 位（被识别为 logo 槽，会被改写并清掉）
│  │  ├─ 200-50.png      ← header logo 位（同上）
│  │  └─ 200-50_white.png ← header 白色变体（同上）
│  └─ CONSTRAINTS.md     ← 可选，模板设计说明，不会进入成品站
├─ promosprings.com/
└─ ...
```

## 模板批量生成时会发生什么

`apps/desktop/src/main/siteBatch.ts` 里 `prepareSiteFromTemplate({ templateId, domain, outputDir })`：

1. **品牌字替换**（顺序敏感、字面量、区分大小写）：

   假设 `templateId = "adliftlab.com"`，用户输入 `domain = "foo.com"`，按以下顺序对所有文本文件做替换：

   | # | 源 | 目标 |
   |---|---|---|
   | 1 | `adliftlab.com` | `foo.com` |
   | 2 | `ADLIFTLAB` | `FOO` |
   | 3 | `Adliftlab` | `Foo` |
   | 4 | `adliftlab` | `foo` |

   长 key 优先匹配；这样 `adliftlab.com` 不会被 `adliftlab → foo` 切碎成 `foo.com`（虽然结果一致，但保留作为原子规则会让 breakdown 计数更准确）。

   只对文本类后缀生效：`.html .htm .css .js .mjs .cjs .json .txt .md .svg .xml`。其它（PNG/JPG/字体）按二进制原样拷贝。

2. **Logo 路径改写 + 图清理**：

   模板里下列 3 个固定路径全部改写到 `img/logo.svg`（AI 生成的统一位置）：

   - `img/1000.png`
   - `img/200-50.png`
   - `img/200-50_white.png`

   改写完后，把这 3 个 PNG 文件从成品目录删掉（HTML/CSS 已经不再引用它们，避免上传到服务器浪费带宽）。如果模板里没有这些文件就直接跳过删除。

3. **跳过**：

   `CONSTRAINTS.md` 是模板设计说明，不进入成品站点。

4. **AI 生成 Logo**：

   完成上述步骤后，`runTemplateBatch` 调用 `generateDomainLogoSvg`，在 `sites/<新域名>/img/logo.svg` 写入一个专属 SVG —— 跟 HTML 里被改写后的 `src="img/logo.svg"` 对得上。

   ### Logo 规格（参考 "Domain Logo Batch Generator" skill）

   `packages/generator/src/constraints.ts → buildProgrammaticAdLogoHint(domain)` 是注入到 Logo Agent 的设计简报：

   - **画布**：`viewBox="0 0 300 300"`，透明背景，单一 SVG 文件，无外链 `<image>` / `<script>` / webfont；
   - **可见品牌字**：域名 stem（首段 + 保留连字符 + 小写），如 `fluxpilots.com → fluxpilots`、`cloud-cubby.com → cloud-cubby`；
   - **风格**：fashionable / tech-forward / modern / minimal / premium —— 抽象几何符号 + 品牌文本，2-3 色，能同时压在 `#fff` 和深色 header 上；
   - **语义微调**：stem 命中 `cloud / data / flow / forge / growth / ad` 等关键字时，提示词里会自动追加对应视觉方向（cloud → 容器/轨道；data → 节点/网格；flow → 箭头/线路；forge → 块状结构；growth → 上升弧线；ad → 漏斗/同心圆）；
   - **质量底线**：成品要像真实 SaaS / 数据平台 / ad-tech / AI startup 的发布版 logo，不是 placeholder。

   生成后 `logo.ts` 会做一轮硬校验（viewBox / 体积 / 禁止 `<image>` `<foreignObject>` `<script>` / 禁止外链 href / 体积 ≤ 30KB），不达标就让本条域名走失败分支。

## 加新模板的最少步骤

1. 在 `templates/` 下建一个子目录，名字是真实的源域名（用过的站点最理想，本来就含完整品牌字）。
2. 把成品站点丢进去（保留 `index.html`、CSS、JS、`img/` 等子目录）。
3. 如果有 favicon / header logo，统一放到 `img/1000.png`、`img/200-50.png`、`img/200-50_white.png` 路径下；HTML 引用这些路径即可（之后批量模式会自动改写）。
4. 不需要写任何额外的占位符（不再使用 `__DOMAIN__` / `__BRAND__` 这种）。系统从你的目录名 + 文件内容自动推导。

## 不会被替换的内容

- 图片 / 字体 / 二进制等非文本扩展名内容（包括 PNG 里的 EXIF/元数据）；
- 模板内出现的**非源域名品牌字**（例如模板里另写了 `Acme Corp`，不会被改成新品牌；如有这种情况要么把它换掉，要么把模板拆开）；
- 注释、HTML attribute 值、JS 字符串 —— 只要文本里出现就替换，不区分上下文。

## 模板只服务于「模板批量生成」模式

AI 全量模式（`mode: "ai-full"`）**不再读取 `templates/` 下的任何文件**：`runStaticSiteGenerate` 只用 `PROGRAMMATIC_AD_SITE_CONSTRAINTS` + `buildProgrammaticAdLogoHint(domain)` + 用户描述，让 Cursor Agent 在 `sites/<域名>/` 里从零创建 HTML / CSS / JS / `img/logo.svg`，不会偷看本目录。

所以这里加 / 删 / 改模板，只影响「模板批量生成」一条链路。如果哪天把整个 `templates/` 删空，AI 全量模式照常工作，模板批量模式则会在前端报「请填写至少一个域名 / 模板目录为空」。
