/**
 * 飞书审批接入服务（主进程）。
 *
 * 三件事：
 *   1) submitApproval(input)：把业务表单按 fieldMap 转成飞书 widget JSON，调 v4 创建实例，
 *      把 instance_code + 元数据 push 到本地跟踪表 `.approval-tracker.json`。
 *   2) 60s（可配）轮询：对所有 status=PENDING 的条目调 GET instance；状态变更时
 *      a) 通过 `webContents.send("approval:event", ...)` 广播给渲染层；
 *      b) 若 APPROVED 且 !notifyDone，给申请人发飞书完成通知（需求 3=c）。
 *   3) cancelApproval(instanceCode)：调撤销接口 + 本地标记 CANCELED。
 *
 * 设计原则：
 * - 服务级单例（懒加载），main/index.ts 在 app.whenReady() 后调 `getApprovalService().start()` 拉起。
 * - 全局共用 `FeishuClient`（token 自动续期）；配置变更要先 `dispose()` 再重建。
 * - 轮询是单 `setInterval` 扫表，限制并发 ≤ 4，避免一次性打飞书 API。
 * - 任何长时间 fetch 失败不能让 tick 卡住——单条 try/catch 包住、超时由 FeishuClient 内置 AbortController 兜底。
 */
import {
  FeishuClient,
  FeishuError,
  cancelApprovalInstance,
  createApprovalInstance,
  getApprovalInstance,
  sendApprovalResultCard,
  type ApprovalDefinitionConfig,
  type ApprovalForm,
  type ApprovalKind,
  type ApprovalStatus,
} from "@domain-whiz/feishu";
import { loadDesktopConfig, type DesktopConfig } from "./config.js";
import {
  loadTracker,
  saveTracker,
  upsertTrackerItem,
  type ApprovalTrackerItem,
} from "./approvalStore.js";

export type ApprovalEventType = "submitted" | "status_changed" | "notify_sent" | "error";

export interface ApprovalEvent {
  type: ApprovalEventType;
  item: ApprovalTrackerItem;
  /** status_changed 时给出上一个状态。 */
  previousStatus?: ApprovalStatus;
  error?: string;
  ts: number;
}

export type ApprovalEventListener = (ev: ApprovalEvent) => void;

export interface SubmitApprovalInput {
  kind: ApprovalKind;
  /** 业务字段对应的域名（用于跟踪表的 domain 列与 UI 列表显示）。 */
  domain: string;
  /** 发起人 user_id（飞书企业内字母数字串，如 `8a9c3739`），由飞书 OAuth 登录态提供。 */
  initiatorUserId: string;
  /** 业务字段表单。不含 `domainOwner` —— 当前流程不再使用 contact widget。 */
  form: ApprovalForm;
}

export interface SubmitApprovalResult {
  ok: boolean;
  instanceCode?: string;
  error?: string;
}

const TERMINAL_STATUSES: readonly ApprovalStatus[] = [
  "APPROVED",
  "REJECTED",
  "RECALLED",
  "CANCELED",
  "DELETED",
];

const DEFAULT_POLL_INTERVAL_MS = 60_000;
const POLL_CONCURRENCY = 4;
/** 单条审批最长跟踪周期（90 天），超过自动停止轮询避免无限调 API。 */
const MAX_TRACKING_AGE_MS = 90 * 24 * 60 * 60 * 1000;

class ApprovalService {
  private client: FeishuClient | null = null;
  private items: ApprovalTrackerItem[] = loadTracker();
  private timer: NodeJS.Timeout | null = null;
  private pollIntervalMs = DEFAULT_POLL_INTERVAL_MS;
  private listeners = new Set<ApprovalEventListener>();
  private ticking = false;
  /** 用来在 `restart()` 时区分客户端是否真的需要重建。 */
  private configFingerprint = "";

