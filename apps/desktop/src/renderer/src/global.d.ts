// DeployServerConfig 单一定义在 store.ts；这里导入用于本地引用并 re-export，
// 避免 renderer 内出现两份会漂移的定义。
import type { DesktopConfig, DeployServerConfig } from "./store";
export type { DeployServerConfig };

/** 聊天历史会话（与 main/chatHistoryStore.ts 对齐）。 */
export type ChatSessionStatus = "running" | "done" | "error" | "cancelled";

export interface ChatHistoryChunk {
  type: "text" | "info" | "error" | "done";
  text: string;
  ts: number;
}

export interface ChatSession {
  id: string;
  mode: "ai-full" | "template-batch";
  domain?: string;
  domains?: string[];
  prompt?: string;
  agentId?: string;
  runId?: string;
  status: ChatSessionStatus;
  startedAt: number;
  finishedAt?: number;
  errorMessage?: string;
  chunks: ChatHistoryChunk[];
}

export interface DeployServerStatus {
  host: string;
  configured: boolean;
  ready: boolean;
  missing: string[];
  port: number;
  username: string;
}

export interface CatalogItem {
  name: string;
  kind: "site" | "template";
  hasIndex: boolean;
  logoDataUrl: string | null;
}

export interface CatalogList {
  sites: CatalogItem[];
  templates: CatalogItem[];
}

/** 历史会话产物（某域名生成出的站点）。 */
export interface SiteProduct {
  domain: string;
  dir: string;
  logoDataUrl: string | null;
  hasIndex: boolean;
  exists: boolean;
}

export interface ChatChunk {
  taskId: string;
  type: "text" | "info" | "error" | "done";
  text?: string;
}

export type BuildMode = "ai-full" | "template-batch";
export type TemplatePickStrategy = "random" | "round-robin";

export interface ChatRunInput {
  mode?: BuildMode;
  /** ai-full: 目标域名 */
  domain?: string;
  /** ai-full: 用户中文需求描述 */
  message?: string;
  /** ai-full: 显式指定首轮（覆盖自动判断） */
  firstTurn?: boolean;
  /** template-batch: 批量域名 */
  domains?: string[];
  /** template-batch: 固定模板（=源域名 / 目录名） */
  fixedVariant?: string;
  /** template-batch: 挑选策略 */
  templatePick?: TemplatePickStrategy;
}

export interface ChatBatchItem {
  domain: string;
  templateId: string;
  ok: boolean;
  error?: string;
}

export interface ChatRunResult {
  ok: boolean;
  taskId?: string;
  outputDir?: string;
  batch?: {
    total: number;
    succeeded: number;
    failed: number;
    items: ChatBatchItem[];
  };
  error?: string;
}

export type DeployEventType =
  | "start"
  | "connect"
  | "upload"
  | "delete_extra"
  | "apply"
  | "done"
  | "error";

export interface DeployEvent {
  deployId: string;
  domain: string;
  host: string;
  type: DeployEventType;
  message?: string;
  filename?: string;
  bytesUploaded?: number;
  totalBytes?: number;
  totalFiles?: number;
  fileIndex?: number;
  percent?: number;
  error?: string;
  ts: number;
}

export interface DeployStartInput {
  domain: string;
  host: string;
}

export interface DeployStartResult {
  ok: boolean;
  deployId?: string;
  error?: string;
}

export interface DeployLogMeta {
  name: string;
  domain: string;
  host: string;
  mtime: number;
  sizeBytes: number;
}

export interface ServerUpsertInput {
  originalHost?: string;
  server: DeployServerConfig;
}

/** 飞书审批：渲染层用的 DTO（与 main/approvalService.ts 对齐）。 */
export type ApprovalKind = "domain-purchase" | "domain-resolve";

export type ApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "RECALLED"
  | "CANCELED"
  | "DELETED";

/**
 * UI 提交时单个字段值。
 *
 * - 标量 widget：string / number / boolean
 * - contact widget：open_id 数组
 * - fieldList widget：行对象数组，每行用业务键 → 单元格值；单元格值仍是标量 / 数组
 */
export type ApprovalFormScalar = string | number | boolean;
export type ApprovalFormValue =
  | ApprovalFormScalar
  | string[]
  | Array<Record<string, ApprovalFormScalar | string[]>>;

