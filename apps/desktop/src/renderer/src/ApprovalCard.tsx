/**
 * 飞书审批卡片（嵌入聊天对话流）。
 *
 * 设计：
 * - 卡片完全自包含——拿到 `initialDomains`（用户输入里被解析到的域名）后，渲染对应的表单，
 *   用户在卡片上微调后点击「确认提交」即调 `window.dw.approvalSubmit`。
 * - 提交成功后卡片自身订阅 `onApprovalEvent`，按 `instanceCode` 过滤实时更新右上角状态 Pill；
 *   `RECALLED / CANCELED / REJECTED / APPROVED` 都是终态，会停止订阅。
 * - 卡片外侧使用「飞书 Logo」作为机器人头像（assets/feishu-bot.png），与图中保持一致；
 *   原来基于 `session.user.avatarUrl` 的"用户飞书头像"已弃用。
 * - 右上角的「审批中」状态胶囊**只在提交飞书审批后才出现**——draft 阶段隐藏，避免误导。
 * - 用户可点「取消卡片」就地隐藏当前卡片（仅前端隐藏，未提交则永不发起飞书审批）。
 */
import {
  useCallback,
  useEffect,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import {
  App as AntdApp,
  Avatar,
  Button,
  Card,
  ConfigProvider,
  Input,
  Segmented,
  Select,
  Space,
  Table,
  Typography,
  theme,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  CheckCircleFilled,
  CloseCircleFilled,
  CloseCircleOutlined,
  LoadingOutlined,
  PlusOutlined,
  SendOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type {
  ApprovalEvent,
  ApprovalKind,
  ApprovalStatus,
  FeishuSession,
} from "./global";
import { useRequiredFeishuSession } from "./feishuAuth.js";
import feishuBotIcon from "./assets/feishu-bot.png";

const { Text } = Typography;

/* ============================================================ */
/*  通用：状态颜色、选项常量                                       */
/* ============================================================ */

/**
 * 审批状态的视觉令牌。所有 foreground 颜色均对齐 main.tsx ConfigProvider 里的品牌色：
 *   PENDING  → colorPrimary  #5B6CFF（品牌紫蓝）
 *   APPROVED → colorSuccess  #10B981
 *   REJECTED → colorError    #EF4444
 *   终态灰   → slate-500     #6B7280
 * 背景与描边用对应色的极浅 tint，避免出现 #2563EB / #DC2626 / #059669 等
 * 不在品牌色板里的"野生颜色"。
 */
const STATUS_META: Record<
  ApprovalStatus,
  { label: string; color: string; bg: string; border: string; icon: ReactElement | null }
> = {
  PENDING: {
    label: "审批中",
    color: "#5B6CFF",
    bg: "#EEF0FF",
    border: "#D2D7FF",
    icon: <LoadingOutlined />,
  },
  APPROVED: {
    label: "已通过",
    color: "#10B981",
    bg: "#ECFDF5",
    border: "#A7F3D0",
    icon: <CheckCircleFilled />,
  },
  REJECTED: {
    label: "已拒绝",
    color: "#EF4444",
    bg: "#FEF2F2",
    border: "#FECACA",
    icon: <CloseCircleFilled />,
  },
  RECALLED: { label: "已撤回", color: "#6B7280", bg: "#F3F4F6", border: "#E5E7EB", icon: null },
  CANCELED: { label: "已取消", color: "#6B7280", bg: "#F3F4F6", border: "#E5E7EB", icon: null },
  DELETED: { label: "已删除", color: "#6B7280", bg: "#F3F4F6", border: "#E5E7EB", icon: null },
};

const TERMINAL_STATUSES: ApprovalStatus[] = [
  "APPROVED",
  "REJECTED",
  "RECALLED",
  "CANCELED",
  "DELETED",
];

const YEAR_OPTIONS = ["1年", "2年", "3年", "5年"].map((v) => ({
  label: v,
  value: v,
}));

const OPERATION_TYPE_OPTIONS = [
  { label: "新增", value: "新增" },
  { label: "修改", value: "修改" },
  { label: "删除", value: "删除" },
];

const RECORD_TYPE_OPTIONS = ["A", "CNAME", "MX", "TXT"].map((v) => ({
  label: v,
  value: v,
}));

const OPERATION_MODE_OPTIONS = [
  { label: "自动化操作", value: "自动化操作" },
  { label: "手动操作", value: "手动操作" },
];

const YES_NO_SEGMENTED = [
  { label: "是", value: "是" },
  { label: "否", value: "否" },
];

/** Segmented 品牌主题：激活项为实心品牌色胶囊 + 白字，对比更强、当前选项一眼可辨。 */
const BRAND_SEGMENTED_THEME = {
  components: {
    Segmented: {
      itemSelectedBg: "#5B6CFF",
      itemSelectedColor: "#ffffff",
      itemColor: "rgba(0, 0, 0, 0.45)",
      itemHoverColor: "#5B6CFF",
      trackBg: "rgba(0, 0, 0, 0.04)",
      trackPadding: 2,
      borderRadius: 8,
    },
  },
} as const;

/* ============================================================ */
/*  小组件：飞书头像、发起人条、状态胶囊、字段标签                  */
/* ============================================================ */

/**
 * 卡片左侧的"机器人头像"——使用打包内置的飞书 Logo（src/renderer/src/assets/feishu-bot.png）。
 * 形状为圆形（区别于聊天主流中的 AI 渐变方块），与"飞书审批"语义吻合。
 */
function FeishuBotAvatar(): ReactElement {
  return (
    <div
      aria-label="飞书审批"
      style={{
        width: 36,
        height: 36,
        borderRadius: "50%",
        background: "#fff",
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        border: "1px solid rgba(15, 23, 42, 0.06)",
        boxShadow: "0 2px 8px rgba(15, 23, 42, 0.10)",
      }}
    >
      <img
        src={feishuBotIcon}
        alt="飞书"
        draggable={false}
        style={{ width: 24, height: 24, objectFit: "contain", display: "block" }}
      />
    </div>
  );
}

/** 状态胶囊（图中右上角"审批中"那种 outlined pill 样式）。 */
function StatusPill({ status }: { status: ApprovalStatus }): ReactElement {
  const meta = STATUS_META[status];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 12px",
        borderRadius: 10,
        background: meta.bg,
        border: `1px solid ${meta.border}`,
        color: meta.color,
        fontSize: 13,
        fontWeight: 500,
      }}
    >
      {meta.icon}
      {meta.label}
    </span>
  );
}

