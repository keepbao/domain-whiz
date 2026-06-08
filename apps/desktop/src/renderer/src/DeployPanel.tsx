import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import {
  CheckCircleFilled,
  CloseOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  FieldTimeOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  KeyOutlined,
  LaptopOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import type {
  DeployLogMeta,
  DeployServerConfig,
  DeployServerStatus,
  ServerUpsertInput,
} from "./global";
import { useUiStore } from "./store";

const { Text } = Typography;

/**
 * 远端站点路径与 nginx 配置目录在 main 进程的 deployConstants.ts 中写死；
 * 这里仅用于在 UI 上展示，与之保持同步。
 */
const FIXED_WEB_ROOT = "/var/www";
const FIXED_NGINX_SITES_DIR = "/etc/nginx/sites-enabled";

/* ============================================================ */
/*  通用小组件 / 工具                                              */
/* ============================================================ */

interface ServerFormValues {
  host: string;
  port?: number;
  username?: string;
  privateKeyPath?: string;
  privateKeyPem?: string;
  privateKeyPassphrase?: string;
}

/**
 * 多行版「密码框」：默认用 -webkit-text-security: disc 遮蔽内容（仍可编辑、选中、粘贴），
 * 右上角一个 eye 按钮用于显隐切换。和 antd Input.Password 行为一致，但支持多行 PEM。
 */
function SecretTextArea({
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  value?: string;
  onChange?: (v: string) => void;
  placeholder?: string;
  rows?: number;
}): ReactElement {
  const [revealed, setRevealed] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <Input.TextArea
        rows={rows}
        value={value ?? ""}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        style={{
          fontFamily: revealed ? "monospace" : "inherit",
          // 仅在未显隐时遮蔽；webkit 系（Electron / Chrome）支持，Firefox 不支持但 Electron 是 Chromium
          WebkitTextSecurity: revealed ? "none" : "disc",
        } as unknown as CSSProperties}
      />
      <Button
        type="text"
        size="small"
        icon={revealed ? <EyeOutlined /> : <EyeInvisibleOutlined />}
        onClick={() => setRevealed((v) => !v)}
        style={{ position: "absolute", top: 4, right: 4 }}
        title={revealed ? "隐藏" : "显示"}
      />
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** 完整时间戳 `YYYY-MM-DD HH:mm:ss`，与图中表格风格一致。 */
function formatFullTime(ms: number): string {
  const d = new Date(ms);
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
  );
}

/** 文件夹路径胶囊（图中 `/var/www`、`/etc/nginx/sites-enabled` 的小 chip）。 */
function PathChip({ path }: { path: string }): ReactElement {
  const { token } = theme.useToken();
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "4px 10px",
        borderRadius: 8,
        background: token.colorFillAlter,
        border: `1px solid ${token.colorBorderSecondary}`,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12,
        color: token.colorTextSecondary,
      }}
    >
      <FolderOpenOutlined style={{ color: token.colorPrimary }} />
      {path}
    </span>
  );
}

/** 单色状态点（替代 antd Tag），更接近图中"● 就绪 / ● 未就绪"。 */
function StatusDot({
  color,
  label,
  pulse = false,
}: {
  color: string;
  label: string;
  pulse?: boolean;
}): ReactElement {
  const { token } = theme.useToken();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow: pulse ? `0 0 0 3px ${color}22` : "none",
          flexShrink: 0,
        }}
      />
      <Text style={{ fontSize: 13, color: token.colorText }}>{label}</Text>
    </span>
  );
}

/* ============================================================ */
/*  ServerForm （编辑/新增 Modal —— 与原版本一致）                  */
/* ============================================================ */