export interface ApprovalTrackerItem {
  instanceCode: string;
  approvalCode: string;
  kind: ApprovalKind;
  domain: string;
  /** 发起人 ID（OAuth 登录路径下为 user_id 纯数字；旧数据可能是 open_id）。 */
  applicantId: string;
  form: Record<string, ApprovalFormValue>;
  status: ApprovalStatus;
  submittedAt: number;
  lastChangedAt: number;
  lastCheckedAt: number;
  finishedAt?: number;
  notifyDone?: boolean;
  serialNumber?: string;
}

export interface ApprovalEvent {
  type: "submitted" | "status_changed" | "notify_sent" | "error";
  item: ApprovalTrackerItem;
  previousStatus?: ApprovalStatus;
  error?: string;
  ts: number;
}

export interface ApprovalSubmitInput {
  kind: ApprovalKind;
  domain: string;
  /** 发起人 user_id（飞书企业内字母数字串，如 `8a9c3739`），由飞书 OAuth 登录态提供 */
  initiatorUserId: string;
  form: Record<string, ApprovalFormValue>;
}

export interface ApprovalSubmitResult {
  ok: boolean;
  instanceCode?: string;
  error?: string;
}

export interface FeishuSessionUser {
  userId: string;
  openId: string;
  unionId?: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

export interface FeishuSession {
  user: FeishuSessionUser;
  loggedInAt: number;
  accessTokenExpiresAt: number;
}

export type FeishuLoginResult =
  | { ok: true; session: FeishuSession }
  | { ok: false; error: string };

export interface DesktopApi {
  getConfig: () => Promise<DesktopConfig>;

  previewOpenTemplate: (variant: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  previewOpenSite: (domain: string) => Promise<{ ok: true } | { ok: false; error: string }>;

  siteExport: (
    domain: string,
  ) => Promise<{ ok: true; targetPath: string } | { ok: false; error: string }>;
  siteExportBatch: (
    domains: string[],
  ) => Promise<{
    ok: boolean;
    targetDir?: string;
    items: Array<{ domain: string; ok: boolean; targetPath?: string; error?: string }>;
    error?: string;
  }>;
  siteDelete: (
    domain: string,
  ) => Promise<{ ok: true; targetPath?: string } | { ok: false; error: string }>;
  siteDeleteBatch: (
    domains: string[],
  ) => Promise<{
    ok: boolean;
    items: Array<{ domain: string; ok: boolean; targetPath?: string; error?: string }>;
  }>;

  catalogListAll: () => Promise<CatalogList>;

  siteProducts: (domains: string[]) => Promise<{ items: SiteProduct[] }>;
  siteReveal: (
    domain: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;

  chatRun: (input: ChatRunInput) => Promise<ChatRunResult>;
  chatCancel: () => Promise<{ ok: true } | { ok: false; error: string }>;
  onChatChunk: (cb: (chunk: ChatChunk) => void) => () => void;

  historyList: () => Promise<{ items: ChatSession[] }>;
  historyGet: (id: string) => Promise<{ session: ChatSession | null }>;
  historyDelete: (id: string) => Promise<{ ok: true }>;
  historyClear: () => Promise<{ ok: true }>;
  onHistoryChanged: (cb: (payload: { items: ChatSession[] }) => void) => () => void;

  deployListServerStatus: () => Promise<{ servers: DeployServerStatus[] }>;
  deployStart: (input: DeployStartInput) => Promise<DeployStartResult>;
  deployListLogs: () => Promise<{ logs: DeployLogMeta[] }>;
  deployReadLog: (name: string) => Promise<{ ok: true; content: string } | { ok: false; error: string }>;
  onDeployEvent: (cb: (ev: DeployEvent) => void) => () => void;

  serversUpsert: (input: ServerUpsertInput) => Promise<DesktopConfig>;
  serversDelete: (host: string) => Promise<DesktopConfig>;
  serversImportKey: (host: string) => Promise<DesktopConfig>;

  approvalSubmit: (input: ApprovalSubmitInput) => Promise<ApprovalSubmitResult>;
  approvalList: () => Promise<{ items: ApprovalTrackerItem[] }>;
  approvalRefresh: (
    instanceCode: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  approvalCancel: (
    instanceCode: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onApprovalEvent: (cb: (ev: ApprovalEvent) => void) => () => void;

  feishuLogin: () => Promise<FeishuLoginResult>;
  feishuLogout: () => Promise<{ ok: true }>;
  feishuWhoAmI: () => Promise<{ session: FeishuSession | null }>;
}

declare global {
  interface Window {
    dw: DesktopApi;
  }
}

export {};