/**
 * 卡片标题左侧的小品牌图标——使用与顶部导航、登录页、AI 助手头像同源的品牌渐变
 * (#5B6CFF → #06B6D4)，让整页配色保持统一；左侧的飞书 Logo 头像已经传达了"飞书"语义。
 */
function CardTitleIcon(): ReactElement {
  return (
    <span
      style={{
        display: "inline-flex",
        width: 20,
        height: 20,
        borderRadius: 6,
        background: "#5B6CFF",
        color: "#fff",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        boxShadow: "0 2px 6px rgba(91, 108, 255, 0.30)",
      }}
    >
      <SendOutlined style={{ fontSize: 11 }} />
    </span>
  );
}

/**
 * 发起人小条（图中：头像 + 姓名(user_id) / 「发起人」灰色副标题）。
 * 不再用方框背景，改为纯 inline 排版，与图保持一致。
 */
function InitiatorBadge({ session }: { session: FeishuSession }): ReactElement {
  const { token } = theme.useToken();
  const initial = (session.user.name || "U").trim().slice(0, 1).toUpperCase();
  const shortUid = session.user.userId
    ? session.user.userId.slice(-8)
    : "—";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <Avatar
        size={32}
        src={session.user.avatarUrl}
        icon={!session.user.avatarUrl ? <UserOutlined /> : undefined}
        style={{
          background: session.user.avatarUrl ? "transparent" : token.colorPrimary,
          color: "#fff",
          fontWeight: 600,
        }}
      >
        {!session.user.avatarUrl ? initial : null}
      </Avatar>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
        <Text style={{ fontSize: 13, fontWeight: 500 }}>
          {session.user.name}
          <Text type="secondary" style={{ marginLeft: 6, fontSize: 12 }}>
            ({shortUid})
          </Text>
        </Text>
        <Text type="secondary" style={{ fontSize: 11.5 }}>
          发起人
        </Text>
      </div>
    </div>
  );
}

