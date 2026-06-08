/**
 * 左侧聊天历史侧栏 + 只读历史详情视图。
 *
 * - 数据源：主进程 `chat-history` 存储，通过 IPC `history:list / get` 拉取，
 *   实时变更走 `history:changed` 事件订阅；本组件无本地业务状态，纯展示。
 * - 列表：按 startedAt 倒序，按"今天 / 昨天 / 更早"分组；每条显示 domain + 状态 + 时间。
 * - 选中：通过受控 prop（`selectedId / onSelect`）由上层管理；点击同一项会取消选中（回到 live 模式）。
 * - 详情：`HistorySessionView` 只读回放 prompt + 累积 chunk + 元信息（agentId/runId 可复制）。
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
} from "react";
import {
  App as AntdApp,
  Button,
  Empty,
  Image,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import {
  AuditOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  DeleteOutlined,
  EyeOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
  MinusCircleOutlined,
  PlusOutlined,
  RobotOutlined,
  StopOutlined,
} from "@ant-design/icons";
import type {
  ApprovalKind,
  ApprovalStatus,
  ApprovalTrackerItem,
  ChatHistoryChunk,
  ChatSession,
  ChatSessionStatus,
  SiteProduct,
} from "./global";
import { Markdown } from "./chatCommon.js";

const { Text } = Typography;

const STATUS_META: Record<
  ChatSessionStatus,
  { label: string; color: string; dot: string; icon: ReactElement }
> = {
  running: { label: "进行中", color: "processing", dot: "#5B6CFF", icon: <LoadingOutlined /> },
  done: { label: "完成", color: "success", dot: "#10B981", icon: <CheckCircleOutlined /> },
  error: { label: "失败", color: "error", dot: "#EF4444", icon: <CloseCircleOutlined /> },
  cancelled: { label: "已取消", color: "default", dot: "#94A3B8", icon: <StopOutlined /> },
};

const APPROVAL_STATUS_META: Record<
  ApprovalStatus,
  { label: string; color: string; dot: string }
> = {
  PENDING: { label: "审批中", color: "processing", dot: "#5B6CFF" },
  APPROVED: { label: "已通过", color: "success", dot: "#10B981" },
  REJECTED: { label: "已拒绝", color: "error", dot: "#EF4444" },
  RECALLED: { label: "已撤回", color: "default", dot: "#94A3B8" },
  CANCELED: { label: "已取消", color: "default", dot: "#94A3B8" },
  DELETED: { label: "已删除", color: "default", dot: "#94A3B8" },
};

const APPROVAL_KIND_LABEL: Record<ApprovalKind, string> = {
  "domain-purchase": "域名购买",
  "domain-resolve": "域名解析",
};

/** 统一的历史时间线条目：建站会话 + 飞书审批 两类合一。 */
type HistoryEntry =
  | { kind: "chat"; id: string; ts: number; session: ChatSession }
  | { kind: "approval"; id: string; ts: number; approval: ApprovalTrackerItem };

interface ChatHistoryPanelProps {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onNewChat: () => void;
  /** 当前正在跑的 taskId（用于在列表里高亮 + 强制刷新） */
  liveTaskId: string | null;
}

