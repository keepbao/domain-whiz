/**
 * 审批跟踪表持久化。
 *
 * 落盘到 `<appRoot>/.approval-tracker.json`：
 *   {
 *     "version": 1,
 *     "items": [
 *       { instanceCode, kind, domain, status, ... }
 *     ]
 *   }
 *
 * 设计原则：
 * - 写盘走 "写 tmp → fsync → rename" 原子套路，避免崩在写一半把跟踪表干没。
 * - 不持有 app secret / open id 之外的敏感数据；本文件可手工查看。
 * - 不暴露给渲染层（渲染层走 IPC `approval:list` 拿快照）。
 */
import { join } from "node:path";
import type { ApprovalForm, ApprovalKind, ApprovalStatus } from "@domain-whiz/feishu";
import { getAppRoot } from "./paths.js";
import { readJsonFile, writeJsonFileAtomic } from "./jsonStore.js";

const STORE_FILENAME = ".approval-tracker.json";
const SCHEMA_VERSION = 1;

export interface ApprovalTrackerItem {
  instanceCode: string;
  approvalCode: string;
  kind: ApprovalKind;
  domain: string;
  /**
   * 发起人 ID（既可能是 user_id 纯数字也可能是 open_id ou_xxx，由 detectIdKind 区分）。
   * 现行路径下来自 OAuth 登录态的 user_id；旧数据可能是 open_id，兼容读取。
   */
  applicantId: string;
  form: ApprovalForm;
  status: ApprovalStatus;
  submittedAt: number;
  /** 状态最后一次变更时间。 */
  lastChangedAt: number;
  /** 上一次轮询命中时间（不一定有状态变化）。 */
  lastCheckedAt: number;
  /** 完成（APPROVED / REJECTED / RECALLED / CANCELED / DELETED）的时间戳。 */
  finishedAt?: number;
  /** APPROVED 完成通知是否已成功发出（幂等用）。 */
  notifyDone?: boolean;
  serialNumber?: string;
}

interface StoreFile {
  version: number;
  items: ApprovalTrackerItem[];
}

export function getStorePath(): string {
  return join(getAppRoot(), STORE_FILENAME);
}

function emptyStore(): StoreFile {
  return { version: SCHEMA_VERSION, items: [] };
}

export function loadTracker(): ApprovalTrackerItem[] {
  const parsed = readJsonFile<StoreFile | null>(getStorePath(), null);
  if (!parsed || !Array.isArray(parsed.items)) return [];
  return parsed.items
    .filter((it) => it && typeof it.instanceCode === "string")
    .map((it) => {
      // 兼容旧字段名 applicantOpenId → applicantId
      const legacy = it as ApprovalTrackerItem & { applicantOpenId?: string };
      if (!legacy.applicantId && legacy.applicantOpenId) {
        legacy.applicantId = legacy.applicantOpenId;
        delete legacy.applicantOpenId;
      }
      return legacy as ApprovalTrackerItem;
    });
}

export function saveTracker(items: ApprovalTrackerItem[]): void {
  writeJsonFileAtomic(getStorePath(), { version: SCHEMA_VERSION, items } satisfies StoreFile);
}

/** 把单个 item upsert 进列表（按 instanceCode 主键）。 */
export function upsertTrackerItem(
  list: ApprovalTrackerItem[],
  patch: ApprovalTrackerItem,
): ApprovalTrackerItem[] {
  const idx = list.findIndex((x) => x.instanceCode === patch.instanceCode);
  if (idx < 0) return [...list, patch];
  const next = [...list];
  next[idx] = { ...next[idx], ...patch };
  return next;
}
