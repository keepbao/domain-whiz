/**
 * AI 对话建站（两种模式）：
 *  - `ai-full`：单域名，Cursor Agent 在 `sites/<域名>/` 完全从零生成静态站点（不参考模板）
 *  - `template-batch`：多域名，按策略复制模板 + 关键字替换 + AI 仅生成 Logo
 * 中间日志通过 webContents 广播 `chat:chunk` 给前端流式展示。
 */
import { existsSync, mkdirSync } from "node:fs";
import { join, normalize, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  PROGRAMMATIC_AD_SITE_CONSTRAINTS,
  generateDomainLogoSvg,
  runStaticSiteGenerate,
} from "@domain-whiz/generator";
import type { DesktopConfig } from "./config.js";
import { getSitesRoot } from "./paths.js";
import {
  listAvailableTemplateSources,
  pickTemplateForIndex,
  prepareSiteFromTemplate,
  SITE_LOGO_PATH,
  type TemplatePickStrategy,
} from "./siteBatch.js";
import { getChatHistoryService } from "./chatHistoryStore.js";
import { isInvalidDomain } from "./siteSafety.js";
import { forceRemoveDir, findInaccessiblePath } from "./siteRemove.js";

export type BuildMode = "ai-full" | "template-batch";

export interface ChatRunInput {
  /** 建站模式，默认 `ai-full`。 */
  mode?: BuildMode;
  // ---- ai-full ----
  domain?: string;
  message?: string;
  /** 显式指定首轮（覆盖「sites/<域名>/index.html 是否存在」的自动判断）。 */
  firstTurn?: boolean;
  // ---- template-batch ----
  /** 批量域名列表 */
  domains?: string[];
  /** 若设置则全部用该模板；否则按 templatePick 策略 */
  fixedVariant?: string;
  /** 当 fixedVariant 未设置时的挑选策略，默认 round-robin */
  templatePick?: TemplatePickStrategy;
}

export interface ChatChunk {
  taskId: string;
  type: "text" | "info" | "error" | "done";
  text?: string;
}

export interface ChatRunResult {
  ok: boolean;
  taskId?: string;
  outputDir?: string;
  /** 模板批量模式返回处理结果摘要 */
  batch?: {
    total: number;
    succeeded: number;
    failed: number;
    items: Array<{ domain: string; templateId: string; ok: boolean; error?: string }>;
  };
  error?: string;
}

export type ChatStreamListener = (c: ChatChunk) => void;
const streamListeners = new Set<ChatStreamListener>();

export function addChatStreamListener(fn: ChatStreamListener): () => void {
  streamListeners.add(fn);
  return () => {
    streamListeners.delete(fn);
  };
}

function emit(c: ChatChunk): void {
  // 同步追加到聊天历史持久层（debounce 写盘）
  try {
    getChatHistoryService().appendChunk(c.taskId, {
      type: c.type,
      text: c.text ?? "",
      ts: Date.now(),
    });
  } catch {
    /* 历史持久化失败不影响主流程 */
  }
  for (const fn of streamListeners) {
    try {
      fn(c);
    } catch {
      /* listener errors are not fatal */
    }
  }
}

export async function runChatTurn(
  cfg: DesktopConfig,
  input: ChatRunInput,
  signal: AbortSignal,
): Promise<ChatRunResult> {
  const apiKey = cfg.cursorApiKey?.trim() || process.env.CURSOR_API_KEY;
  if (!apiKey) return { ok: false, error: "请先在「设置」中填写 Cursor API Key。" };

  const mode: BuildMode = input.mode ?? "ai-full";
  if (mode === "template-batch") {
    return runTemplateBatch(apiKey, input, signal);
  }
  return runAiFullTurn(apiKey, input, signal);
}

