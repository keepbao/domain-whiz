/**
 * 飞书登录态：全应用唯一来源。
 *
 * - 启动时 `FeishuSessionProvider` 自动调一次 `feishuWhoAmI`，避免每个页面/卡片再各自拉一次；
 * - 未登录时上层渲染 `LoginScreen`，整个应用不可用；
 * - 登录后右上角 `UserAvatarMenu` 显示飞书头像 / 姓名 + 我的审批列表（消费 ApprovalsProvider），
 *   并提供退出登录入口。
 *
 * 设计上故意把"会话"与"登录页"放在同一个文件里——它们的职责高度耦合，
 * 拆开反而要在多处共享类型 / hook，不利维护。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  Divider,
  Dropdown,
  Empty,
  Spin,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import {
  CheckCircleFilled,
  CloseCircleFilled,
  GlobalOutlined,
  LoadingOutlined,
  LoginOutlined,
  LogoutOutlined,
  ReloadOutlined,
  SwapOutlined,
  UserOutlined,
} from "@ant-design/icons";
import type { ApprovalStatus, ApprovalTrackerItem, FeishuSession } from "./global";
import { useApprovals } from "./approvalsContext.js";
import appIcon from "./assets/icon.png";

const { Text, Title, Paragraph } = Typography;

interface FeishuSessionContextValue {
  session: FeishuSession | null;
  loading: boolean;
  busy: boolean;
  error: string | undefined;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const FeishuSessionContext = createContext<FeishuSessionContextValue | null>(null);

export function FeishuSessionProvider({ children }: { children: ReactNode }): ReactElement {
  const [session, setSession] = useState<FeishuSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const r = await window.dw.feishuWhoAmI();
      setSession(r.session);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async () => {
    setError(undefined);
    setBusy(true);
    try {
      const r = await window.dw.feishuLogin();
      if (r.ok) setSession(r.session);
      else setError(r.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await window.dw.feishuLogout();
    setSession(null);
  }, []);

  const value = useMemo<FeishuSessionContextValue>(
    () => ({ session, loading, busy, error, login, logout, refresh }),
    [session, loading, busy, error, login, logout, refresh],
  );

  return (
    <FeishuSessionContext.Provider value={value}>{children}</FeishuSessionContext.Provider>
  );
}

export function useFeishuSession(): FeishuSessionContextValue {
  const v = useContext(FeishuSessionContext);
  if (!v) throw new Error("useFeishuSession 必须在 <FeishuSessionProvider> 内调用");
  return v;
}

/** 已确保已登录的便捷 hook：在 LoginGate 之后使用，保证 session 非空。 */
export function useRequiredFeishuSession(): FeishuSession {
  const { session } = useFeishuSession();
  if (!session) {
    throw new Error("内部错误：useRequiredFeishuSession 在未登录状态下被调用");
  }
  return session;
}

/**
 * 登录门。
 *
 * - 启动加载中 → 全屏 spinner；
 * - 未登录 → 全屏 LoginScreen；
 * - 已登录 → 渲染 children（正常 App 内容）。
 */
export function FeishuLoginGate({ children }: { children: ReactNode }): ReactElement {
  const { session, loading, busy, error, login } = useFeishuSession();
  const { token } = theme.useToken();

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: token.colorBgLayout,
        }}
      >
        <Spin size="large" tip="正在读取登录态…" />
      </div>
    );
  }

  if (!session) {
    return <LoginScreen busy={busy} error={error} onLogin={() => void login()} />;
  }

  return <>{children}</>;
}

interface LoginScreenProps {
  busy: boolean;
  error?: string;
  onLogin: () => void;
}

