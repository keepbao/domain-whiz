/**
 * 聊天历史持久化（每次 `chat:run` = 一条 session）。
 *
 * 落盘：`<appRoot>/.chat-history.json`，结构 `{ version, items }`；
 * 单条 session 包含：
 *  - 元数据：taskId（主键）、domain、mode、prompt、status、startedAt/finishedAt
 *  - Cursor SDK 关联：agentId / runId（仅 ai-full 模式有效；batch 模式可能多个 agent，这里不细分）
 *  - 累积日志：chunks[]，按发生顺序排列（与 UI 流式展示同源）
 *
 * 设计原则：
 *  - 写盘走 "tmp → fsync → rename" 原子套路，避免崩在写一半把历史干没。
 *  - 不暴露给渲染层（渲染层走 IPC `history:*` 拿快照）。
 *  - 上限保护：保留最近 200 条；超过自动丢弃最旧。
 *  - chunks 写盘采用 debounce（默认 800ms）+ 终态强制 flush，避免频繁 IO。
 */
import { join } from "node:path";
import { getAppRoot } from "./paths.js";
import { readJsonFile, writeJsonFileAtomic } from "./jsonStore.js";

const STORE_FILENAME = ".chat-history.json";
const SCHEMA_VERSION = 1;
const MAX_HISTORY = 200;
const FLUSH_DEBOUNCE_MS = 800;

export type ChatSessionStatus = "running" | "done" | "error" | "cancelled";

export type ChatHistoryChunk = {
  /** 与 ChatChunk.type 对齐：text / info / error / done */
  type: "text" | "info" | "error" | "done";
  text: string;
  ts: number;
};

export interface ChatSession {
  /** = chat.ts 里的 taskId（randomUUID） */
  id: string;
  mode: "ai-full" | "template-batch";
  /** 用户输入的目标域名（batch 模式取第一个） */
  domain?: string;
  /** batch 模式才有：完整域名列表 */
  domains?: string[];
  /** 用户输入的 prompt（batch 模式可能为空） */
  prompt?: string;
  /** Cursor SDK 关联（仅 ai-full 模式可靠） */
  agentId?: string;
  runId?: string;
  status: ChatSessionStatus;
  startedAt: number;
  finishedAt?: number;
  /** 失败时的简短描述（不含 secret） */
  errorMessage?: string;
  /** 流式日志全文（按时间顺序） */
  chunks: ChatHistoryChunk[];
}

interface StoreFile {
  version: number;
  items: ChatSession[];
}

function getStorePath(): string {
  return join(getAppRoot(), STORE_FILENAME);
}

function readFromDisk(): ChatSession[] {
  const parsed = readJsonFile<StoreFile | null>(getStorePath(), null);
  if (!parsed || !Array.isArray(parsed.items)) return [];
  return parsed.items.filter((it) => it && typeof it.id === "string");
}

function writeToDisk(items: ChatSession[]): void {
  writeJsonFileAtomic(getStorePath(), { version: SCHEMA_VERSION, items } satisfies StoreFile);
}

class ChatHistoryService {
  private items: ChatSession[] = readFromDisk();
  private flushTimer: NodeJS.Timeout | null = null;
  private listeners = new Set<(items: ChatSession[]) => void>();

  /** 全量快照（按 startedAt 倒序）；渲染层用于列表展示。 */
  list(): ChatSession[] {
    return [...this.items].sort((a, b) => b.startedAt - a.startedAt);
  }

  get(id: string): ChatSession | null {
    return this.items.find((s) => s.id === id) ?? null;
  }

  /** 开新 session（chat.ts 在 runChatTurn 入口调）。 */
  create(input: Omit<ChatSession, "chunks" | "status" | "startedAt">): ChatSession {
    const session: ChatSession = {
      ...input,
      status: "running",
      startedAt: Date.now(),
      chunks: [],
    };
    this.items.unshift(session);
    this.enforceMaxAndFlushSoon();
    return session;
  }

  /** 追加一段 chunk（chat.ts 的 emit 同步调）。 */
  appendChunk(id: string, chunk: ChatHistoryChunk): void {
    const s = this.items.find((x) => x.id === id);
    if (!s) return;
    s.chunks.push(chunk);
    this.scheduleFlush();
  }

  /** 补齐 SDK ID（generator 在 Agent.create / send 后回调）。 */
  attachIds(id: string, ids: { agentId?: string; runId?: string }): void {
    const s = this.items.find((x) => x.id === id);
    if (!s) return;
    if (ids.agentId) s.agentId = ids.agentId;
    if (ids.runId) s.runId = ids.runId;
    this.scheduleFlush();
  }

  /** 结束 session（chat.ts 在 finally 调；status 是终态）。 */
  finish(id: string, status: Exclude<ChatSessionStatus, "running">, errorMessage?: string): void {
    const s = this.items.find((x) => x.id === id);
    if (!s) return;
    s.status = status;
    s.finishedAt = Date.now();
    if (errorMessage) s.errorMessage = errorMessage;
    this.flushNow();
  }

  delete(id: string): void {
    const before = this.items.length;
    this.items = this.items.filter((x) => x.id !== id);
    if (this.items.length !== before) this.flushNow();
  }

  clear(): void {
    this.items = [];
    this.flushNow();
  }

  addListener(fn: (items: ChatSession[]) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // ---- 内部 ----

  private enforceMaxAndFlushSoon(): void {
    if (this.items.length > MAX_HISTORY) {
      this.items.sort((a, b) => b.startedAt - a.startedAt);
      this.items.length = MAX_HISTORY;
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushNow();
    }, FLUSH_DEBOUNCE_MS);
  }

  private flushNow(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    try {
      writeToDisk(this.items);
    } catch {
      /* 写盘失败不致命，下次再试 */
    }
    const snapshot = this.list();
    for (const fn of this.listeners) {
      try {
        fn(snapshot);
      } catch {
        /* listener errors are not fatal */
      }
    }
  }
}

let singleton: ChatHistoryService | null = null;
export function getChatHistoryService(): ChatHistoryService {
  if (!singleton) singleton = new ChatHistoryService();
  return singleton;
}
