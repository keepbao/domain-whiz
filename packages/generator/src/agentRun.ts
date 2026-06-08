/**
 * Cursor Agent 单轮任务的统一执行器（建站 / Logo 共用）。
 *
 * 把「create → 抓 agentId → send → 抓 runId → 订阅取消 → 流式转发文本 → wait →
 * asyncDispose 清理」这套样板收敛到一处；各调用方只负责拼 prompt + 跑自己的产物校验。
 *
 * 错误信息统一做密钥脱敏（cursor_* / sk-*），避免把 API Key 透传进日志 / 历史。
 */
import { Agent } from "@cursor/sdk";

/** 全项目默认使用的 Cursor 模型（建站 / Logo 共用）。 */
const DEFAULT_MODEL_ID = "gpt-5.5";

export interface AgentTaskOptions {
  apiKey?: string;
  modelId?: string;
  /** Agent 的工作目录（local.cwd）。 */
  cwd: string;
  /** 发送给 Agent 的完整 prompt。 */
  prompt: string;
  /** 流式文本回调（assistant 文本块逐段转发）。 */
  onLog?: (line: string) => void;
  signal?: AbortSignal;
  /** send 之前打印的起始日志（如 "Agent.send: 开始生成…"）。 */
  startLog?: string;
  /** run.wait() 返回 status=error 时的错误前缀（如 "Agent" / "Logo Agent"）。 */
  label?: string;
  /** 关联回调：上层据此把 agentId/runId 写入历史，便于以后 Agent.getRun 复盘。 */
  onAgentId?: (agentId: string) => void;
  onRunId?: (runId: string) => void;
}

function redactSecrets(msg: string): string {
  return msg
    .replace(/cursor_[a-zA-Z0-9_\-]+/g, "[REDACTED]")
    .replace(/sk-[a-zA-Z0-9]+/g, "[REDACTED]");
}

export async function runAgentTask(
  opts: AgentTaskOptions,
): Promise<{ ok: boolean; error?: string }> {
  const log = (s: string): void => opts.onLog?.(s);

  const agent = await Agent.create({
    apiKey: opts.apiKey ?? process.env.CURSOR_API_KEY,
    model: { id: opts.modelId ?? DEFAULT_MODEL_ID },
    local: { cwd: opts.cwd },
  });
  try {
    const aid = (agent as unknown as { agentId?: string }).agentId;
    if (aid) opts.onAgentId?.(aid);
  } catch {
    /* SDK 版本差异：拿不到 id 不阻塞主流程 */
  }

  try {
    if (opts.signal?.aborted) return { ok: false, error: "已取消" };
    if (opts.startLog) log(opts.startLog);

    const run = await agent.send(opts.prompt);
    try {
      const rid =
        (run as unknown as { id?: string }).id ??
        (run as unknown as { runId?: string }).runId;
      if (rid) opts.onRunId?.(rid);
    } catch {
      /* 同上 */
    }

    if (run.supports("cancel") && opts.signal) {
      opts.signal.addEventListener(
        "abort",
        () => void run.cancel?.().catch(() => undefined),
        { once: true },
      );
    }

    for await (const event of run.stream()) {
      if (event.type === "assistant") {
        for (const block of event.message.content) {
          if (block.type === "text") log(block.text);
        }
      }
    }

    const result = await run.wait();
    if (result.status === "error") {
      return { ok: false, error: `${opts.label ?? "Agent"} 运行失败（status=error）` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: redactSecrets(e instanceof Error ? e.message : String(e)) };
  } finally {
    try {
      const a = agent as unknown as {
        [Symbol.asyncDispose]?: () => void | Promise<void>;
        dispose?: () => void | Promise<void>;
      };
      const fn = a[Symbol.asyncDispose];
      if (typeof fn === "function") await Promise.resolve(fn.call(a));
    } catch {
      /* Agent 清理为尽力而为；部分 SDK 版本未实现 asyncDispose */
    }
  }
}