  start(): void {
    this.reloadConfig();
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch(() => undefined);
    }, this.pollIntervalMs);
    // 启动后立刻 tick 一次，恢复进程崩了之前的进行中实例
    void this.tick().catch(() => undefined);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  flush(): void {
    saveTracker(this.items);
  }

  addListener(fn: ApprovalEventListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  listTracked(): ApprovalTrackerItem[] {
    return this.items.map((it) => ({ ...it }));
  }

  /** 强制刷新某一条；UI 上"立即查询"按钮用。 */
  async refreshOne(instanceCode: string): Promise<{ ok: boolean; error?: string }> {
    const idx = this.items.findIndex((it) => it.instanceCode === instanceCode);
    if (idx < 0) return { ok: false, error: "本地没有这条审批跟踪记录" };
    const client = this.ensureClient();
    if (!client) return { ok: false, error: "飞书配置不完整（appId / appSecret）" };
    try {
      await this.pollOne(client, idx);
      this.persistAndBroadcastTick();
      return { ok: true };
    } catch (e) {
      const msg = e instanceof FeishuError ? e.message : e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }

  /** 提交一个新审批：拼 form → 创建实例 → push 到 tracker。 */
  async submit(input: SubmitApprovalInput): Promise<SubmitApprovalResult> {
    const cfg = loadDesktopConfig();
    this.reloadConfig(cfg);
    const def = this.pickApprovalDefinition(cfg, input.kind);
    if (!def) {
      return {
        ok: false,
        error: `desktop.config.json 里没有配置 ${input.kind} 对应的 approvalCode / fieldMap`,
      };
    }
    const initiatorUserId = (input.initiatorUserId ?? "").trim();
    if (!initiatorUserId || initiatorUserId.startsWith("ou_")) {
      // 飞书 user_id 不是纯数字，而是企业内的字母数字串（如 8a9c3739），
      // 这里只确保非空且不是 open_id 即可
      return {
        ok: false,
        error: `发起人 user_id 无效：${initiatorUserId || "(空)"}（请重新登录飞书）`,
      };
    }
    // NOTE: 当前流程不再注入 `domainOwner`（contact widget）。
    //   - 飞书 contact widget 需要 tenant_access_token 解析 open_id，要求用户在 app 可用范围内；
    //     在我们当前的发布配置下经常 1390001 not found。
    //   - 业务上发起人即域名负责人，无需在 form 里再单独标记。
    //   - 如果后续要恢复 contact 字段，需在 `desktop.config.json -> approvals.*.fieldMap` 里
    //     补回 `domainOwner` 配置并同步前端 / 输入参数。
    const feishuForm: ApprovalForm = input.form;
    const client = this.ensureClient();
    if (!client) {
      return { ok: false, error: "飞书未配置 appId / appSecret" };
    }

    try {
      const instanceCode = await createApprovalInstance(client, {
        approvalCode: def.approvalCode,
        userId: initiatorUserId,
        form: feishuForm,
        fieldMap: def.fieldMap,
      });
      const now = Date.now();
      const item: ApprovalTrackerItem = {
        instanceCode,
        approvalCode: def.approvalCode,
        kind: input.kind,
        domain: input.domain,
        applicantId: initiatorUserId,
        form: { ...input.form },
        status: "PENDING",
        submittedAt: now,
        lastChangedAt: now,
        lastCheckedAt: now,
      };
      this.items = upsertTrackerItem(this.items, item);
      saveTracker(this.items);
      this.emit({ type: "submitted", item, ts: now });
      return { ok: true, instanceCode };
    } catch (e) {
      const msg = e instanceof FeishuError ? e.message : e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }

  async cancel(instanceCode: string): Promise<{ ok: boolean; error?: string }> {
    const idx = this.items.findIndex((it) => it.instanceCode === instanceCode);
    if (idx < 0) return { ok: false, error: "本地没有这条审批跟踪记录" };
    const item = this.items[idx];
    if (TERMINAL_STATUSES.includes(item.status)) {
      return { ok: false, error: `已经是终态 ${item.status}，无法撤销` };
    }
    const client = this.ensureClient();
    if (!client) return { ok: false, error: "飞书未配置 appId / appSecret" };
    try {
      await cancelApprovalInstance(client, {
        approvalCode: item.approvalCode,
        instanceCode: item.instanceCode,
        userId: item.applicantId,
      });
      const now = Date.now();
      const next: ApprovalTrackerItem = {
        ...item,
        status: "CANCELED",
        lastChangedAt: now,
        lastCheckedAt: now,
        finishedAt: now,
      };
      this.items = upsertTrackerItem(this.items, next);
      saveTracker(this.items);
      this.emit({ type: "status_changed", item: next, previousStatus: item.status, ts: now });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof FeishuError ? e.message : e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    }
  }

  // ---- 内部 ----

  private reloadConfig(cfgIn?: DesktopConfig): void {
    const cfg = cfgIn ?? loadDesktopConfig();
    const feishu = cfg.feishu ?? {};
    const nextPollMs =
      typeof feishu.pollIntervalMs === "number" && feishu.pollIntervalMs >= 10_000
        ? feishu.pollIntervalMs
        : DEFAULT_POLL_INTERVAL_MS;
    if (nextPollMs !== this.pollIntervalMs) {
      this.pollIntervalMs = nextPollMs;
      if (this.timer) {
        clearInterval(this.timer);
        this.timer = setInterval(() => {
          void this.tick().catch(() => undefined);
        }, this.pollIntervalMs);
      }
    }
    const fp = `${feishu.appId ?? ""}::${feishu.appSecret ?? ""}::${feishu.baseUrl ?? ""}`;
    if (fp === this.configFingerprint && this.client) return;
    this.configFingerprint = fp;
    this.client?.dispose();
    if (feishu.appId?.trim() && feishu.appSecret?.trim()) {
      this.client = new FeishuClient({
        appId: feishu.appId,
        appSecret: feishu.appSecret,
        baseUrl: feishu.baseUrl,
      });
    } else {
      this.client = null;
    }
  }

  private ensureClient(): FeishuClient | null {
    if (!this.client) this.reloadConfig();
    return this.client;
  }

  private pickApprovalDefinition(
    cfg: DesktopConfig,
    kind: ApprovalKind,
  ): ApprovalDefinitionConfig | null {
    const a = cfg.feishu?.approvals;
    if (!a) return null;
    const def = kind === "domain-purchase" ? a.domainPurchase : a.domainResolve;
    if (!def?.approvalCode?.trim()) return null;
    return def;
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const client = this.ensureClient();
      if (!client) return;
      const now = Date.now();
      const pending = this.items
        .map((it, idx) => ({ it, idx }))
        .filter(
          ({ it }) =>
            !TERMINAL_STATUSES.includes(it.status) &&
            now - it.submittedAt < MAX_TRACKING_AGE_MS,
        );
      if (pending.length === 0) return;

      const queue = [...pending];
      const workers: Promise<void>[] = [];
      for (let w = 0; w < Math.min(POLL_CONCURRENCY, queue.length); w++) {
        workers.push(
          (async () => {
            while (queue.length > 0) {
              const next = queue.shift();
              if (!next) break;
              try {
                await this.pollOne(client, next.idx);
              } catch {
                /* 单条失败不阻断整体 tick */
              }
            }
          })(),
        );
      }
      await Promise.all(workers);
      this.persistAndBroadcastTick();
    } finally {
      this.ticking = false;
    }
  }

  private async pollOne(client: FeishuClient, idx: number): Promise<void> {
    const current = this.items[idx];
    if (!current) return;
    const summary = await getApprovalInstance(client, current.instanceCode);
    const now = Date.now();
    const prevStatus = current.status;
    const statusChanged = summary.status !== prevStatus;
    const finishedAt = TERMINAL_STATUSES.includes(summary.status)
      ? current.finishedAt ?? now
      : current.finishedAt;
    const updated: ApprovalTrackerItem = {
      ...current,
      status: summary.status,
      serialNumber: summary.serialNumber ?? current.serialNumber,
      lastCheckedAt: now,
      lastChangedAt: statusChanged ? now : current.lastChangedAt,
      finishedAt,
    };
    this.items = upsertTrackerItem(this.items, updated);

    if (statusChanged) {
      this.emit({
        type: "status_changed",
        item: updated,
        previousStatus: prevStatus,
        ts: now,
      });
      if (summary.status === "APPROVED" && !updated.notifyDone) {
        await this.notifyApplicant(client, updated);
      }
    }
  }

  private async notifyApplicant(client: FeishuClient, item: ApprovalTrackerItem): Promise<void> {
    try {
      const title =
        item.kind === "domain-purchase"
          ? "[域名购买] 审批已通过"
          : "[域名解析] 审批已通过";
      const receiveIdKind = detectIdKind(item.applicantId);
      await sendApprovalResultCard(client, {
        receiveId: item.applicantId,
        receiveIdType: receiveIdKind === "open_id" ? "open_id" : "user_id",
        title,
        statusLabel: "APPROVED",
        statusColor: "green",
        rows: buildNotifyRows(item),
        note: item.serialNumber ? `审批编号：${item.serialNumber}` : undefined,
      });
      const stamped: ApprovalTrackerItem = { ...item, notifyDone: true };
      this.items = upsertTrackerItem(this.items, stamped);
      this.emit({ type: "notify_sent", item: stamped, ts: Date.now() });
    } catch (e) {
      const msg = e instanceof FeishuError ? e.message : e instanceof Error ? e.message : String(e);
      this.emit({ type: "error", item, error: `通知发送失败：${msg}`, ts: Date.now() });
    }
  }

  private persistAndBroadcastTick(): void {
    try {
      saveTracker(this.items);
    } catch {
      /* 写盘失败不致命，下一轮再试 */
    }
  }

  private emit(ev: ApprovalEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(ev);
      } catch {
        /* listener 错误不影响其它人 */
      }
    }
  }
}

