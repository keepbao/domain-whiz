/**
 * 飞书审批接入的共享类型。这一层不依赖任何 Electron / Node 特性，
 * 既被主进程 import，也被打包到生产 bundle 里。
 */

/** 本项目支持的两类审批；与 desktop.config.json 的 `feishu.approvals` 一一对应。 */
export type ApprovalKind = "domain-purchase" | "domain-resolve";

/**
 * 本地标准化的审批状态。`PENDING` 在飞书侧对应 `PENDING` 或 `IN_PROGRESS`；
 * 其它枚举与飞书 v4 API 的 status 字面量一致。
 */
export type ApprovalStatus =
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "RECALLED"
  | "CANCELED"
  | "DELETED";

/** Logo Agent 提示词里用的"已经知道，但不能直接交给前端"的私密配置。 */
export interface FeishuClientConfig {
  appId: string;
  appSecret: string;
  /** 国际版 / 海外用 Lark 时改 `https://open.larksuite.com`。 */
  baseUrl?: string;
  /** HTTP 请求超时（毫秒），默认 15s。 */
  requestTimeoutMs?: number;
}

/** 单个审批字段到飞书 widget 的映射。 */
export type WidgetType =
  | "input"
  | "textarea"
  | "number"
  | "date"
  | "select"
  | "radio"
  | "radioV2"
  | "contact"
  | "fieldList";

/**
 * 配置里可以写三种形态：
 *   "widget1"                                                    — 默认 type=input
 *   { id: "widget7", type: "textarea" }                          — 标量 widget
 *   { id: "wL", type: "fieldList", children: { ... } }            — 多行明细 widget
 *
 * 飞书的 fieldList 字段是「行 × 列」的二维结构（比如「购买域名列表」表格里每行都包含
 * 「域名名称」「购买年份」两列）。`children` 用业务键映射到行内各列 widget。
 */
export type WidgetMapEntry =
  | string
  | {
      id: string;
      type: Exclude<WidgetType, "fieldList">;
      /** radioV2：界面展示文案 → 飞书 option.value */
      options?: Record<string, string>;
    }
  | { id: string; type: "fieldList"; children: Record<string, WidgetMapEntry> };

/** 一组域审批的全部配置。 */
export interface ApprovalDefinitionConfig {
  /** 飞书审批后台发布后给出的 approval_code（不是审批名）。 */
  approvalCode: string;
  /** 默认申请人 open_id（已废弃：提交时改由卡片填写 user_id）。 */
  applicantOpenId?: string;
  /** 业务字段 → 飞书 widget 的映射。 */
  fieldMap: Record<string, WidgetMapEntry>;
}

/** 整段 `feishu.*` 配置。 */
export interface FeishuConfigBlock {
  appId?: string;
  appSecret?: string;
  baseUrl?: string;
  approvals?: {
    domainPurchase?: ApprovalDefinitionConfig;
    domainResolve?: ApprovalDefinitionConfig;
  };
  /** 状态轮询间隔，默认 60_000。 */
  pollIntervalMs?: number;
}

/** 飞书 API 通用错误。 */
export class FeishuError extends Error {
  readonly code: number;
  constructor(code: number, msg: string) {
    super(`[${code}] ${msg}`);
    this.code = code;
    this.name = "FeishuError";
  }
}

/**
 * 提交审批时业务字段允许的值。
 *
 * - 标量 widget：string | number | boolean
 * - contact widget：string[]（open_id 列表）
 * - fieldList widget：Array<Record<string, FormFieldValue>>（多行明细，每行是「列业务键 → 单元格值」）
 */
export type FormFieldValue =
  | string
  | number
  | boolean
  | string[]
  | Array<Record<string, string | number | boolean | string[]>>;

/** 审批表单 —— 业务字段 → 值。 */
export type ApprovalForm = Record<string, FormFieldValue>;

/** 创建审批实例的输入。userId 与 openId 至少传一个；都传时飞书优先 userId。 */
export interface CreateInstanceInput {
  approvalCode: string;
  openId?: string;
  userId?: string;
  fieldMap: Record<string, WidgetMapEntry>;
  form: ApprovalForm;
  /** 可选指定一级审批人；不传时由飞书审批定义里配置的流程决定。 */
  nodeApproverOpenIdList?: Record<string, string[]>;
}

/** 飞书审批实例查询返回的关键字段（精简后）。 */
export interface ApprovalInstanceSummary {
  instanceCode: string;
  approvalCode: string;
  approvalName: string;
  status: ApprovalStatus;
  userId?: string;
  openId?: string;
  serialNumber?: string;
  startTime?: number;
  endTime?: number;
}