function ServerForm({
  open,
  initial,
  isEdit,
  onClose,
  onSaved,
}: {
  open: boolean;
  initial: ServerFormValues | null;
  isEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}): ReactElement {
  const { message } = AntdApp.useApp();
  const setConfig = useUiStore((s) => s.setConfig);
  const [form] = Form.useForm<ServerFormValues>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      form.resetFields();
      if (initial) form.setFieldsValue(initial);
    }
  }, [form, initial, open]);

  const onPickKey = useCallback(async () => {
    const host = form.getFieldValue("host");
    if (!host?.trim()) {
      message.warning("请先填写 host");
      return;
    }
    const cfg = await window.dw.serversImportKey(host.trim());
    setConfig(cfg);
    const next = cfg.deployServers?.find((s) => s.host === host.trim());
    if (next) {
      form.setFieldsValue({
        privateKeyPath: next.privateKeyPath ?? "",
        privateKeyPem: next.privateKeyPem ?? "",
      });
      message.success("私钥已导入");
    }
  }, [form, message, setConfig]);

  const onOk = useCallback(async () => {
    try {
      const v = await form.validateFields();
      setBusy(true);
      const payload: ServerUpsertInput = {
        originalHost: isEdit ? initial?.host : undefined,
        server: {
          host: v.host.trim(),
          port: v.port ?? 22,
          username: v.username?.trim() ?? "",
          privateKeyPath: v.privateKeyPath?.trim() ?? "",
          privateKeyPem: v.privateKeyPem ?? "",
          privateKeyPassphrase: v.privateKeyPassphrase ?? "",
        } as DeployServerConfig,
      };
      const cfg = await window.dw.serversUpsert(payload);
      setConfig(cfg);
      message.success("已保存");
      onSaved();
      onClose();
    } catch (e) {
      if (e && typeof e === "object" && "errorFields" in e) return;
      message.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [form, initial, isEdit, message, onClose, onSaved, setConfig]);

  return (
    <Modal
      open={open}
      title={isEdit ? `编辑服务器 ${initial?.host}` : "新增服务器"}
      onCancel={onClose}
      onOk={() => void onOk()}
      confirmLoading={busy}
      destroyOnHidden
      okText="保存"
      cancelText="取消"
      width={600}
    >
      <Form form={form} layout="vertical">
        <Form.Item
          name="host"
          label="服务器 IP / Host"
          rules={[{ required: true, message: "请输入 IP 或域名" }]}
        >
          <Input placeholder="例如 10.101.1.1" disabled={isEdit} />
        </Form.Item>
        <Space style={{ display: "flex" }} size="middle">
          <Form.Item name="port" label="端口" style={{ flex: 1 }}>
            <Input type="number" placeholder="22" />
          </Form.Item>
          <Form.Item name="username" label="用户名" style={{ flex: 2 }}>
            <Input placeholder="例如 root" />
          </Form.Item>
        </Space>
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="远端路径已写死，无需配置"
          description={
            <Space direction="vertical" size={2}>
              <Text>
                站点目录： <Text code>{FIXED_WEB_ROOT}/&lt;域名&gt;</Text>
              </Text>
              <Text>
                nginx 配置：<Text code>{FIXED_NGINX_SITES_DIR}/&lt;域名&gt;</Text>
              </Text>
              <Text type="secondary">
                部署完成后远端会自动执行 nginx -t && nginx -s reload（非 root 自动 sudo）。
              </Text>
            </Space>
          }
        />
        <Form.Item name="privateKeyPath" label="私钥文件路径">
          <Input.Password
            placeholder="例如 C:\\Users\\me\\.ssh\\id_rsa（推荐：通过下方按钮导入）"
            visibilityToggle
            addonAfter={
              <Button type="link" size="small" icon={<KeyOutlined />} onClick={() => void onPickKey()}>
                导入私钥
              </Button>
            }
          />
        </Form.Item>
        <Form.Item name="privateKeyPem" label="私钥 PEM（可选，与路径二选一）">
          <SecretTextArea
            rows={4}
            placeholder="-----BEGIN ... PRIVATE KEY-----（导入后自动填充）"
          />
        </Form.Item>
        <Form.Item name="privateKeyPassphrase" label="私钥口令（如有）">
          <Input.Password placeholder="加密私钥的口令" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

/* ============================================================ */
/*  LogSidePanel （右侧 inline 面板，会挤压左侧表格空间）            */
/* ============================================================ */

/** 一行带图标的元信息（图中"主机名 / 时间 / 路径 / 文件 / 大小"）。 */
function MetaRow({
  icon,
  label,
  children,
}: {
  icon: ReactElement;
  label: string;
  children: ReactElement | string;
}): ReactElement {
  const { token } = theme.useToken();
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 0",
        borderBottom: `1px dashed ${token.colorBorderSecondary}`,
      }}
    >
      <span style={{ color: token.colorTextTertiary, width: 70, display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: token.colorTextSecondary }}>{icon}</span>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {label}
        </Text>
      </span>
      <span style={{ flex: 1, fontSize: 13, color: token.colorText, minWidth: 0, overflowWrap: "anywhere" }}>
        {children}
      </span>
    </div>
  );
}