/**
 * 按前缀识别飞书用户 ID 类型：
 * - `ou_` 开头 → open_id
 * - 其它非空字符串 → user_id（飞书 user_id 是企业内字母数字串，如 `8a9c3739`，并非纯数字）
 */
function detectIdKind(id: string): "open_id" | "user_id" {
  return id.trim().startsWith("ou_") ? "open_id" : "user_id";
}

function buildNotifyRows(item: ApprovalTrackerItem): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string }> = [
    { label: "域名", value: item.domain },
    { label: "类型", value: item.kind === "domain-purchase" ? "域名购买" : "域名解析" },
  ];
  for (const [k, v] of Object.entries(item.form)) {
    rows.push({ label: k, value: stringifyFormValue(v) });
  }
  return rows;
}

/** 把任意业务表单值序列化成可读字符串，便于飞书卡片显示。 */
function stringifyFormValue(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) {
    return v
      .map((x) => {
        if (x && typeof x === "object" && !Array.isArray(x)) {
          return Object.entries(x as Record<string, unknown>)
            .map(([kk, vv]) => `${kk}=${stringifyFormValue(vv)}`)
            .join(", ");
        }
        return stringifyFormValue(x);
      })
      .join(" | ");
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

let singleton: ApprovalService | null = null;
export function getApprovalService(): ApprovalService {
  if (!singleton) singleton = new ApprovalService();
  return singleton;
}

export type { ApprovalTrackerItem } from "./approvalStore.js";