/** 行内字段标签（图中"境内提供服务:" / "ICP 备案:" 这种 inline label）。 */
function InlineFieldRow({
  label,
  required,
  children,
  labelWidth = 110,
}: {
  label: string;
  required?: boolean;
  children: ReactElement;
  labelWidth?: number;
}): ReactElement {
  const { token } = theme.useToken();
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <Text
        style={{
          width: labelWidth,
          flexShrink: 0,
          fontSize: 13,
          color: token.colorText,
          fontWeight: 500,
        }}
      >
        {label}
        {required ? <span style={{ color: token.colorError, marginLeft: 4 }}>*</span> : null}
        ：
      </Text>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

/** 块状字段标签（图中"申请说明"那种 label 在上、控件在下的布局）。 */
function StackedFieldRow({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: ReactElement;
}): ReactElement {
  const { token } = theme.useToken();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <Text style={{ fontSize: 13, color: token.colorText, fontWeight: 500 }}>
        {label}
        {required ? <span style={{ color: token.colorError, marginLeft: 4 }}>*</span> : null}
      </Text>
      <div>{children}</div>
    </div>
  );
}

/* ============================================================ */
/*  CardChrome （卡片外壳 = 飞书头像 + 卡片本体）                  */
/* ============================================================ */

interface CardChromeProps {
  kind: ApprovalKind;
  status:
    | { phase: "draft" }
    | { phase: "submitted"; instanceCode: string; approvalStatus: ApprovalStatus };
  error?: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactElement;
}

function CardChrome({
  kind,
  status,
  error,
  busy,
  onConfirm,
  onCancel,
  children,
}: CardChromeProps): ReactElement {
  const { token } = theme.useToken();
  const title = kind === "domain-purchase" ? "[域名购买] 飞书审批" : "[域名解析] 飞书审批";

  // 仅在「已成功提交飞书审批」之后才展示状态胶囊，避免 draft 阶段误展示"审批中"。
  const headerRight =
    status.phase === "submitted" ? (
      <Space size={8}>
        <StatusPill status={status.approvalStatus} />
        <Text
          type="secondary"
          style={{ fontSize: 11.5 }}
          copyable={{ text: status.instanceCode }}
        >
          {status.instanceCode}
        </Text>
      </Space>
    ) : null;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        margin: "10px 0",
      }}
    >
      {/* 左侧：机器人头像（飞书 Logo） */}
      <FeishuBotAvatar />

      {/* 右侧：卡片本体 */}
      <Card
        style={{
          flex: 1,
          minWidth: 0,
          borderRadius: 16,
          border: `1px solid ${token.colorBorderSecondary}`,
          boxShadow: "0 4px 18px rgba(15, 23, 42, 0.05)",
        }}
        styles={{ body: { padding: 0 } }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 18px",
            borderBottom: `1px solid ${token.colorBorderSecondary}`,
            gap: 12,
          }}
        >
          <Space size={8} style={{ minWidth: 0 }}>
            <CardTitleIcon />
            <Text strong style={{ fontSize: 14 }}>
              {title}
            </Text>
          </Space>
          {headerRight}
        </div>

        {/* Body */}
        <div style={{ padding: 18 }}>
          {children}

          {error ? (
            <div
              style={{
                marginTop: 12,
                padding: "8px 12px",
                borderRadius: 8,
                background: token.colorErrorBg,
                border: `1px solid ${token.colorErrorBorder}`,
                color: token.colorError,
                fontSize: 12,
              }}
            >
              <CloseCircleOutlined /> {error}
            </div>
          ) : null}
        </div>

        {/* Footer (draft 阶段才显示提交/取消) */}
        {status.phase === "draft" ? (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              padding: "12px 18px 16px 18px",
              borderTop: `1px solid ${token.colorBorderSecondary}`,
            }}
          >
            <Button onClick={onCancel} disabled={busy}>
              取消卡片
            </Button>
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={busy}
              onClick={onConfirm}
            >
              确认提交到飞书审批
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