async function runAiFullTurn(
  apiKey: string,
  input: ChatRunInput,
  signal: AbortSignal,
): Promise<ChatRunResult> {
  const domain = input.domain?.trim();
  if (!domain) return { ok: false, error: "请输入域名" };
  if (isInvalidDomain(domain)) return { ok: false, error: "域名格式无效" };
  const message = input.message?.trim();
  if (!message) return { ok: false, error: "消息不能为空" };

  const taskId = randomUUID();
  const sitesRoot = resolve(getSitesRoot());
  const outDir = normalize(join(sitesRoot, domain));

  const isExisting = existsSync(join(outDir, "index.html"));
  const effectivelyFirstTurn = input.firstTurn ?? !isExisting;

  const history = getChatHistoryService();
  history.create({
    id: taskId,
    mode: "ai-full",
    domain,
    prompt: message,
  });

  emit({
    taskId,
    type: "info",
    text: `[task ${taskId.slice(0, 8)}] ${effectivelyFirstTurn ? "首轮生成（从零）" : "增量改站"} → ${outDir}`,
  });

  // 首轮（从零）先清掉旧目录：否则上次 Cursor 沙箱可能在站点里残留「受限/锁定」子目录
  // （常见 fonts/font-awesome），本地 Agent 启动时扫描 cwd 会直接 EPERM(scandir) 崩掉。
  if (effectivelyFirstTurn && existsSync(outDir)) {
    try {
      forceRemoveDir(outDir);
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      const msg = `无法清理旧目录 ${outDir}：${detail}。该目录或其子目录（常见为 fonts/font-awesome）被 Cursor 本地沙箱锁定，普通账户乃至管理员 / SYSTEM 都删不掉，请退出 Cursor 或重启电脑后重试。`;
      emit({ taskId, type: "error", text: msg });
      history.finish(taskId, "error", msg);
      return { ok: false, taskId, error: msg };
    }
  }
  mkdirSync(outDir, { recursive: true });

  // 预检：增量改站（沿用现有目录）时，目录里可能残留被 Cursor 沙箱锁定 / 越权的子目录。
  // 本地 Agent 启动会递归扫描 cwd，遇到这种目录直接 `EPERM scandir` 崩。提前探测，
  // 把 SDK 的原始报错换成可操作提示（首轮已在上面清理过，这里主要兜底增量场景）。
  const blockedPath = findInaccessiblePath(outDir);
  if (blockedPath) {
    const msg =
      `站点目录存在被 Cursor 本地沙箱锁定 / 越权的子目录，本地 Agent 无法扫描：${blockedPath}。` +
      `这类目录连管理员 / SYSTEM 都删不掉，必须先彻底退出 Cursor（或重启电脑）释放占用，` +
      `再删除 ${outDir} 后重试。`;
    emit({ taskId, type: "error", text: msg });
    history.finish(taskId, "error", msg);
    return { ok: false, taskId, error: msg };
  }

  try {
    const r = await runStaticSiteGenerate({
      apiKey,
      domain,
      userGoals: message,
      outputDir: outDir,
      onLog: (line) => emit({ taskId, type: "text", text: line }),
      signal,
      editExistingSite: !effectivelyFirstTurn,
      siteStyleConstraints: PROGRAMMATIC_AD_SITE_CONSTRAINTS,
      onAgentId: (agentId) => history.attachIds(taskId, { agentId }),
      onRunId: (runId) => history.attachIds(taskId, { runId }),
    });

    if (signal.aborted) {
      emit({ taskId, type: "error", text: "已取消" });
      history.finish(taskId, "cancelled");
      return { ok: false, taskId, error: "已取消" };
    }
    if (!r.ok) {
      emit({ taskId, type: "error", text: r.error });
      history.finish(taskId, "error", r.error);
      return { ok: false, taskId, error: r.error };
    }
    emit({ taskId, type: "done", text: "完成" });
    history.finish(taskId, "done");
    return { ok: true, taskId, outputDir: outDir };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (signal.aborted) {
      emit({ taskId, type: "error", text: "已取消" });
      history.finish(taskId, "cancelled");
      return { ok: false, taskId, error: "已取消" };
    }
    emit({ taskId, type: "error", text: msg });
    history.finish(taskId, "error", msg);
    return { ok: false, taskId, error: msg };
  }
}