/**
 * 终端日志渲染：解析 `[connect]` / `[upload]` / `[apply]` / `done` / `error` 前缀，
 * 给不同 phase 加色（青 / 紫 / 黄 / 绿 / 红），其它行原样灰色。
 */
function TerminalLog({ text }: { text: string }): ReactElement {
  const lines = useMemo(() => text.split(/\r?\n/), [text]);
  const colorOf = (line: string): string => {
    if (/\b\[connect\]/.test(line)) return "#67E8F9"; // cyan-300
    if (/\b\[upload\]/.test(line)) return "#C4B5FD"; // violet-300
    if (/\b\[apply\]/.test(line)) return "#FCD34D"; // amber-300
    if (/^\s*(✓|done\b|完成)/.test(line)) return "#34D399"; // emerald-400
    if (/\b(error|FAIL|失败)\b/i.test(line)) return "#FCA5A5"; // red-300
    return "#94A3B8"; // slate-400
  };
  return (
    <pre
      style={{
        margin: 0,
        padding: 14,
        background: "#0F172A",
        borderRadius: 12,
        border: "1px solid #1E293B",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 12,
        lineHeight: 1.6,
        maxHeight: 420,
        overflow: "auto",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {lines.map((ln, i) => (
        <div key={i} style={{ color: colorOf(ln) }}>
          {ln || "\u00A0"}
        </div>
      ))}
    </pre>
  );
}

function LogSidePanel({
  log,
  onClose,
}: {
  log: DeployLogMeta;
  onClose: () => void;
}): ReactElement {
  const { token } = theme.useToken();
  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void window.dw
      .deployReadLog(log.name)
      .then((r) => {
        if (cancelled) return;
        setContent(r.ok ? r.content : `读取失败: ${r.error}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [log.name]);

  /** 从日志文本里抽 "done bytes=X ms=Y" 推断成败；找不到 done 行就标"未知"。 */
  const summary = useMemo(() => {
    if (/\berror\b/i.test(content) && !/\bdone\b/.test(content)) {
      return { ok: false, label: "部署失败", color: "#EF4444" };
    }
    if (/\bdone\b/.test(content)) {
      return { ok: true, label: "部署成功", color: "#10B981" };
    }
    return { ok: null, label: "处理中 / 未完成", color: "#F59E0B" };
  }, [content]);

  /** 从日志文本里 count 一下 [upload] 行数 ≈ 上传文件数（剔除 nginx config 一行）。 */
  const fileCount = useMemo(() => {
    if (!content) return null;
    const n = (content.match(/\[upload\]/g) ?? []).length;
    if (n === 0) return null;
    // 减去 nginx config 那一行（含 "nginx config →"）
    const hasNginx = /nginx config\s*→/.test(content);
    return hasNginx ? n - 1 : n;
  }, [content]);

  return (
    <Card
      style={{
        borderRadius: 16,
        boxShadow: "0 4px 24px rgba(15, 23, 42, 0.06)",
        border: `1px solid ${token.colorBorderSecondary}`,
        height: "fit-content",
        position: "sticky",
        top: 70,
      }}
      styles={{ body: { padding: 0 } }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "14px 16px",
          borderBottom: `1px solid ${token.colorBorderSecondary}`,
        }}
      >
        <Text strong style={{ fontSize: 15 }}>
          部署详情
        </Text>
        <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} />
      </div>

      {/* Body */}
      <div style={{ padding: 16 }}>
        <Space size={8} style={{ marginBottom: 12 }}>
          <Tag color="success" style={{ fontSize: 13, padding: "2px 10px", borderRadius: 8 }}>
            {log.domain}
          </Tag>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: summary.color, fontSize: 13 }}>
            <CheckCircleFilled />
            {summary.label}
          </span>
        </Space>

        <MetaRow icon={<LaptopOutlined />} label="主机名">
          <span style={{ fontFamily: "ui-monospace, monospace" }}>{log.host}</span>
        </MetaRow>
        <MetaRow icon={<FieldTimeOutlined />} label="时间">
          {formatFullTime(log.mtime)}
        </MetaRow>
        <MetaRow icon={<FolderOpenOutlined />} label="路径">
          <span style={{ fontFamily: "ui-monospace, monospace" }}>{`${FIXED_WEB_ROOT}/${log.domain}`}</span>
        </MetaRow>
        <MetaRow icon={<PaperClipOutlined />} label="文件">
          {fileCount !== null ? `${fileCount} 个文件` : "—"}
        </MetaRow>
        <MetaRow icon={<DatabaseOutlined />} label="大小">
          {formatBytes(log.sizeBytes)}
        </MetaRow>

        <div style={{ marginTop: 14, marginBottom: 8 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            日志
          </Text>
        </div>
        {loading ? (
          <div style={{ textAlign: "center", padding: 30 }}>
            <Spin />
          </div>
        ) : (
          <TerminalLog text={content || "（空）"} />
        )}
      </div>
    </Card>
  );
}

/* ============================================================ */
/*  DeployPanel （主组件 —— 服务器卡 + 日志卡 + 可挤压的右侧面板）   */
/* ============================================================ */

export function DeployPanel(): ReactElement {
  const { message } = AntdApp.useApp();
  const { token } = theme.useToken();
  const config = useUiStore((s) => s.config);
  const setConfig = useUiStore((s) => s.setConfig);

  const [servers, setServers] = useState<DeployServerStatus[]>([]);
  const [logs, setLogs] = useState<DeployLogMeta[]>([]);
  const [editing, setEditing] = useState<ServerFormValues | null>(null);
  const [editIsEdit, setEditIsEdit] = useState(false);
  const [editOpen, setEditOpen] = useState(false);

  /** 当前在右侧面板展示的日志；为 null 时左侧表格占满宽度。 */
  const [activeLog, setActiveLog] = useState<DeployLogMeta | null>(null);

  /** 表格内点击的展开行（独立于右侧面板）。 */
  const [expandedRowKeys, setExpandedRowKeys] = useState<readonly string[]>([]);

  /** 用于在服务器表格快速触发"导入私钥"按钮（与编辑 Modal 共用 IPC）。 */
  const importingRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const [s, l] = await Promise.all([
      window.dw.deployListServerStatus(),
      window.dw.deployListLogs(),
    ]);
    setServers(s.servers);
    setLogs(l.logs);
    // 如果当前展开的日志在新列表中不存在（例如被清理），收起面板
    if (activeLog && !l.logs.some((x) => x.name === activeLog.name)) {
      setActiveLog(null);
    }
  }, [activeLog]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onEdit = useCallback(
    (s: DeployServerStatus) => {
      const row = config?.deployServers?.find((x) => x.host === s.host);
      setEditing({
        host: s.host,
        port: row?.port ?? s.port ?? 22,
        username: row?.username ?? s.username ?? "",
        privateKeyPath: row?.privateKeyPath ?? "",
        privateKeyPem: row?.privateKeyPem ?? "",
        privateKeyPassphrase: row?.privateKeyPassphrase ?? "",
      });
      setEditIsEdit(true);
      setEditOpen(true);
    },
    [config],
  );

  const onAdd = useCallback(() => {
    setEditing({ host: "", port: 22 });
    setEditIsEdit(false);
    setEditOpen(true);
  }, []);

  const onDelete = useCallback(
    async (host: string) => {
      const cfg = await window.dw.serversDelete(host);
      setConfig(cfg);
      await refresh();
      message.success("已删除");
    },
    [message, refresh, setConfig],
  );

  /** 行内"导入私钥"按钮：直接调 IPC 拉系统文件对话框；成功后刷新。 */
  const onQuickImportKey = useCallback(
    async (host: string) => {
      if (importingRef.current === host) return;
      importingRef.current = host;
      try {
        const cfg = await window.dw.serversImportKey(host);
        setConfig(cfg);
        await refresh();
        message.success("私钥已导入");
      } catch (e) {
        message.error(e instanceof Error ? e.message : String(e));
      } finally {
        importingRef.current = null;
      }
    },
    [message, refresh, setConfig],
  );

  const builtinHosts = useMemo(() => new Set(["10.101.1.1", "47.0.0.1"]), []);

  /* ---- 表格列定义 ---- */

  const serverColumns = useMemo(
    () => [
      {
        title: "IP",
        dataIndex: "host",
        key: "host",
        render: (host: string) => (
          <span style={{ fontFamily: "ui-monospace, monospace" }}>{host}</span>
        ),
      },
      { title: "端口", dataIndex: "port", key: "port", width: 90 },
      {
        title: "用户名",
        dataIndex: "username",
        key: "username",
        width: 130,
        render: (v: string) => v || <Text type="secondary">—</Text>,
      },
      {
        title: "私钥",
        key: "pk",
        width: 160,
        render: (_: unknown, s: DeployServerStatus) => {
          const row = config?.deployServers?.find((x) => x.host === s.host);
          const hasKey = !!(row?.privateKeyPem?.trim() || row?.privateKeyPath?.trim());
          return hasKey ? (
            <Tag color="success" style={{ borderRadius: 6, margin: 0 }}>
              PEM 已导入
            </Tag>
          ) : (
            <Tag color="error" style={{ borderRadius: 6, margin: 0 }}>
              ⚠ 缺少私钥
            </Tag>
          );
        },
      },
      {
        title: "状态",
        key: "status",
        width: 110,
        render: (_: unknown, s: DeployServerStatus) =>
          s.ready ? (
            <StatusDot color="#10B981" label="就绪" pulse />
          ) : s.configured ? (
            <StatusDot color="#F59E0B" label="不完整" />
          ) : (
            <StatusDot color="#94A3B8" label="未就绪" />
          ),
      },
      {
        title: "操作",
        key: "ops",
        width: 220,
        render: (_: unknown, s: DeployServerStatus) => (
          <Space size={4}>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => onEdit(s)}
            >
              编辑
            </Button>
            <Button
              type="link"
              size="small"
              icon={<KeyOutlined />}
              onClick={() => void onQuickImportKey(s.host)}
            >
              导入私钥
            </Button>
            <Popconfirm
              title={builtinHosts.has(s.host) ? "重置该内置 IP 的配置？" : "删除该服务器？"}
              onConfirm={() => void onDelete(s.host)}
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                {builtinHosts.has(s.host) ? "重置" : "删除"}
              </Button>
            </Popconfirm>
          </Space>
        ),
      },
    ],
    [builtinHosts, config, onDelete, onEdit, onQuickImportKey],
  );

  const logColumns = useMemo(
    () => [
      {
        title: "域名",
        dataIndex: "domain",
        key: "domain",
        render: (v: string) => (
          <Tag color="success" style={{ borderRadius: 6, margin: 0, fontSize: 12 }}>
            {v}
          </Tag>
        ),
      },
      {
        title: "主机名",
        dataIndex: "host",
        key: "host",
        width: 140,
        render: (v: string) => (
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12 }}>{v}</span>
        ),
      },
      {
        title: "时间",
        dataIndex: "mtime",
        key: "mtime",
        width: 170,
        render: (v: number) => (
          <Text style={{ fontSize: 12, color: token.colorTextSecondary }}>
            {formatFullTime(v)}
          </Text>
        ),
      },
      {
        title: "文件",
        key: "files",
        width: 80,
        render: () => <Text type="secondary">—</Text>,
      },
      {
        title: "大小",
        dataIndex: "sizeBytes",
        key: "sizeBytes",
        width: 100,
        render: (v: number) => (
          <Text style={{ fontSize: 12 }}>{formatBytes(v)}</Text>
        ),
      },
      {
        title: "操作",
        key: "ops",
        width: 90,
        render: (_: unknown, l: DeployLogMeta) => (
          <Button
            type="link"
            size="small"
            onClick={() => setActiveLog(l)}
            style={{ paddingLeft: 0 }}
          >
            查看
          </Button>
        ),
      },
    ],
    [token.colorTextSecondary],
  );

  /* ---- 行展开渲染（图中"部署成功 / 服务器 / 路径 / 收起"折叠区） ---- */

  const expandedRowRender = useCallback(
    (l: DeployLogMeta) => {
      const row = servers.find((s) => s.host === l.host);
      return (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 16,
            padding: "8px 4px",
            fontSize: 13,
            color: token.colorTextSecondary,
          }}
        >
          <Tooltip title="日志列表无法判断成败，需打开右侧详情解析正文。">
            <span style={{ color: "#10B981", display: "inline-flex", alignItems: "center", gap: 4 }}>
              <CheckCircleFilled /> 已完成
            </span>
          </Tooltip>
          <span>
            服务器：<Text style={{ color: token.colorText }}>{l.host}</Text>
            {row?.username ? <Text type="secondary">（{row.username}）</Text> : null}
          </span>
          <span>
            路径：
            <Text
              style={{
                color: token.colorText,
                fontFamily: "ui-monospace, monospace",
                fontSize: 12,
              }}
            >
              {`${FIXED_WEB_ROOT}/${l.domain}`}
            </Text>
          </span>
          <span style={{ marginLeft: "auto" }}>
            <Button
              type="link"
              size="small"
              onClick={() => setExpandedRowKeys((prev) => prev.filter((k) => k !== l.name))}
            >
              收起 ▲
            </Button>
          </span>
        </div>
      );
    },
    [servers, token.colorText, token.colorTextSecondary],
  );

  /* ---- 渲染 ---- */

  // 卡片公共 surface
  const cardStyle: CSSProperties = {
    borderRadius: 16,
    boxShadow: "0 4px 24px rgba(15, 23, 42, 0.06)",
    border: `1px solid ${token.colorBorderSecondary}`,
  };

  const leftContent = (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      {/* —— 服务器卡 —— */}
      <Card
        title={
          <Space size={8}>
            <DatabaseOutlined style={{ color: token.colorTextSecondary }} />
            <span>服务器</span>
          </Space>
        }
        extra={
          <Space>
            <Button
              type="text"
              icon={<ReloadOutlined />}
              onClick={() => void refresh()}
              title="刷新"
            />
            <Button type="primary" icon={<PlusOutlined />} onClick={onAdd}>
              新增服务器
            </Button>
          </Space>
        }
        style={cardStyle}
        styles={{ body: { padding: 20 } }}
      >
        <Space size={10} style={{ marginBottom: 14 }}>
          <PathChip path={FIXED_WEB_ROOT} />
          <PathChip path={FIXED_NGINX_SITES_DIR} />
        </Space>
        <Table<DeployServerStatus>
          size="middle"
          pagination={false}
          rowKey="host"
          dataSource={servers}
          columns={serverColumns}
          locale={{ emptyText: "尚未配置服务器" }}
        />
      </Card>

      {/* —— 部署日志卡 —— */}
      <Card
        title={
          <Space size={8}>
            <FileTextOutlined style={{ color: token.colorTextSecondary }} />
            <span>部署日志</span>
          </Space>
        }
        extra={
          <Button type="text" icon={<ReloadOutlined />} onClick={() => void refresh()} title="刷新" />
        }
        style={cardStyle}
        styles={{ body: { padding: 20 } }}
      >
        {logs.length === 0 ? (
          <Empty description="暂无部署记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <Table<DeployLogMeta>
            size="middle"
            rowKey="name"
            dataSource={logs}
            columns={logColumns}
            pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
            expandable={{
              expandedRowKeys: expandedRowKeys as string[],
              onExpand: (expanded, record) =>
                setExpandedRowKeys((prev) =>
                  expanded ? [...prev, record.name] : prev.filter((k) => k !== record.name),
                ),
              expandedRowRender,
              rowExpandable: () => true,
            }}
            onRow={(record) => ({
              style:
                activeLog?.name === record.name
                  ? { background: token.colorPrimaryBg }
                  : undefined,
            })}
          />
        )}
      </Card>
    </Space>
  );

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 16,
          alignItems: "flex-start",
          width: "100%",
        }}
      >
        {/* 左侧表格区：activeLog 为空时占满；有时自动 flex:1 被右侧 420px 挤压 */}
        <div style={{ flex: 1, minWidth: 0, transition: "all 0.25s ease" }}>{leftContent}</div>

        {/* 右侧 inline 详情面板 */}
        {activeLog ? (
          <div
            style={{
              flexShrink: 0,
              width: 420,
              animation: "dw-slide-in 0.2s ease",
            }}
          >
            <LogSidePanel log={activeLog} onClose={() => setActiveLog(null)} />
          </div>
        ) : null}
      </div>

      <ServerForm
        open={editOpen}
        initial={editing}
        isEdit={editIsEdit}
        onClose={() => setEditOpen(false)}
        onSaved={() => void refresh()}
      />
    </>
  );
}