export function ChatHistoryPanel({
  selectedId,
  onSelect,
  onNewChat,
  liveTaskId,
}: ChatHistoryPanelProps): ReactElement {
  const { token } = theme.useToken();
  const { message } = AntdApp.useApp();
  const [items, setItems] = useState<ChatSession[]>([]);
  const [approvals, setApprovals] = useState<ApprovalTrackerItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [chats, appr] = await Promise.all([
          window.dw.historyList(),
          window.dw.approvalList(),
        ]);
        if (!cancelled) {
          setItems(chats.items);
          setApprovals(appr.items);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    const offHistory = window.dw.onHistoryChanged((payload) => {
      if (!cancelled) setItems(payload.items);
    });
    const offApproval = window.dw.onApprovalEvent(() => {
      if (cancelled) return;
      // 审批事件只携带单条；为简单与一致，直接重新拉全量快照。
      void window.dw.approvalList().then((r) => {
        if (!cancelled) setApprovals(r.items);
      });
    });
    return () => {
      cancelled = true;
      offHistory();
      offApproval();
    };
  }, []);

  const entries = useMemo<HistoryEntry[]>(() => {
    const chatEntries: HistoryEntry[] = items.map((s) => ({
      kind: "chat",
      id: s.id,
      ts: s.startedAt,
      session: s,
    }));
    const approvalEntries: HistoryEntry[] = approvals.map((a) => ({
      kind: "approval",
      id: a.instanceCode,
      ts: a.submittedAt,
      approval: a,
    }));
    return [...chatEntries, ...approvalEntries].sort((a, b) => b.ts - a.ts);
  }, [items, approvals]);

  const grouped = useMemo(() => groupByDay(entries), [entries]);

  const onDelete = useCallback(
    async (id: string) => {
      await window.dw.historyDelete(id);
      if (selectedId === id) onSelect(null);
      message.success("已删除");
    },
    [selectedId, onSelect, message],
  );

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#FAFBFD",
      }}
    >
      <div style={{ padding: "14px 14px 10px" }}>
        <Text
          strong
          style={{ display: "block", marginBottom: 12, fontSize: 14, color: token.colorText }}
        >
          历史会话
        </Text>
        <Button
          icon={<PlusOutlined />}
          block
          onClick={() => {
            onSelect(null);
            onNewChat();
          }}
          style={{
            height: 36,
            borderRadius: 10,
            border: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorBgContainer,
            color: token.colorText,
            fontWeight: 500,
          }}
        >
          新建对话
        </Button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "8px 4px 16px" }}>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center" }}>
            <Spin size="small" />
          </div>
        ) : entries.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<Text type="secondary">暂无历史记录</Text>}
            style={{ marginTop: 32 }}
          />
        ) : (
          grouped.map((group) => (
            <div key={group.label} style={{ marginBottom: 10 }}>
              <div
                style={{
                  padding: "8px 12px 4px",
                  fontSize: 11,
                  color: token.colorTextTertiary,
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                }}
              >
                {group.label}
              </div>
              {group.items.map((entry) =>
                entry.kind === "chat" ? (
                  <HistoryItem
                    key={entry.id}
                    session={entry.session}
                    active={entry.id === selectedId}
                    live={entry.id === liveTaskId}
                    onClick={() => onSelect(entry.id === selectedId ? null : entry.id)}
                    onDelete={() => void onDelete(entry.id)}
                  />
                ) : (
                  <ApprovalHistoryItem
                    key={entry.id}
                    approval={entry.approval}
                    active={entry.id === selectedId}
                    onClick={() => onSelect(entry.id === selectedId ? null : entry.id)}
                  />
                ),
              )}
            </div>
          ))
        )}
      </div>

    </div>
  );
}

function HistoryItem({
  session,
  active,
  live,
  onClick,
  onDelete,
}: {
  session: ChatSession;
  active: boolean;
  live: boolean;
  onClick: () => void;
  onDelete: () => void;
}): ReactElement {
  const { token } = theme.useToken();
  const meta = STATUS_META[session.status];
  const title =
    session.mode === "ai-full"
      ? session.domain ?? "(未命名)"
      : `批量 · ${session.domains?.length ?? 0} 个域名`;
  const preview = session.prompt?.trim() || (session.mode === "ai-full" ? "(无 prompt)" : "");
  const ACTIVE_BG = "#EFEAFB"; // 浅紫色（与用户气泡同源），比 colorPrimaryBg 更柔和

  return (
    <div
      onClick={onClick}
      role="button"
      style={{
        position: "relative",
        margin: "2px 10px",
        padding: "10px 12px",
        borderRadius: 12,
        cursor: "pointer",
        background: active ? ACTIVE_BG : live ? token.colorInfoBg : "transparent",
        transition: "background 0.12s",
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLDivElement).style.background = token.colorFillTertiary;
      }}
      onMouseLeave={(e) => {
        if (!active) {
          (e.currentTarget as HTMLDivElement).style.background = live
            ? token.colorInfoBg
            : "transparent";
        }
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        {/* 状态色点 */}
        <Tooltip title={meta.label} placement="top">
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: meta.dot,
              flexShrink: 0,
              boxShadow:
                session.status === "running"
                  ? `0 0 0 3px ${meta.dot}22`
                  : "none",
            }}
          />
        </Tooltip>
        <Text
          strong
          ellipsis
          style={{ flex: 1, fontSize: 13.5, color: token.colorText }}
        >
          {title}
        </Text>
        <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>
          {formatTime(session.startedAt)}
        </Text>
      </div>
      {preview ? (
        <div
          style={{
            fontSize: 12,
            color: token.colorTextSecondary,
            marginTop: 4,
            marginLeft: 16,
            overflow: "hidden",
            display: "-webkit-box",
            WebkitLineClamp: 1,
            WebkitBoxOrient: "vertical",
            wordBreak: "break-word",
          }}
        >
          {preview}
        </div>
      ) : null}
      {/* 删除按钮：默认隐藏，hover 浮现于右下角 */}
      <Popconfirm
        title="删除这条历史？"
        okText="删除"
        okType="danger"
        cancelText="取消"
        onConfirm={(e) => {
          e?.stopPropagation();
          onDelete();
        }}
        onCancel={(e) => e?.stopPropagation()}
      >
        <Button
          size="small"
          type="text"
          danger
          icon={<DeleteOutlined />}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            right: 4,
            bottom: 4,
            opacity: 0,
            transition: "opacity 0.15s",
          }}
          className="dw-history-delete-btn"
        />
      </Popconfirm>
    </div>
  );
}

