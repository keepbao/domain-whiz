import type { FeishuClient } from "./client.js";
import {
  type ApprovalForm,
  type ApprovalInstanceSummary,
  type ApprovalStatus,
  type CreateInstanceInput,
  type WidgetMapEntry,
} from "./types.js";

interface WidgetCell {
  id: string;
  type: string;
  value: unknown;
}

interface NormalizedMapping {
  id: string;
  type: string;
  children?: Record<string, WidgetMapEntry>;
  options?: Record<string, string>;
}

function normalizeMapping(m: WidgetMapEntry): NormalizedMapping {
  if (typeof m === "string") return { id: m, type: "input" };
  if (m.type === "fieldList") return { id: m.id, type: "fieldList", children: m.children };
  return { id: m.id, type: m.type, options: m.options };
}

function resolveRadioV2Value(raw: unknown, options?: Record<string, string>): string {
  const s = String(raw ?? "");
  if (!options) return s;
  if (options[s]) return options[s];
  const values = new Set(Object.values(options));
  if (values.has(s)) return s;
  return s;
}

/**
 * 把"业务字段名 → 飞书 widget 配置"映射成飞书 form JSON 串。
 *
 * - 未在 fieldMap 中声明的业务字段直接丢弃，避免飞书侧报 "unknown widget"；
 * - `fieldList` 类型递归把数组里的每个对象渲染成一行 cell 数组（飞书要求二维结构）；
 * - `contact` 类型的值是 open_id 数组，需要去重 / 兼容传字符串。
 */
export function buildFormJson(form: ApprovalForm, fieldMap: Record<string, WidgetMapEntry>): string {
  const arr: WidgetCell[] = [];
  for (const [bizKey, raw] of Object.entries(form)) {
    const mapping = fieldMap[bizKey];
    if (!mapping) continue;
    const entry = normalizeMapping(mapping);
    if (entry.type === "fieldList") {
      const rows = Array.isArray(raw) ? (raw as unknown[]) : [];
      const rendered = rows
        .map((row) => buildFieldListRow(entry.children ?? {}, row))
        .filter((cells) => cells.length > 0);
      arr.push({ id: entry.id, type: "fieldList", value: rendered });
      continue;
    }
    arr.push({
      id: entry.id,
      type: entry.type,
      value: normalizeWidgetValue(entry.type, raw, entry.options),
    });
  }
  return JSON.stringify(arr);
}

function buildFieldListRow(
  children: Record<string, WidgetMapEntry>,
  row: unknown,
): WidgetCell[] {
  if (!row || typeof row !== "object") return [];
  const record = row as Record<string, unknown>;
  const cells: WidgetCell[] = [];
  for (const [childKey, mapping] of Object.entries(children)) {
    if (record[childKey] === undefined) continue;
    const entry = normalizeMapping(mapping);
    if (entry.type === "fieldList") continue; // 防御性：飞书不支持嵌套表
    cells.push({
      id: entry.id,
      type: entry.type,
      value: normalizeWidgetValue(entry.type, record[childKey], entry.options),
    });
  }
  return cells;
}

function normalizeWidgetValue(type: string, v: unknown, options?: Record<string, string>): unknown {
  if (type === "radioV2") {
    return resolveRadioV2Value(v, options);
  }
  if (type === "number") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  if (type === "date") {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (typeof v === "number") return new Date(v).toISOString().slice(0, 10);
    return String(v ?? "");
  }
  if (type === "contact") {
    const arr = Array.isArray(v)
      ? v
      : v === undefined || v === null || v === ""
        ? []
        : [v];
    const out: string[] = [];
    for (const x of arr) {
      const s = String(x ?? "").trim();
      if (s && !out.includes(s)) out.push(s);
    }
    return out;
  }
  return String(v ?? "");
}

interface CreateInstanceResp {
  instance_code: string;
}

/**
 * 提交一个审批实例。返回 instance_code。
 *
 * 失败抛 FeishuError（包含飞书侧错误码，方便用户排查 widget 映射 / 权限 / approval_code 是否正确）。
 */
export async function createApprovalInstance(
  client: FeishuClient,
  input: CreateInstanceInput,
): Promise<string> {
  const userId = input.userId?.trim();
  const openId = input.openId?.trim();
  if (!userId && !openId) {
    throw new Error("createApprovalInstance: userId 或 openId 至少传一个");
  }
  const body: Record<string, unknown> = {
    approval_code: input.approvalCode,
    form: buildFormJson(input.form, input.fieldMap),
  };
  if (userId) body.user_id = userId;
  else if (openId) body.open_id = openId;
  if (input.nodeApproverOpenIdList && Object.keys(input.nodeApproverOpenIdList).length > 0) {
    body.node_approver_open_id_list = Object.entries(input.nodeApproverOpenIdList).map(
      ([nodeId, openIds]) => ({ node_id: nodeId, value: openIds }),
    );
  }
  const data = await client.request<CreateInstanceResp>("POST", "/open-apis/approval/v4/instances", body);
  return data.instance_code;
}

interface RawInstance {
  approval_code: string;
  approval_name: string;
  status: string;
  user_id?: string;
  open_id?: string;
  serial_number?: string;
  start_time?: number | string;
  end_time?: number | string;
  instance_code?: string;
}

/** 把飞书的 raw status 映射到本地统一枚举。 */
function mapStatus(raw: string): ApprovalStatus {
  switch (raw) {
    case "APPROVED":
      return "APPROVED";
    case "REJECTED":
      return "REJECTED";
    case "RECALLED":
      return "RECALLED";
    case "CANCELED":
      return "CANCELED";
    case "DELETED":
      return "DELETED";
    case "PENDING":
    case "IN_PROGRESS":
    default:
      return "PENDING";
  }
}

/** 拉一次审批实例的当前状态。 */
export async function getApprovalInstance(
  client: FeishuClient,
  instanceCode: string,
): Promise<ApprovalInstanceSummary> {
  const data = await client.request<RawInstance>(
    "GET",
    `/open-apis/approval/v4/instances/${encodeURIComponent(instanceCode)}`,
  );
  const startTime = toMillis(data.start_time);
  const endTime = toMillis(data.end_time);
  return {
    instanceCode: data.instance_code ?? instanceCode,
    approvalCode: data.approval_code,
    approvalName: data.approval_name,
    status: mapStatus(data.status),
    userId: data.user_id,
    openId: data.open_id,
    serialNumber: data.serial_number,
    startTime,
    endTime,
  };
}

function toMillis(v: number | string | undefined): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  // 飞书有的接口返回秒、有的毫秒：> 10^12 视为毫秒
  return n > 1e12 ? n : n * 1000;
}

/** 撤销一个审批实例（仅 PENDING 状态可撤）。 */
export async function cancelApprovalInstance(
  client: FeishuClient,
  args: { approvalCode: string; instanceCode: string; userId: string },
): Promise<void> {
  await client.request<unknown>("POST", "/open-apis/approval/v4/instances/cancel", {
    approval_code: args.approvalCode,
    instance_code: args.instanceCode,
    user_id: args.userId,
  });
}