function LoginScreen({ busy, error, onLogin }: LoginScreenProps): ReactElement {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        minHeight: "100vh",
        background: `radial-gradient(circle at 20% 10%, #eef0ff 0%, transparent 50%),
                     radial-gradient(circle at 80% 90%, #d9f6f7 0%, transparent 50%),
                     ${token.colorBgLayout}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <Card
        style={{
          width: "100%",
          maxWidth: 420,
          borderRadius: 20,
          boxShadow: "0 20px 50px rgba(91, 108, 255, 0.18)",
          border: "none",
        }}
        styles={{ body: { padding: 36, textAlign: "center" } }}
      >
        <img
          src={appIcon}
          alt="域名小能手"
          draggable={false}
          style={{
            width: 72,
            height: 72,
            borderRadius: 20,
            objectFit: "cover",
            display: "block",
            margin: "0 auto 16px",
            boxShadow: "0 6px 16px rgba(91, 108, 255, 0.25)",
          }}
        />
        <Title level={3} style={{ marginBottom: 2 }}>
          域名小能手
        </Title>
        <Text
          type="secondary"
          style={{ fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase" }}
        >
          Domain Whiz
        </Text>
        <Paragraph type="secondary" style={{ marginTop: 14, marginBottom: 24 }}>
          使用飞书账号登录后即可使用建站、部署与审批功能。
        </Paragraph>

        <Button
          type="primary"
          size="large"
          icon={<LoginOutlined />}
          loading={busy}
          onClick={onLogin}
          block
        >
          {busy ? "等待飞书授权回调…" : "登录飞书"}
        </Button>

        {error ? (
          <Paragraph
            style={{
              marginTop: 16,
              marginBottom: 0,
              padding: "10px 12px",
              borderRadius: 10,
              background: token.colorErrorBg,
              border: `1px solid ${token.colorErrorBorder}`,
              color: token.colorError,
              textAlign: "left",
              fontSize: 12,
              lineHeight: 1.6,
            }}
          >
            {error}
          </Paragraph>
        ) : (
          <Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0, fontSize: 12 }}>
            点击后将打开系统浏览器跳转飞书完成授权；授权成功后自动返回应用。
          </Paragraph>
        )}
      </Card>
    </div>
  );
}

/* ---------- 审批状态 chip ---------- */

const APPROVAL_STATUS_META: Record<
  ApprovalStatus,
  { label: string; color: string; icon: ReactElement | null }
> = {
  PENDING: { label: "审批中", color: "processing", icon: <LoadingOutlined /> },
  APPROVED: { label: "已通过", color: "success", icon: <CheckCircleFilled /> },
  REJECTED: { label: "已拒绝", color: "error", icon: <CloseCircleFilled /> },
  RECALLED: { label: "已撤回", color: "default", icon: null },
  CANCELED: { label: "已取消", color: "default", icon: null },
  DELETED: { label: "已删除", color: "default", icon: null },
};

const TERMINAL_APPROVAL_STATUSES: ApprovalStatus[] = [
  "APPROVED",
  "REJECTED",
  "RECALLED",
  "CANCELED",
  "DELETED",
];

function isApprovalPending(it: ApprovalTrackerItem): boolean {
  return !TERMINAL_APPROVAL_STATUSES.includes(it.status);
}

function formatApprovalTime(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d
    .getMinutes()
    .toString()
    .padStart(2, "0")}`;
}

function ApprovalRow({
  item,
  onRefresh,
}: {
  item: ApprovalTrackerItem;
  onRefresh: (instanceCode: string) => void;
}): ReactElement {
  const { token } = theme.useToken();
  const meta = APPROVAL_STATUS_META[item.status];
  const kindLabel = item.kind === "domain-purchase" ? "购买" : "解析";
  const kindIcon = item.kind === "domain-purchase" ? <GlobalOutlined /> : <SwapOutlined />;
  const timestamp = item.lastChangedAt ?? item.submittedAt;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 10px",
        borderRadius: 10,
        background: token.colorFillTertiary,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: 8,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: token.colorPrimary,
          background: token.colorPrimaryBg,
          flexShrink: 0,
        }}
      >
        {kindIcon}
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 13,
            fontWeight: 500,
            color: token.colorText,
          }}
        >
          <Tooltip title={item.domain}>
            <span
              style={{
                maxWidth: 150,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {item.domain || "(未指定域名)"}
            </span>
          </Tooltip>
          <Text type="secondary" style={{ fontSize: 11 }}>
            · {kindLabel}
          </Text>
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 2,
            color: token.colorTextSecondary,
            fontSize: 11,
          }}
        >
          <span>{formatApprovalTime(timestamp)}</span>
          <Tooltip title={item.instanceCode}>
            <span
              style={{
                maxWidth: 120,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: "ui-monospace, Menlo, Consolas, monospace",
              }}
            >
              · {item.instanceCode.slice(-12)}
            </span>
          </Tooltip>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
        <Tag color={meta.color} icon={meta.icon ?? undefined} style={{ margin: 0 }}>
          {meta.label}
        </Tag>
        {isApprovalPending(item) ? (
          <Tooltip title="立即查询最新状态">
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={(e) => {
                e.stopPropagation();
                onRefresh(item.instanceCode);
              }}
            />
          </Tooltip>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- 头像下拉面板 ---------- */

function UserMenuPanel({
  session,
  approvals,
  pendingCount,
  refreshingOne,
  onLogout,
  onRefreshApproval,
}: {
  session: FeishuSession;
  approvals: ApprovalTrackerItem[];
  pendingCount: number;
  refreshingOne: boolean;
  onLogout: () => void;
  onRefreshApproval: (instanceCode: string) => void;
}): ReactElement {
  const { token } = theme.useToken();
  const expiredAt = new Date(session.accessTokenExpiresAt);
  const expiredStr = `${expiredAt.getMonth() + 1}/${expiredAt.getDate()} ${expiredAt
    .getHours()
    .toString()
    .padStart(2, "0")}:${expiredAt.getMinutes().toString().padStart(2, "0")}`;

  // 列表上限：避免下拉过长。完成的折叠为一条"还有 N 条已完成"。
  const MAX_VISIBLE = 8;
  const visible = approvals.slice(0, MAX_VISIBLE);
  const hiddenCount = Math.max(0, approvals.length - MAX_VISIBLE);

  return (
    <div
      style={{
        width: 360,
        background: token.colorBgElevated,
        borderRadius: 14,
        boxShadow: "0 12px 36px rgba(15, 23, 42, 0.18)",
        border: `1px solid ${token.colorBorderSecondary}`,
        overflow: "hidden",
      }}
    >
      {/* Header: 用户信息（不显示 user_id） */}
      <div style={{ padding: "14px 16px 10px" }}>
        <Text strong style={{ fontSize: 14 }}>
          {session.user.name}
        </Text>
        {session.user.email ? (
          <div
            style={{
              fontSize: 12,
              color: token.colorTextSecondary,
              marginTop: 2,
              textOverflow: "ellipsis",
              overflow: "hidden",
              whiteSpace: "nowrap",
            }}
          >
            {session.user.email}
          </div>
        ) : null}
        <div style={{ fontSize: 11, color: token.colorTextTertiary, marginTop: 4 }}>
          登录有效期至 {expiredStr}
        </div>
      </div>

      <Divider style={{ margin: 0 }} />

      {/* 审批列表 */}
      <div style={{ padding: "10px 12px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <Text type="secondary" style={{ fontSize: 12 }}>
            我的审批
            {approvals.length > 0 ? ` · ${approvals.length}` : ""}
          </Text>
          {pendingCount > 0 ? (
            <Tag color="processing" style={{ margin: 0 }}>
              {pendingCount} 条进行中
            </Tag>
          ) : null}
        </div>
        {approvals.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<Text type="secondary" style={{ fontSize: 12 }}>暂无审批记录</Text>}
            style={{ margin: "12px 0" }}
          />
        ) : (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 6,
              maxHeight: 360,
              overflowY: "auto",
              paddingRight: 2,
            }}
          >
            {visible.map((it) => (
              <ApprovalRow key={it.instanceCode} item={it} onRefresh={onRefreshApproval} />
            ))}
            {hiddenCount > 0 ? (
              <Text
                type="secondary"
                style={{ fontSize: 11, textAlign: "center", padding: "4px 0" }}
              >
                还有 {hiddenCount} 条已完成审批未显示
              </Text>
            ) : null}
          </div>
        )}
        {refreshingOne ? (
          <div style={{ textAlign: "center", marginTop: 6 }}>
            <Spin size="small" />
          </div>
        ) : null}
      </div>

      <Divider style={{ margin: 0 }} />

      {/* 退出 */}
      <div style={{ padding: 10 }}>
        <Button danger type="text" block icon={<LogoutOutlined />} onClick={onLogout}>
          退出登录
        </Button>
      </div>
    </div>
  );
}