function ApprovalHistoryItem({
  approval,
  active,
  onClick,
}: {
  approval: ApprovalTrackerItem;
  active: boolean;
  onClick: () => void;
}): ReactElement {
  const { token } = theme.useToken();
  const meta = APPROVAL_STATUS_META[approval.status];
  const title = `${APPROVAL_KIND_LABEL[approval.kind]} · ${approval.domain || "(无域名)"}`;
  const ACTIVE_BG = "#EFEAFB";

  return (
    <div
      onClick={onClick}
      role="button"
      style={{
        position: "relative",
        margin: "2px 10px",
        padding: "10px 12px",
        borderRadius: 12,
        cursor: "pointer",
        background: active ? ACTIVE_BG : "transparent",
        transition: "background 0.12s",
      }}
      onMouseEnter={(e) => {
        if (!active) (e.currentTarget as HTMLDivElement).style.background = token.colorFillTertiary;
      }}
      onMouseLeave={(e) => {
        if (!active) (e.currentTarget as HTMLDivElement).style.background = "transparent";
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <Tooltip title={meta.label} placement="top">
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: meta.dot,
              flexShrink: 0,
              boxShadow:
                approval.status === "PENDING" ? `0 0 0 3px ${meta.dot}22` : "none",
            }}
          />
        </Tooltip>
        <AuditOutlined style={{ fontSize: 12, color: token.colorTextTertiary, flexShrink: 0 }} />
        <Text strong ellipsis style={{ flex: 1, fontSize: 13.5, color: token.colorText }}>
          {title}
        </Text>
        <Text type="secondary" style={{ fontSize: 11, flexShrink: 0 }}>
          {formatTime(approval.submittedAt)}
        </Text>
      </div>
      <div
        style={{
          fontSize: 12,
          color: token.colorTextSecondary,
          marginTop: 4,
          marginLeft: 16,
        }}
      >
        飞书审批 · {meta.label}
      </div>
    </div>
  );
}