/* ============================================================ */
/*  域名购买卡片                                                   */
/* ============================================================ */

interface PurchaseRow {
  name: string;
  years: string;
}

interface PurchaseState {
  rows: PurchaseRow[];
  providedInChinaMainland: string;
  icpFiled: string;
  reason: string;
}

function makePurchaseState(initialDomains: string[]): PurchaseState {
  const rows = initialDomains.length
    ? initialDomains.map((d) => ({ name: d, years: "1年" }))
    : [{ name: "", years: "1年" }];
  return {
    rows,
    providedInChinaMainland: "否",
    icpFiled: "否",
    reason: "",
  };
}

export function PurchaseApprovalCard({
  initialDomains,
}: {
  initialDomains: string[];
  /** 兼容旧参数：保留接口但不再展示在卡片里。 */
  originalInput?: string;
}): ReactElement | null {
  const { message } = AntdApp.useApp();
  const session = useRequiredFeishuSession();
  const [state, setState] = useState<PurchaseState>(() => makePurchaseState(initialDomains));
  const [phase, setPhase] = useState<"draft" | "submitting" | "submitted">("draft");
  const [instanceCode, setInstanceCode] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>("PENDING");
  const [error, setError] = useState<string | undefined>(undefined);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!instanceCode) return undefined;
    const off = window.dw.onApprovalEvent((ev: ApprovalEvent) => {
      if (ev.item.instanceCode !== instanceCode) return;
      setApprovalStatus(ev.item.status);
    });
    return off;
  }, [instanceCode]);

  const updateRow = useCallback((idx: number, patch: Partial<PurchaseRow>) => {
    setState((prev) => {
      const next = [...prev.rows];
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, rows: next };
    });
  }, []);

  const addRow = useCallback(() => {
    setState((prev) => ({ ...prev, rows: [...prev.rows, { name: "", years: "1年" }] }));
  }, []);

  const removeRow = useCallback((idx: number) => {
    setState((prev) => {
      const next = prev.rows.filter((_, i) => i !== idx);
      return { ...prev, rows: next.length ? next : [{ name: "", years: "1年" }] };
    });
  }, []);

  const onConfirm = useCallback(async () => {
    setError(undefined);
    const normalized = state.rows
      .map((r) => ({ name: r.name.trim().toLowerCase(), years: r.years }))
      .filter((r) => r.name.length > 0);
    if (normalized.length === 0) {
      setError("至少填写一条购买域名");
      return;
    }
    setPhase("submitting");
    try {
      const r = await window.dw.approvalSubmit({
        kind: "domain-purchase",
        domain: normalized[0]!.name,
        initiatorUserId: session.user.userId,
        form: {
          applicationType: "域名购买",
          domainList: normalized,
          providedInChinaMainland: state.providedInChinaMainland,
          icpFiled: state.icpFiled,
          reason: state.reason.trim(),
        },
      });
      if (!r.ok) {
        setError(r.error ?? "提交失败");
        setPhase("draft");
        return;
      }
      setInstanceCode(r.instanceCode ?? null);
      setApprovalStatus("PENDING");
      setPhase("submitted");
      message.success(`已提交：${r.instanceCode}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("draft");
    }
  }, [session, message, state]);

  const isLocked = phase !== "draft";
  const reachedTerminal =
    phase === "submitted" && TERMINAL_STATUSES.includes(approvalStatus);

  if (dismissed) return null;

  const purchaseColumns: ColumnsType<PurchaseRow & { _idx: number }> = [
    {
      title: "域名",
      dataIndex: "name",
      render: (_v, row) => (
        <Input
          variant="borderless"
          value={row.name}
          placeholder="adc.com"
          onChange={(e) => updateRow(row._idx, { name: e.target.value })}
          disabled={isLocked}
          style={{ padding: 0, fontSize: 13 }}
        />
      ),
    },
    {
      title: "时长",
      dataIndex: "years",
      width: 140,
      render: (_v, row) => (
        <Select
          variant="borderless"
          value={row.years}
          onChange={(v) => updateRow(row._idx, { years: v })}
          options={YEAR_OPTIONS}
          disabled={isLocked}
          style={{ width: "100%" }}
        />
      ),
    },
    {
      title: "操作",
      width: 80,
      align: "left",
      render: (_v, row) => (
        <Button
          size="small"
          type="link"
          danger
          onClick={() => removeRow(row._idx)}
          disabled={isLocked || state.rows.length === 1}
          style={{ padding: 0 }}
        >
          删除
        </Button>
      ),
    },
  ];

  return (
    <CardChrome
      kind="domain-purchase"
      status={
        phase === "submitted" && instanceCode
          ? { phase: "submitted", instanceCode, approvalStatus }
          : { phase: "draft" }
      }
      error={error}
      busy={phase === "submitting"}
      onConfirm={() => void onConfirm()}
      onCancel={() => setDismissed(true)}
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <InitiatorBadge session={session} />

        <Table<PurchaseRow & { _idx: number }>
          size="middle"
          rowKey="_idx"
          dataSource={state.rows.map((row, _idx) => ({ ...row, _idx }))}
          pagination={false}
          columns={purchaseColumns}
        />

        {!isLocked ? (
          <Button
            block
            type="dashed"
            icon={<PlusOutlined />}
            onClick={addRow}
            style={{ width: 160, borderRadius: 8 }}
          >
            新增域名
          </Button>
        ) : null}

        <InlineFieldRow label="境内提供服务" required>
          <ConfigProvider theme={BRAND_SEGMENTED_THEME}>
            <Segmented
              value={state.providedInChinaMainland}
              onChange={(v) =>
                setState((p) => ({ ...p, providedInChinaMainland: v as string }))
              }
              options={YES_NO_SEGMENTED}
              disabled={isLocked}
              style={{ fontWeight: 600 }}
            />
          </ConfigProvider>
        </InlineFieldRow>

        <InlineFieldRow label="ICP 备案" required>
          <ConfigProvider theme={BRAND_SEGMENTED_THEME}>
            <Segmented
              value={state.icpFiled}
              onChange={(v) => setState((p) => ({ ...p, icpFiled: v as string }))}
              options={YES_NO_SEGMENTED}
              disabled={isLocked}
              style={{ fontWeight: 600 }}
            />
          </ConfigProvider>
        </InlineFieldRow>

        <StackedFieldRow label="申请说明">
          <Input.TextArea
            value={state.reason}
            onChange={(e) => setState((p) => ({ ...p, reason: e.target.value }))}
            autoSize={{ minRows: 3, maxRows: 6 }}
            placeholder="请填写申请说明（选填）"
            maxLength={500}
            showCount
            disabled={isLocked}
          />
        </StackedFieldRow>

        {reachedTerminal ? (
          <Text type="secondary" style={{ fontSize: 12 }}>
            状态已终态，无需继续等待。
          </Text>
        ) : null}
      </Space>
    </CardChrome>
  );
}

/* ============================================================ */
/*  域名解析卡片                                                   */
/* ============================================================ */

interface ResolveRow {
  operationType: string;
  prefix: string;
  name: string;
  recordType: string;
  value: string;
  isAdvanced: string;
}

interface ResolveState {
  rows: ResolveRow[];
  operationMode: string;
  reason: string;
}

function emptyResolveRow(name = ""): ResolveRow {
  return {
    operationType: "新增",
    prefix: "@",
    name,
    recordType: "A",
    value: "",
    isAdvanced: "否",
  };
}

function makeResolveState(initialDomains: string[], initialValue = ""): ResolveState {
  let rows: ResolveRow[];
  if (!initialDomains.length) {
    rows = [initialValue ? { ...emptyResolveRow(), value: initialValue } : emptyResolveRow()];
  } else if (initialValue) {
    // 用户输入里带了解析地址（IP）：每个域名默认生成两条记录——
    // 前缀「@」与前缀「tracking」，解析地址都预填该 IP。
    rows = initialDomains.flatMap((d) => [
      { ...emptyResolveRow(d), prefix: "@", value: initialValue },
      { ...emptyResolveRow(d), prefix: "tracking", value: initialValue },
    ]);
  } else {
    rows = initialDomains.map((d) => emptyResolveRow(d));
  }
  return { rows, operationMode: "自动化操作", reason: "" };
}

export function ResolveApprovalCard({
  initialDomains,
  initialValue = "",
}: {
  initialDomains: string[];
  /** 从用户输入里解析出的解析地址（IP）；非空时默认填充并生成 @ / tracking 两条记录。 */
  initialValue?: string;
  originalInput?: string;
}): ReactElement | null {
  const { message } = AntdApp.useApp();
  const session = useRequiredFeishuSession();
  const [state, setState] = useState<ResolveState>(() =>
    makeResolveState(initialDomains, initialValue),
  );
  const [phase, setPhase] = useState<"draft" | "submitting" | "submitted">("draft");
  const [instanceCode, setInstanceCode] = useState<string | null>(null);
  const [approvalStatus, setApprovalStatus] = useState<ApprovalStatus>("PENDING");
  const [error, setError] = useState<string | undefined>(undefined);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!instanceCode) return undefined;
    const off = window.dw.onApprovalEvent((ev: ApprovalEvent) => {
      if (ev.item.instanceCode !== instanceCode) return;
      setApprovalStatus(ev.item.status);
    });
    return off;
  }, [instanceCode]);

  const updateRow = useCallback((idx: number, patch: Partial<ResolveRow>) => {
    setState((prev) => {
      const next = [...prev.rows];
      next[idx] = { ...next[idx], ...patch };
      return { ...prev, rows: next };
    });
  }, []);

  const addRow = useCallback(() => {
    setState((prev) => ({ ...prev, rows: [...prev.rows, emptyResolveRow()] }));
  }, []);

  const removeRow = useCallback((idx: number) => {
    setState((prev) => {
      const next = prev.rows.filter((_, i) => i !== idx);
      return { ...prev, rows: next.length ? next : [emptyResolveRow()] };
    });
  }, []);

  const onConfirm = useCallback(async () => {
    setError(undefined);
    const normalized = state.rows
      .map((r) => ({
        operationType: r.operationType,
        prefix: r.prefix.trim() || "@",
        name: r.name.trim().toLowerCase(),
        recordType: r.recordType,
        value: r.value.trim(),
        isAdvanced: r.isAdvanced,
      }))
      .filter((r) => r.name.length > 0);
    if (normalized.length === 0) {
      setError("至少填写一条域名解析明细");
      return;
    }
    const missingValue = normalized.find((r) => !r.value);
    if (missingValue) {
      setError(`${missingValue.name} 缺少域名解析地址`);
      return;
    }
    setPhase("submitting");
    try {
      const r = await window.dw.approvalSubmit({
        kind: "domain-resolve",
        domain: normalized[0]!.name,
        initiatorUserId: session.user.userId,
        form: {
          applicationType: "域名解析",
          domainResolveList: normalized,
          operationMode: state.operationMode,
          reason: state.reason.trim(),
        },
      });
      if (!r.ok) {
        setError(r.error ?? "提交失败");
        setPhase("draft");
        return;
      }
      setInstanceCode(r.instanceCode ?? null);
      setApprovalStatus("PENDING");
      setPhase("submitted");
      message.success(`已提交：${r.instanceCode}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("draft");
    }
  }, [session, message, state]);

  const isLocked = phase !== "draft";

  if (dismissed) return null;

  const borderlessInputStyle: CSSProperties = { padding: 0, fontSize: 13 };

  const resolveColumns: ColumnsType<ResolveRow & { _idx: number }> = [
    {
      title: "操作",
      dataIndex: "operationType",
      width: 90,
      render: (_v, row) => (
        <Select
          variant="borderless"
          value={row.operationType}
          onChange={(v) => updateRow(row._idx, { operationType: v })}
          options={OPERATION_TYPE_OPTIONS}
          disabled={isLocked}
          style={{ width: "100%" }}
        />
      ),
    },
    {
      title: "前缀",
      dataIndex: "prefix",
      width: 90,
      render: (_v, row) => (
        <Input
          variant="borderless"
          value={row.prefix}
          placeholder="@"
          onChange={(e) => updateRow(row._idx, { prefix: e.target.value })}
          disabled={isLocked}
          style={borderlessInputStyle}
        />
      ),
    },
    {
      title: "域名",
      dataIndex: "name",
      render: (_v, row) => (
        <Input
          variant="borderless"
          value={row.name}
          placeholder="abc.com"
          onChange={(e) => updateRow(row._idx, { name: e.target.value })}
          disabled={isLocked}
          style={borderlessInputStyle}
        />
      ),
    },
    {
      title: "类型",
      dataIndex: "recordType",
      width: 90,
      render: (_v, row) => (
        <Select
          variant="borderless"
          value={row.recordType}
          onChange={(v) => updateRow(row._idx, { recordType: v })}
          options={RECORD_TYPE_OPTIONS}
          disabled={isLocked}
          style={{ width: "100%" }}
        />
      ),
    },
    {
      title: "解析地址",
      dataIndex: "value",
      width: 170,
      render: (_v, row) => (
        <Input
          variant="borderless"
          value={row.value}
          placeholder="目标 IP / 主机名"
          onChange={(e) => updateRow(row._idx, { value: e.target.value })}
          disabled={isLocked}
          style={borderlessInputStyle}
        />
      ),
    },
    {
      title: "操作",
      width: 70,
      align: "left",
      render: (_v, row) => (
        <Button
          size="small"
          type="link"
          danger
          onClick={() => removeRow(row._idx)}
          disabled={isLocked || state.rows.length === 1}
          style={{ padding: 0 }}
        >
          删除
        </Button>
      ),
    },
  ];

  return (
    <CardChrome
      kind="domain-resolve"
      status={
        phase === "submitted" && instanceCode
          ? { phase: "submitted", instanceCode, approvalStatus }
          : { phase: "draft" }
      }
      error={error}
      busy={phase === "submitting"}
      onConfirm={() => void onConfirm()}
      onCancel={() => setDismissed(true)}
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <InitiatorBadge session={session} />

        <Table<ResolveRow & { _idx: number }>
          size="middle"
          rowKey="_idx"
          dataSource={state.rows.map((row, _idx) => ({ ...row, _idx }))}
          pagination={false}
          scroll={{ x: 720 }}
          columns={resolveColumns}
        />

        {!isLocked ? (
          <Button
            block
            type="dashed"
            icon={<PlusOutlined />}
            onClick={addRow}
            style={{ width: 160, borderRadius: 8 }}
          >
            新增解析
          </Button>
        ) : null}

        <InlineFieldRow label="操作方式" required>
          <ConfigProvider theme={BRAND_SEGMENTED_THEME}>
            <Segmented
              value={state.operationMode}
              onChange={(v) => setState((p) => ({ ...p, operationMode: v as string }))}
              options={OPERATION_MODE_OPTIONS}
              disabled={isLocked}
              style={{ fontWeight: 600 }}
            />
          </ConfigProvider>
        </InlineFieldRow>

        <StackedFieldRow label="申请说明">
          <Input.TextArea
            value={state.reason}
            onChange={(e) => setState((p) => ({ ...p, reason: e.target.value }))}
            autoSize={{ minRows: 3, maxRows: 6 }}
            placeholder="请填写申请说明（选填）"
            maxLength={500}
            showCount
            disabled={isLocked}
          />
        </StackedFieldRow>
      </Space>
    </CardChrome>
  );
}