/**
 * 右上角用户头像 + 下拉菜单。
 *
 * - 头像旁有未读 badge（进行中的审批条数）；
 * - 下拉面板含：用户头部（不显 user_id）/ 我的审批（实时随主进程轮询更新）/ 退出登录；
 * - 已经移除"刷新登录态"按钮；登录过期后 LoginGate 会自动接管整页强制重登。
 */
export function UserAvatarMenu(): ReactElement | null {
  const { session, logout } = useFeishuSession();
  const { items, refreshOne } = useApprovals();
  const { token } = theme.useToken();
  const [refreshingOne, setRefreshingOne] = useState(false);

  const onRefreshApproval = useCallback(
    async (instanceCode: string) => {
      if (refreshingOne) return;
      setRefreshingOne(true);
      try {
        await refreshOne(instanceCode);
      } finally {
        setRefreshingOne(false);
      }
    },
    [refreshOne, refreshingOne],
  );

  if (!session) return null;

  const initials = (session.user.name || "U").trim().slice(0, 1).toUpperCase();
  const pendingCount = items.filter(isApprovalPending).length;

  return (
    <Dropdown
      placement="bottomRight"
      trigger={["click"]}
      dropdownRender={() => (
        <UserMenuPanel
          session={session}
          approvals={items}
          pendingCount={pendingCount}
          refreshingOne={refreshingOne}
          onLogout={() => void logout()}
          onRefreshApproval={(ic) => void onRefreshApproval(ic)}
        />
      )}
    >
      <button
        type="button"
        title={session.user.name}
        aria-label={`\u5F53\u524D\u767B\u5F55\uFF1A${session.user.name}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          border: "none",
          cursor: "pointer",
          background: "transparent",
          borderRadius: "50%",
          lineHeight: 0,
        }}
      >
        <Badge count={pendingCount} size="small" offset={[-2, 2]} color="#EF4444">
          <Avatar
            size={36}
            src={session.user.avatarUrl}
            icon={!session.user.avatarUrl ? <UserOutlined /> : undefined}
            style={{
              background: session.user.avatarUrl ? "transparent" : token.colorPrimary,
              boxShadow: "0 4px 12px rgba(15, 23, 42, 0.18)",
              border: "2px solid #fff",
            }}
          >
            {!session.user.avatarUrl ? initials : null}
          </Avatar>
        </Badge>
      </button>
    </Dropdown>
  );
}