async function runTemplateBatch(
  apiKey: string,
  input: ChatRunInput,
  signal: AbortSignal,
): Promise<ChatRunResult> {
  const domains = (input.domains ?? [])
    .map((d) => d.trim())
    .filter(Boolean)
    .filter((d) => !isInvalidDomain(d));
  if (domains.length === 0) return { ok: false, error: "请填写至少一个域名" };

  const taskId = randomUUID();
  const sitesRoot = resolve(getSitesRoot());
  const available = listAvailableTemplateSources();
  if (available.length === 0) {
    return { ok: false, taskId, error: "templates/ 下没有可用模板" };
  }

  const fixed = input.fixedVariant?.trim();
  if (fixed && !available.includes(fixed)) {
    return { ok: false, taskId, error: `模板不存在: ${fixed}` };
  }
  const strategy: TemplatePickStrategy = input.templatePick ?? "轮询";

  const history = getChatHistoryService();
  history.create({
    id: taskId,
    mode: "template-batch",
    domain: domains[0],
    domains,
    prompt: fixed ? `固定模板 ${fixed}` : `策略 ${strategy}`,
  });

  emit({
    taskId,
    type: "info",
    text: `[task ${taskId.slice(0, 8)}] 模板批量生成 → ${domains.length} 个域名（${
      fixed ? `固定模板 ${fixed}` : `策略 ${strategy}`
    }）`,
  });

  const items: NonNullable<ChatRunResult["batch"]>["items"] = [];
  let succeeded = 0;
  let failed = 0;

  for (let i = 0; i < domains.length; i++) {
    if (signal.aborted) {
      emit({ taskId, type: "error", text: "已取消" });
      break;
    }
    const domain = domains[i];
    const templateId = fixed ?? pickTemplateForIndex(available, i, strategy);
    if (!templateId) {
      const error = "无法选择模板";
      items.push({ domain, templateId: "", ok: false, error });
      failed++;
      emit({ taskId, type: "error", text: `[${domain}] ${error}` });
      continue;
    }

    const outDir = normalize(join(sitesRoot, domain));
    // 模板批量是确定性「全新复制」：先清掉旧站点目录再复制，避免上次残留文件，
    // 以及防御 Cursor 本地 agent 沙箱偶尔给子目录留下「当前账户无权访问」的 ACL ——
    // 那种受限子目录会让后续复制阶段直接 EPERM（access denied）。
    if (existsSync(outDir)) {
      try {
        // 强力删除：重试 →（Windows 受限 ACL 时）takeown+icacls 拿回权限再删 → 复核。
        forceRemoveDir(outDir);
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        items.push({ domain, templateId, ok: false, error });
        failed++;
        emit({ taskId, type: "error", text: `[${domain}] ${error}` });
        continue;
      }
    }
    mkdirSync(outDir, { recursive: true });
    emit({
      taskId,
      type: "info",
      text: `[${i + 1}/${domains.length}] ${domain} ← ${templateId} → ${outDir}`,
    });

    const prep = prepareSiteFromTemplate({ templateId, domain, outputDir: outDir });
    if (!prep.ok) {
      items.push({ domain, templateId, ok: false, error: prep.error });
      failed++;
      emit({ taskId, type: "error", text: `[${domain}] 复制模板失败：${prep.error}` });
      continue;
    }
    const removedTip =
      prep.removedLogoFiles.length > 0 ? `，移除 logo ${prep.removedLogoFiles.length} 个` : "";
    emit({
      taskId,
      type: "text",
      text: `[${domain}] 模板 ${templateId} → 复制 ${prep.copied} 文件（跳过 ${prep.skipped}），替换 ${prep.replacements} 处${removedTip}`,
    });
    if (prep.replacements === 0 && templateId !== domain) {
      emit({
        taskId,
        type: "info",
        text: `[${domain}] 模板里未找到与源域名 ${templateId} 同名的品牌字（Adliftlab / ADLIFTLAB / adliftlab / adliftlab.com 风格）。请确认模板内容是否真的源自 ${templateId}。`,
      });
    }

    const logo = await generateDomainLogoSvg({
      apiKey,
      domain,
      siteRoot: outDir,
      onLog: (line) => emit({ taskId, type: "text", text: line }),
      signal,
    });
    if (!logo.ok) {
      items.push({ domain, templateId, ok: false, error: logo.error });
      failed++;
      emit({ taskId, type: "error", text: `[${domain}] Logo 失败：${logo.error}` });
      continue;
    }

    items.push({ domain, templateId, ok: true });
    succeeded++;
    emit({ taskId, type: "text", text: `[${domain}] ✓ 完成 → ${SITE_LOGO_PATH}` });
  }

  const cancelled = signal.aborted;
  emit({
    taskId,
    type: cancelled ? "error" : "done",
    text: cancelled
      ? `已取消（已完成 ${succeeded} / 失败 ${failed} / 共 ${domains.length}）`
      : `批量完成：成功 ${succeeded} / 失败 ${failed} / 共 ${domains.length}`,
  });
  history.finish(taskId, cancelled ? "cancelled" : failed === 0 ? "done" : "error");
  return {
    ok: !cancelled && failed === 0,
    taskId,
    batch: { total: domains.length, succeeded, failed, items },
  };
}