/** 只读历史详情：被 BuildChat 选中某条历史时取代主对话区渲染。 */
export function HistorySessionView({
  sessionId,
  onBack,
}: {
  sessionId: string;
  onBack: () => void;
}): ReactElement {
  const { token } = theme.useToken();
  const [session, setSession] = useState<ChatSession | null>(null);
  const [approval, setApproval] = useState<ApprovalTrackerItem | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSession(null);
    setApproval(null);
    void (async () => {
      const r = await window.dw.historyGet(sessionId);
      if (cancelled) return;
      if (r.session) {
        setSession(r.session);
        setLoading(false);
        return;
      }
      // 不是建站会话 → 尝试当作飞书审批（id = instanceCode）。
      const appr = await window.dw.approvalList();
      if (cancelled) return;
      setApproval(appr.items.find((x) => x.instanceCode === sessionId) ?? null);
      setLoading(false);
    })();
    const offHistory = window.dw.onHistoryChanged((payload) => {
      if (cancelled) return;
      const fresh = payload.items.find((x) => x.id === sessionId);
      if (fresh) setSession(fresh);
    });
    const offApproval = window.dw.onApprovalEvent((ev) => {
      if (cancelled) return;
      if (ev.item.instanceCode === sessionId) setApproval(ev.item);
    });
    return () => {
      cancelled = true;
      offHistory();
      offApproval();
    };
  }, [sessionId]);

  if (loading) {
    return (
      <div style={{ padding: 60, textAlign: "center" }}>
        <Spin />
      </div>
    );
  }
  if (approval) {
    return <ApprovalSessionView approval={approval} onBack={onBack} />;
  }
  if (!session) {
    return (
      <Empty description="该历史已被删除" style={{ marginTop: 60 }}>
        <Button onClick={onBack}>返回</Button>
      </Empty>
    );
  }

  const meta = STATUS_META[session.status];
  const durationMs = (session.finishedAt ?? Date.now()) - session.startedAt;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: 480 }}>
      <div
        style={{
          padding: "10px 14px",
          background: token.colorFillAlter,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <Space size={8} style={{ minWidth: 0 }}>
          <Tag color={meta.color} icon={meta.icon}>
            {meta.label}
          </Tag>
          <Text strong style={{ fontSize: 13 }}>
            {session.mode === "ai-full"
              ? session.domain ?? "(未命名)"
              : `批量 · ${session.domains?.length ?? 0} 个域名`}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {formatTime(session.startedAt)} · {formatDuration(durationMs)}
          </Text>
        </Space>
        <Button size="small" onClick={onBack}>
          返回当前对话
        </Button>
      </div>

      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        <Space size={10} wrap>
          {session.agentId ? (
            <Tooltip title="Cursor SDK agent_id（可用于 Agent.resume / Agent.get 复盘）">
              <Text type="secondary" copyable={{ text: session.agentId }} style={{ fontSize: 11 }}>
                agentId: {ellipsisMid(session.agentId, 14)}
              </Text>
            </Tooltip>
          ) : null}
          {session.runId ? (
            <Tooltip title="Cursor SDK run_id（可用于 Agent.getRun 取 conversation）">
              <Text type="secondary" copyable={{ text: session.runId }} style={{ fontSize: 11 }}>
                runId: {ellipsisMid(session.runId, 14)}
              </Text>
            </Tooltip>
          ) : null}
          <Text type="secondary" copyable={{ text: session.id }} style={{ fontSize: 11 }}>
            taskId: {ellipsisMid(session.id, 14)}
          </Text>
        </Space>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        {session.prompt ? (
          <PromptBubble text={session.prompt} />
        ) : null}
        <ProductGallery
          domains={
            session.mode === "ai-full"
              ? session.domain
                ? [session.domain]
                : []
              : session.domains ?? []
          }
        />
        <AssistantTranscript chunks={session.chunks} />
        {session.errorMessage ? (
          <div
            style={{
              marginTop: 12,
              padding: "10px 12px",
              borderRadius: 10,
              background: token.colorErrorBg,
              border: `1px solid ${token.colorErrorBorder}`,
              color: token.colorError,
              fontSize: 12,
            }}
          >
            <MinusCircleOutlined /> {session.errorMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PromptBubble({ text }: { text: string }): ReactElement {
  const { token } = theme.useToken();
  return (
    <div style={{ display: "flex", flexDirection: "row-reverse", margin: "10px 0", gap: 10 }}>
      <div
        style={{
          maxWidth: "78%",
          background: token.colorPrimary,
          color: "#fff",
          padding: "10px 14px",
          borderRadius: 14,
          whiteSpace: "pre-wrap",
          fontSize: 13,
          lineHeight: 1.55,
        }}
      >
        {text}
      </div>
    </div>
  );
}

function AssistantTranscript({ chunks }: { chunks: ChatHistoryChunk[] }): ReactElement {
  const { token } = theme.useToken();
  const text = useMemo(() => {
    // AI 是逐 token 流式输出的：text 片段必须「直接拼接」还原成连续正文
    // （片段内部自带换行 / Markdown），切勿用 \n join，否则每个词都会单独成行。
    // 只有 info / error / done 这类「整段消息」才在前面补一个换行。
    let out = "";
    for (const c of chunks) {
      if (c.type === "text") {
        out += c.text;
        continue;
      }
      const piece =
        c.type === "info"
          ? `· ${c.text}`
          : c.type === "error"
            ? c.text
              ? `[error] ${c.text}`
              : ""
            : c.text ?? ""; // done
      if (!piece) continue;
      out += (out && !out.endsWith("\n") ? "\n" : "") + piece;
    }
    return out;
  }, [chunks]);

  if (!text.trim()) {
    return (
      <div style={{ color: token.colorTextTertiary, fontSize: 12, margin: "12px 0" }}>
        (尚无输出)
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "row", margin: "10px 0", gap: 10 }}>
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 12,
          background: "#5B6CFF",
          color: "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          boxShadow: "0 3px 8px rgba(91, 108, 255, 0.28)",
        }}
      >
        <RobotOutlined />
      </div>
      <div
        style={{
          maxWidth: "82%",
          background: token.colorBgContainer,
          color: token.colorText,
          padding: "12px 16px",
          borderRadius: 14,
          border: `1px solid ${token.colorBorderSecondary}`,
          wordBreak: "break-word",
          fontSize: 13,
          lineHeight: 1.6,
        }}
      >
        <Markdown text={text} />
      </div>
    </div>
  );
}

/**
 * 产物画廊：展示该会话生成的站点（域名 → Logo 缩略图 + 本地路径）。
 * - 点击图片：antd Image 自带灯箱预览。
 * - 「预览整站」：用独立窗口打开 sites/<域名>/index.html。
 * - 点击路径：在系统文件管理器中打开该目录。
 */
function ProductGallery({ domains }: { domains: string[] }): ReactElement | null {
  const { token } = theme.useToken();
  const { message } = AntdApp.useApp();
  const [products, setProducts] = useState<SiteProduct[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (domains.length === 0) {
      setProducts([]);
      return;
    }
    void window.dw.siteProducts(domains).then((r) => {
      if (!cancelled) setProducts(r.items);
    });
    return () => {
      cancelled = true;
    };
  }, [domains.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!products || products.length === 0) return null;

  const onReveal = async (domain: string): Promise<void> => {
    const r = await window.dw.siteReveal(domain);
    if (!r.ok) message.warning(r.error);
  };
  const onPreviewSite = async (domain: string): Promise<void> => {
    const r = await window.dw.previewOpenSite(domain);
    if (!r.ok) message.warning(r.error);
  };

  return (
    <div style={{ margin: "10px 0 14px" }}>
      <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>
        生成产物（{products.length}）
      </Text>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))",
          gap: 10,
          marginTop: 8,
        }}
      >
        {products.map((p) => (
          <div
            key={p.domain}
            style={{
              border: `1px solid ${token.colorBorderSecondary}`,
              borderRadius: 12,
              overflow: "hidden",
              background: token.colorBgContainer,
            }}
          >
            <div
              style={{
                height: 96,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: token.colorFillQuaternary,
                borderBottom: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              {p.logoDataUrl ? (
                <Image
                  src={p.logoDataUrl}
                  alt={p.domain}
                  height={72}
                  style={{ maxWidth: 150, objectFit: "contain" }}
                  preview={{ mask: <EyeOutlined /> }}
                />
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {p.exists ? "无 Logo" : "目录不存在"}
                </Text>
              )}
            </div>
            <div style={{ padding: "8px 10px" }}>
              <Text strong ellipsis style={{ fontSize: 13, display: "block" }}>
                {p.domain}
              </Text>
              <Tooltip title={`点击在文件管理器中打开\n${p.dir}`}>
                <Text
                  onClick={() => void onReveal(p.domain)}
                  ellipsis
                  style={{
                    fontSize: 11,
                    color: token.colorLink,
                    cursor: "pointer",
                    display: "block",
                    marginTop: 2,
                  }}
                >
                  <FolderOpenOutlined /> {p.dir}
                </Text>
              </Tooltip>
              {p.hasIndex ? (
                <Button
                  size="small"
                  type="link"
                  icon={<EyeOutlined />}
                  onClick={() => void onPreviewSite(p.domain)}
                  style={{ padding: 0, marginTop: 4, height: "auto", fontSize: 12 }}
                >
                  预览整站
                </Button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 飞书审批只读详情。 */
function ApprovalSessionView({
  approval,
  onBack,
}: {
  approval: ApprovalTrackerItem;
  onBack: () => void;
}): ReactElement {
  const { token } = theme.useToken();
  const meta = APPROVAL_STATUS_META[approval.status];
  const formRows = Object.entries(approval.form ?? {});

  const renderValue = (v: unknown): string => {
    if (Array.isArray(v)) {
      return v
        .map((cell) =>
          cell && typeof cell === "object" ? JSON.stringify(cell) : String(cell),
        )
        .join(", ");
    }
    if (v && typeof v === "object") return JSON.stringify(v);
    return String(v ?? "");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: 480 }}>
      <div
        style={{
          padding: "10px 14px",
          background: token.colorFillAlter,
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <Space size={8} style={{ minWidth: 0 }}>
          <Tag color={meta.color} icon={<AuditOutlined />}>
            {meta.label}
          </Tag>
          <Text strong style={{ fontSize: 13 }}>
            {APPROVAL_KIND_LABEL[approval.kind]} · {approval.domain || "(无域名)"}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {formatTime(approval.submittedAt)}
          </Text>
        </Space>
        <Button size="small" onClick={onBack}>
          返回当前对话
        </Button>
      </div>

      <div style={{ padding: "10px 16px", borderBottom: `1px solid ${token.colorBorderSecondary}` }}>
        <Space size={10} wrap>
          <Text type="secondary" copyable={{ text: approval.instanceCode }} style={{ fontSize: 11 }}>
            instanceCode: {ellipsisMid(approval.instanceCode, 14)}
          </Text>
          {approval.serialNumber ? (
            <Text type="secondary" copyable={{ text: approval.serialNumber }} style={{ fontSize: 11 }}>
              单号: {approval.serialNumber}
            </Text>
          ) : null}
          <Text type="secondary" style={{ fontSize: 11 }}>
            发起人: {ellipsisMid(approval.applicantId, 10)}
          </Text>
        </Space>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
        <ProductGallery domains={approval.domain ? [approval.domain] : []} />
        <Text type="secondary" style={{ fontSize: 12, fontWeight: 600 }}>
          审批表单
        </Text>
        <div style={{ marginTop: 8 }}>
          {formRows.length === 0 ? (
            <Text type="secondary" style={{ fontSize: 12 }}>
              (无表单字段)
            </Text>
          ) : (
            formRows.map(([k, v]) => (
              <div
                key={k}
                style={{
                  display: "flex",
                  gap: 10,
                  padding: "6px 0",
                  borderBottom: `1px solid ${token.colorBorderSecondary}`,
                  fontSize: 12.5,
                }}
              >
                <span style={{ minWidth: 96, color: token.colorTextSecondary }}>{k}</span>
                <span style={{ flex: 1, wordBreak: "break-word" }}>{renderValue(v)}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function groupByDay(entries: HistoryEntry[]): Array<{ label: string; items: HistoryEntry[] }> {
  const today = startOfDay(Date.now());
  const yesterday = today - 86400_000;
  const week = today - 6 * 86400_000;
  const buckets: Record<string, HistoryEntry[]> = {
    今天: [],
    昨天: [],
    "最近 7 天": [],
    更早: [],
  };
  for (const e of entries) {
    const d = startOfDay(e.ts);
    if (d === today) buckets["今天"].push(e);
    else if (d === yesterday) buckets["昨天"].push(e);
    else if (d >= week) buckets["最近 7 天"].push(e);
    else buckets["更早"].push(e);
  }
  return Object.entries(buckets)
    .filter(([, v]) => v.length > 0)
    .map(([label, v]) => ({ label, items: v }));
}

function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => n.toString().padStart(2, "0");
  const today = startOfDay(Date.now());
  const that = startOfDay(ts);
  if (today === that) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function ellipsisMid(s: string, head = 10): string {
  if (s.length <= head + 4) return s;
  return `${s.slice(0, head)}…${s.slice(-4)}`;
}
