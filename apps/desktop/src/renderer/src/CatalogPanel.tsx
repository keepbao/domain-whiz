import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  App as AntdApp,
  Button,
  ConfigProvider,
  Empty,
  Input,
  Modal,
  Progress,
  Segmented,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import {
  CheckCircleFilled,
  CloseCircleFilled,
  CloudUploadOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  ExclamationCircleFilled,
  EyeOutlined,
  LoadingOutlined,
  ReloadOutlined,
  SearchOutlined,
  SendOutlined,
} from "@ant-design/icons";
import type {
  CatalogItem,
  CatalogList,
  ChatChunk,
  DeployEvent,
  DeployServerStatus,
} from "./global";
import { ChatBubble, newChatMessageId, type ChatMessage } from "./chatCommon.js";

const { Text, Paragraph } = Typography;

/* ---------- LogoCard ---------- */

function LogoCard({
  item,
  selected,
  onToggleSelect,
  onPreview,
  onQuickDeploy,
  onEdit,
  onDelete,
}: {
  item: CatalogItem;
  selected: boolean;
  onToggleSelect: () => void;
  onPreview: () => void;
  onQuickDeploy?: () => void;
  onEdit?: () => void;
  /** 仅生成的 site 提供；模板（templates/）属只读资产，不允许从 UI 删除。 */
  onDelete?: () => void;
}): ReactElement {
  const { token } = theme.useToken();
  const [hover, setHover] = useState(false);
  const firstChar = (item.name.match(/[A-Za-z0-9]/)?.[0] ?? item.name.charAt(0)).toUpperCase();
  const isSite = item.kind === "site";

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: token.colorBgContainer,
        border: `1.5px solid ${selected ? token.colorPrimary : "transparent"}`,
        borderRadius: 14,
        boxShadow: selected
          ? `0 0 0 2px ${token.colorPrimary}22, 0 3px 12px rgba(15,23,42,0.08)`
          : hover
            ? "0 8px 20px rgba(15, 23, 42, 0.10)"
            : "0 1px 4px rgba(15, 23, 42, 0.05)",
        transition: "all .18s ease",
        transform: hover ? "translateY(-2px)" : "translateY(0)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* —— 顶部封面区：logo 占满整块（点击切换选中） —— */}
      <div
        onClick={onToggleSelect}
        style={{
          position: "relative",
          width: "100%",
          aspectRatio: "1 / 1",
          background: token.colorBgContainer,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          userSelect: "none",
          overflow: "hidden",
        }}
      >
        {item.logoDataUrl ? (
          <img
            src={item.logoDataUrl}
            alt={item.name}
            draggable={false}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              display: "block",
            }}
          />
        ) : (
          // 无 logo 时仍兜底显示首字母，避免封面留空
          <span
            style={{
              fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto",
              fontSize: 86,
              fontWeight: 800,
              color: token.colorTextQuaternary,
              letterSpacing: -2,
              lineHeight: 1,
            }}
          >
            {firstChar}
          </span>
        )}

        {/* 选中态：左上角 ✓ checkbox（无渐变背景，所以未选时用浅灰描边、hover/选中再变深） */}
        <div
          style={{
            position: "absolute",
            top: 10,
            left: 10,
            width: 22,
            height: 22,
            borderRadius: 6,
            background: selected ? token.colorPrimary : "rgba(255, 255, 255, 0.92)",
            border: selected ? "none" : `1.5px solid ${token.colorBorder}`,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: selected || hover ? 1 : 0,
            transition: "opacity .15s ease, background .15s ease",
            boxShadow: "0 2px 6px rgba(15, 23, 42, 0.12)",
            pointerEvents: "none",
          }}
        >
          {selected ? (
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none">
              <path
                d="M5 12.5l4.5 4.5L19 7"
                stroke="#fff"
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </div>
      </div>

      {/* —— 底部信息条 —— */}
      <div
        style={{
          padding: "8px 10px 10px 10px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <Text
          strong
          style={{
            fontSize: 12.5,
            color: token.colorText,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={item.name}
        >
          {item.name}
        </Text>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 4,
          }}
        >
          <Tag
            color={isSite ? "geekblue" : "purple"}
            style={{ margin: 0, borderRadius: 5, fontSize: 10, lineHeight: "16px", padding: "0 5px" }}
          >
            {isSite ? "site" : "template"}
          </Tag>
          <Space size={0}>
            <Tooltip title="预览">
              <Button
                type="text"
                size="small"
                icon={<EyeOutlined />}
                onClick={onPreview}
                style={{ color: token.colorTextSecondary }}
              />
            </Tooltip>
            {onQuickDeploy ? (
              <Tooltip title="部署该站">
                <Button
                  type="text"
                  size="small"
                  icon={<CloudUploadOutlined />}
                  onClick={onQuickDeploy}
                  style={{ color: token.colorTextSecondary }}
                />
              </Tooltip>
            ) : null}
            {onEdit ? (
              <Tooltip title="AI 修改">
                <Button
                  type="text"
                  size="small"
                  icon={<EditOutlined />}
                  onClick={onEdit}
                  style={{ color: token.colorTextSecondary }}
                />
              </Tooltip>
            ) : null}
            {onDelete ? (
              <Tooltip title="删除该站">
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={onDelete}
                  style={{ color: token.colorTextSecondary }}
                />
              </Tooltip>
            ) : null}
          </Space>
        </div>
      </div>
    </div>
  );
}

/* ---------- EditDialog: AI 对话改站（单域名） ---------- */

function EditDialog({
  open,
  domain,
  onClose,
  onChanged,
}: {
  open: boolean;
  domain: string | null;
  onClose: () => void;
  onChanged: () => void;
}): ReactElement {
  const { message } = AntdApp.useApp();
  const { token } = theme.useToken();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const streamingMsgIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setMessages([]);
    setInput("");
    setRunning(false);
    streamingMsgIdRef.current = null;
  }, [open, domain]);

  useEffect(() => {
    if (!open) return;
    const off = window.dw.onChatChunk((chunk: ChatChunk) => {
      if (!streamingMsgIdRef.current) return;
      const text = chunk.text ?? "";
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === streamingMsgIdRef.current);
        if (idx < 0) return prev;
        const cur = prev[idx]!;
        const next: ChatMessage = (() => {
          if (chunk.type === "text") {
            return { ...cur, text: (cur.text ?? "") + text };
          }
          if (chunk.type === "info") {
            return { ...cur, text: (cur.text ?? "") + (cur.text ? "\n" : "") + `· ${text}` };
          }
          if (chunk.type === "done") {
            return { ...cur, status: "done" };
          }
          return {
            ...cur,
            status: "error",
            text: (cur.text ?? "") + (text ? `\n[error] ${text}` : ""),
          };
        })();
        const copy = [...prev];
        copy[idx] = next;
        return copy;
      });
    });
    return off;
  }, [open]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const onSend = useCallback(async () => {
    if (!domain) return;
    const m = input.trim();
    if (!m) {
      message.warning("请输入修改说明");
      return;
    }
    if (running) return;
    const userMsg: ChatMessage = {
      id: newChatMessageId(),
      role: "user",
      text: m,
      status: "done",
    };
    const assistantId = newChatMessageId();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      text: "",
      status: "streaming",
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setInput("");
    setRunning(true);
    streamingMsgIdRef.current = assistantId;
    const r = await window.dw.chatRun({ domain, message: m });
    if (!r.ok) {
      streamingMsgIdRef.current = null;
      setMessages((prev) =>
        prev.map((x) =>
          x.id === assistantId
            ? { ...x, status: "error", text: `[error] ${r.error ?? "失败"}` }
            : x,
        ),
      );
      message.error(r.error ?? "修改失败");
      setRunning(false);
      return;
    }
    setMessages((prev) =>
      prev.map((x) => (x.id === assistantId ? { ...x, status: "done" } : x)),
    );
    setRunning(false);
    streamingMsgIdRef.current = null;
    onChanged();
  }, [domain, input, message, onChanged, running]);

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={760}
      title={domain ? `修改网站 · ${domain}` : "修改"}
    >
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <Paragraph type="secondary" style={{ marginBottom: 0 }}>
          针对 <Text code>sites/{domain}/</Text> 的增量改站。请描述需要的修改，例如：
          <Text type="secondary"> Update hero headline to “…”, change primary color to #1a73e8…</Text>
        </Paragraph>
        <div
          ref={scrollRef}
          style={{
            height: 420,
            overflowY: "auto",
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 12,
            padding: 14,
            background: token.colorBgLayout,
          }}
        >
          {messages.length === 0 ? (
            <Text type="secondary" style={{ display: "block", textAlign: "center", marginTop: 120 }}>
              暂无对话。发送第一条修改说明开始增量改站。
            </Text>
          ) : (
            messages.map((m) => <ChatBubble key={m.id} msg={m} />)
          )}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Input.TextArea
            autoSize={{ minRows: 2, maxRows: 6 }}
            placeholder="Describe your changes in English…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPressEnter={(e) => {
              if (!e.shiftKey) {
                e.preventDefault();
                void onSend();
              }
            }}
            disabled={running}
            style={{ flex: 1 }}
          />
          <Button
            type="primary"
            size="large"
            icon={<SendOutlined />}
            loading={running}
            disabled={!input.trim()}
            onClick={() => void onSend()}
          >
            发送
          </Button>
        </div>
      </Space>
    </Modal>
  );
}

/* ---------- DeployModal: 支持多个域名串行部署 ---------- */

interface DomainProgress {
  status: "pending" | "running" | "done" | "error";
  percent: number;
  fileIndex: number;
  totalFiles: number;
  bytesUploaded: number;
  totalBytes: number;
  lastFile: string;
  error?: string;
}

function initDomainProgress(): DomainProgress {
  return {
    status: "pending",
    percent: 0,
    fileIndex: 0,
    totalFiles: 0,
    bytesUploaded: 0,
    totalBytes: 0,
    lastFile: "",
  };
}

function statusIcon(status: DomainProgress["status"]): ReactElement {
  if (status === "done") return <CheckCircleFilled style={{ color: "#10B981" }} />;
  if (status === "error") return <CloseCircleFilled style={{ color: "#EF4444" }} />;
  if (status === "running") return <LoadingOutlined spin />;
  return <span style={{ width: 14, display: "inline-block" }} />;
}

function DeployModal({
  open,
  domains,
  onClose,
}: {
  open: boolean;
  domains: string[];
  onClose: () => void;
}): ReactElement {
  const { message } = AntdApp.useApp();
  const { token } = theme.useToken();

  const [servers, setServers] = useState<DeployServerStatus[]>([]);
  const [host, setHost] = useState<string | undefined>();
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [currentDomain, setCurrentDomain] = useState<string | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, DomainProgress>>({});
  const [logLines, setLogLines] = useState<string[]>([]);

  const activeDeployIdRef = useRef<string | null>(null);
  const activeDomainRef = useRef<string | null>(null);
  const resolveOneRef = useRef<((r: { ok: boolean; error?: string }) => void) | null>(null);

  const refreshServers = useCallback(async () => {
    const r = await window.dw.deployListServerStatus();
    setServers(r.servers);
  }, []);

  // reset on (re)open
  useEffect(() => {
    if (!open) return;
    setStarted(false);
    setFinished(false);
    setCurrentDomain(null);
    setLogLines([]);
    const init: Record<string, DomainProgress> = {};
    for (const d of domains) init[d] = initDomainProgress();
    setProgressMap(init);
    activeDeployIdRef.current = null;
    activeDomainRef.current = null;
    resolveOneRef.current = null;
    void refreshServers();
  }, [open, domains, refreshServers]);

  // single global listener
  useEffect(() => {
    if (!open) return;
    const off = window.dw.onDeployEvent((ev: DeployEvent) => {
      const dom = activeDomainRef.current;
      const id = activeDeployIdRef.current;
      if (!dom || !id || ev.deployId !== id) return;
      setProgressMap((prev) => {
        const cur = prev[dom] ?? initDomainProgress();
        const next: DomainProgress = {
          ...cur,
          status: ev.type === "done" ? "done" : ev.type === "error" ? "error" : "running",
          percent: ev.percent ?? cur.percent,
          fileIndex: ev.fileIndex ?? cur.fileIndex,
          totalFiles: ev.totalFiles ?? cur.totalFiles,
          bytesUploaded: ev.bytesUploaded ?? cur.bytesUploaded,
          totalBytes: ev.totalBytes ?? cur.totalBytes,
          lastFile: ev.filename ?? cur.lastFile,
          error: ev.type === "error" ? ev.error : cur.error,
        };
        return { ...prev, [dom]: next };
      });
      setLogLines((prev) => {
        const line = `[${dom}] [${ev.type}] ${ev.message ?? ev.error ?? ""}`;
        const nxt = [...prev, line];
        return nxt.slice(-300);
      });
      if (ev.type === "done") {
        resolveOneRef.current?.({ ok: true });
        resolveOneRef.current = null;
      } else if (ev.type === "error") {
        resolveOneRef.current?.({ ok: false, error: ev.error });
        resolveOneRef.current = null;
      }
    });
    return off;
  }, [open]);

  const readyServers = useMemo(() => servers.filter((s) => s.ready), [servers]);
  useEffect(() => {
    if (!host && readyServers[0]) setHost(readyServers[0].host);
  }, [readyServers, host]);

  const deployOne = useCallback(async (domain: string, h: string) => {
    activeDomainRef.current = domain;
    setCurrentDomain(domain);
    setProgressMap((prev) => ({ ...prev, [domain]: { ...(prev[domain] ?? initDomainProgress()), status: "running" } }));

    const r = await window.dw.deployStart({ domain, host: h });
    if (!r.ok || !r.deployId) {
      const err = r.error ?? "启动失败";
      setProgressMap((prev) => ({
        ...prev,
        [domain]: { ...(prev[domain] ?? initDomainProgress()), status: "error", error: err },
      }));
      setLogLines((prev) => [...prev, `[${domain}] [start-error] ${err}`]);
      activeDomainRef.current = null;
      activeDeployIdRef.current = null;
      return { ok: false, error: err };
    }
    activeDeployIdRef.current = r.deployId;

    return await new Promise<{ ok: boolean; error?: string }>((resolve) => {
      resolveOneRef.current = resolve;
    }).finally(() => {
      activeDomainRef.current = null;
      activeDeployIdRef.current = null;
    });
  }, []);

  const onStart = useCallback(async () => {
    if (!host) return;
    setStarted(true);
    // 直接根据 deployOne 的返回值统计成败；不能依赖 progressMap，
    // 因为 useCallback 闭包里捕获的是初始 progressMap 快照（全部 "pending"），
    // 之后每次 setProgressMap 异步更新不会反向修改这里的引用，
    // 会导致旧逻辑里 `ok` 永远是 0、提示出现 "0/1 成功" 的错觉。
    let okCount = 0;
    for (const d of domains) {
      const r = await deployOne(d, host);
      if (r.ok) okCount++;
    }
    setCurrentDomain(null);
    setFinished(true);
    const total = domains.length;
    if (okCount === total) {
      message.success(`部署完成：${okCount}/${total} 成功`);
    } else if (okCount === 0) {
      message.error(`部署失败：${okCount}/${total} 成功`);
    } else {
      message.warning(`部署完成：${okCount}/${total} 成功`);
    }
  }, [deployOne, domains, host, message]);

  return (
    <Modal
      open={open}
      title={`批量部署（${domains.length} 个）`}
      onCancel={onClose}
      maskClosable={!started || finished}
      closable={!started || finished}
      footer={null}
      destroyOnHidden
      width={760}
    >
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        <div>
          <Text type="secondary">目标服务器</Text>
          <Select
            style={{ width: "100%", marginTop: 8 }}
            placeholder={readyServers.length ? "选择已配置 SSH 的服务器" : "暂无已配置 SSH 的服务器，请到「部署」页配置"}
            value={host}
            onChange={setHost}
            disabled={started || !readyServers.length}
            options={servers.map((s) => ({
              label: (
                <Space>
                  <span>{s.host}</span>
                  {s.ready ? (
                    <Tag color="success">已就绪</Tag>
                  ) : s.configured ? (
                    <Tag color="warning">不完整</Tag>
                  ) : (
                    <Tag>未配置</Tag>
                  )}
                </Space>
              ),
              value: s.host,
              disabled: !s.ready,
            }))}
          />
        </div>

        {!started ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Text type="secondary">将依次部署以下网站：</Text>
            <Space wrap>
              {domains.map((d) => (
                <Tag key={d}>{d}</Tag>
              ))}
            </Space>
            <Button
              type="primary"
              size="large"
              disabled={!host || !readyServers.length || !domains.length}
              onClick={() => void onStart()}
              block
            >
              建立 SSH 连接并开始批量上传
            </Button>
          </Space>
        ) : (
          <Space direction="vertical" style={{ width: "100%" }} size="small">
            {domains.map((d) => {
              const p = progressMap[d] ?? initDomainProgress();
              const isCurrent = currentDomain === d;
              return (
                <div
                  key={d}
                  style={{
                    border: `1px solid ${
                      isCurrent ? token.colorPrimary : token.colorBorderSecondary
                    }`,
                    borderRadius: 10,
                    padding: "8px 12px",
                    background: token.colorBgContainer,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {statusIcon(p.status)}
                    <Text strong style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                      {d}
                    </Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {p.fileIndex}/{p.totalFiles} files · {p.bytesUploaded.toLocaleString()} B
                    </Text>
                  </div>
                  <Progress
                    percent={p.percent}
                    size="small"
                    status={
                      p.status === "error" ? "exception" : p.status === "done" ? "success" : "active"
                    }
                    showInfo={false}
                  />
                  {p.lastFile ? (
                    <Text type="secondary" style={{ fontSize: 11 }}>
                      ↑ {p.lastFile}
                    </Text>
                  ) : null}
                  {p.error ? (
                    <Text type="danger" style={{ fontSize: 12, display: "block" }}>
                      {p.error}
                    </Text>
                  ) : null}
                </div>
              );
            })}

            <div
              style={{
                maxHeight: 140,
                overflowY: "auto",
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 8,
                padding: 10,
                background: token.colorFillAlter,
                fontFamily: "monospace",
                fontSize: 11.5,
                whiteSpace: "pre-wrap",
              }}
            >
              {logLines.length ? logLines.join("\n") : <Text type="secondary">等待事件…</Text>}
            </div>

            {finished ? (
              <Button block onClick={onClose}>
                关闭
              </Button>
            ) : null}
          </Space>
        )}
      </Space>
    </Modal>
  );
}

/* ---------- CatalogPanel ---------- */

type CatalogFilter = "all" | "site" | "template";

export function CatalogPanel(): ReactElement {
  const { message, modal } = AntdApp.useApp();
  const { token } = theme.useToken();
  const [data, setData] = useState<CatalogList>({ sites: [], templates: [] });
  const [loading, setLoading] = useState(false);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<CatalogFilter>("all");
  const [query, setQuery] = useState("");

  const [editOpen, setEditOpen] = useState(false);
  const [editDomain, setEditDomain] = useState<string | null>(null);

  const [deployOpen, setDeployOpen] = useState(false);
  const [deployDomains, setDeployDomains] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await window.dw.catalogListAll();
      setData(r);
      // 清理掉已不存在的站点
      setSelected((prev) => {
        const valid = new Set([...r.sites, ...r.templates].map((x) => x.name));
        const next = new Set<string>();
        for (const k of prev) if (valid.has(k)) next.add(k);
        return next;
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* ---- per-card actions ---- */

  const onPreview = useCallback(
    (it: CatalogItem) => {
      const p =
        it.kind === "site"
          ? window.dw.previewOpenSite(it.name)
          : window.dw.previewOpenTemplate(it.name);
      void p.then((r) => !r.ok && message.error(r.error));
    },
    [message],
  );

  const onEdit = useCallback((it: CatalogItem) => {
    setEditDomain(it.name);
    setEditOpen(true);
  }, []);

  const onQuickDeploy = useCallback((it: CatalogItem) => {
    setDeployDomains([it.name]);
    setDeployOpen(true);
  }, []);

  const onToggleSelect = useCallback((it: CatalogItem) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(it.name)) next.delete(it.name);
      else next.add(it.name);
      return next;
    });
  }, []);

  /* ---- batch actions ---- */

  const onBatchDeploy = useCallback(() => {
    const list = data.sites.map((s) => s.name).filter((d) => selected.has(d));
    if (!list.length) {
      message.warning("请先勾选要部署的站点（templates 无法部署）");
      return;
    }
    setDeployDomains(list);
    setDeployOpen(true);
  }, [data.sites, message, selected]);

  const onBatchExport = useCallback(async () => {
    const list = data.sites.map((s) => s.name).filter((d) => selected.has(d));
    if (!list.length) {
      message.warning("请先勾选要导出的站点");
      return;
    }
    const r = await window.dw.siteExportBatch(list);
    if (r.error === "已取消") return;
    const okN = r.items.filter((x) => x.ok).length;
    const failN = r.items.length - okN;
    if (failN === 0) message.success(`已全部导出（${okN} 个）到 ${r.targetDir}`);
    else message.warning(`完成 ${okN} 个，失败 ${failN} 个`);
    setSelected(new Set());
  }, [data.sites, message, selected]);

  /**
   * 删除一批 site（templates 永远不在 list 内）。
   * 抽成独立函数，单卡 trash 与顶部「批量删除」都复用同一份确认 / 执行 / 反馈逻辑。
   */
  const confirmAndDeleteSites = useCallback(
    (list: string[]) => {
      if (!list.length) return;
      const preview = list.slice(0, 6);
      const more = list.length - preview.length;
      modal.confirm({
        title: `删除 ${list.length} 个网站？`,
        icon: <ExclamationCircleFilled style={{ color: token.colorError }} />,
        content: (
          <div style={{ fontSize: 13, lineHeight: 1.7 }}>
            <Paragraph type="secondary" style={{ marginBottom: 8 }}>
              将永久删除 <Text code>sites/&lt;domain&gt;/</Text> 目录及其全部文件，<Text strong>不可恢复</Text>。模板（templates）不会被删除。
            </Paragraph>
            <div
              style={{
                maxHeight: 160,
                overflowY: "auto",
                padding: "8px 10px",
                background: token.colorFillAlter,
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 8,
              }}
            >
              <Space wrap size={[6, 6]}>
                {preview.map((d) => (
                  <Tag key={d} style={{ margin: 0 }}>
                    {d}
                  </Tag>
                ))}
                {more > 0 ? <Text type="secondary">…等 {more} 个</Text> : null}
              </Space>
            </div>
          </div>
        ),
        okText: `删除（${list.length}）`,
        okButtonProps: { danger: true },
        cancelText: "取消",
        centered: true,
        async onOk() {
          const r = await window.dw.siteDeleteBatch(list);
          const okN = r.items.filter((x) => x.ok).length;
          const failN = r.items.length - okN;
          if (failN === 0) {
            message.success(`已删除 ${okN} 个网站`);
          } else {
            const firstErr = r.items.find((x) => !x.ok)?.error;
            message.warning(`完成 ${okN} 个，失败 ${failN} 个${firstErr ? `：${firstErr}` : ""}`);
          }
          // 仅清掉这批已请求删除的选中态；保留其它选中。
          setSelected((prev) => {
            const next = new Set(prev);
            for (const d of list) next.delete(d);
            return next;
          });
          await refresh();
        },
      });
    },
    [message, modal, refresh, token.colorBorderSecondary, token.colorError, token.colorFillAlter],
  );

  const onBatchDelete = useCallback(() => {
    const siteSet = new Set(data.sites.map((s) => s.name));
    const list = Array.from(selected).filter((d) => siteSet.has(d));
    if (!list.length) {
      message.warning("请先勾选要删除的站点（templates 无法删除）");
      return;
    }
    confirmAndDeleteSites(list);
  }, [confirmAndDeleteSites, data.sites, message, selected]);

  const onDeleteOne = useCallback(
    (it: CatalogItem) => {
      if (it.kind !== "site") return;
      confirmAndDeleteSites([it.name]);
    },
    [confirmAndDeleteSites],
  );

  const onClearSelection = useCallback(() => setSelected(new Set()), []);

  /* ---- filtered list ---- */

  const allItems = useMemo<CatalogItem[]>(
    () => [...data.sites, ...data.templates],
    [data.sites, data.templates],
  );

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allItems
      .filter((it) => {
        if (filter === "site" && it.kind !== "site") return false;
        if (filter === "template" && it.kind !== "template") return false;
        return true;
      })
      .filter((it) => !q || it.name.toLowerCase().includes(q));
  }, [allItems, filter, query]);

  /* ---- header bar ---- */

  const selectedDeployableCount = useMemo(() => {
    const siteSet = new Set(data.sites.map((s) => s.name));
    let n = 0;
    for (const k of selected) if (siteSet.has(k)) n++;
    return n;
  }, [data.sites, selected]);

  // 可删除数量 = 可部署数量（都只针对 sites/，templates 不参与）。
  // 单独保留语义化变量名，避免后续误把「部署」当成「删除」依据。
  const selectedDeletableCount = selectedDeployableCount;

  const deployBtnDisabled = selectedDeployableCount === 0;

  const filterBar = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        flexWrap: "wrap",
        marginBottom: 18,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <Text strong style={{ fontSize: 20, color: token.colorText }}>
          网站库
        </Text>
        <Text type="secondary" style={{ fontSize: 14 }}>
          ({allItems.length})
        </Text>
      </div>

      <Input
        prefix={<SearchOutlined style={{ color: token.colorTextTertiary }} />}
        placeholder="搜索网站名称或域名"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        allowClear
        style={{ flex: 1, minWidth: 220, maxWidth: 360, borderRadius: 10 }}
      />

      {/* 选中态用主色实心胶囊 + 白字，避免 antd 默认浅灰胶囊看不清当前筛选项。 */}
      <ConfigProvider
        theme={{
          components: {
            Segmented: {
              itemSelectedBg: token.colorPrimary,
              itemSelectedColor: token.colorWhite,
              itemColor: token.colorTextSecondary,
              itemHoverColor: token.colorPrimary,
              itemHoverBg: token.colorPrimaryBg,
              trackBg: token.colorFillSecondary,
              trackPadding: 2,
              borderRadius: 8,
            },
          },
        }}
      >
        <Segmented<CatalogFilter>
          value={filter}
          onChange={(v) => setFilter(v as CatalogFilter)}
          options={[
            { label: "全部", value: "all" },
            { label: "站点 (sites)", value: "site" },
            { label: "模板 (templates)", value: "template" },
          ]}
          style={{ fontWeight: 500 }}
        />
      </ConfigProvider>

      <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
        {selected.size > 0 ? (
          <>
            <Tag color="processing" style={{ borderRadius: 6 }}>
              已选 {selected.size}
              {selected.size !== selectedDeployableCount
                ? `（可部署/删除 ${selectedDeployableCount}）`
                : ""}
            </Tag>
            <Button onClick={onClearSelection}>取消</Button>
            <Tooltip title="将选中站点打包导出到本地目录">
              <Button icon={<DownloadOutlined />} onClick={() => void onBatchExport()}>
                批量导出
              </Button>
            </Tooltip>
            <Tooltip title="删除选中站点（模板不会被删除）">
              <Button
                danger
                icon={<DeleteOutlined />}
                disabled={selectedDeletableCount === 0}
                onClick={onBatchDelete}
              >
                批量删除{selectedDeletableCount > 0 ? `（${selectedDeletableCount}）` : ""}
              </Button>
            </Tooltip>
          </>
        ) : null}
        <Button
          type="primary"
          icon={<CloudUploadOutlined />}
          disabled={deployBtnDisabled}
          onClick={onBatchDeploy}
        >
          批量部署{selectedDeployableCount > 0 ? `（${selectedDeployableCount}）` : ""}
        </Button>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => void refresh()}
          loading={loading}
          title="刷新"
        />
      </div>
    </div>
  );

  /* ---- main render ---- */

  return (
    <div style={{ width: "100%" }}>
      {filterBar}

      {filteredItems.length === 0 ? (
        <div
          style={{
            padding: "80px 0",
            background: token.colorBgContainer,
            borderRadius: 16,
            border: `1px solid ${token.colorBorderSecondary}`,
          }}
        >
          <Empty
            description={query ? `未找到包含 "${query}" 的网站` : "暂无网站"}
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
            gap: 12,
          }}
        >
          {filteredItems.map((it) => (
            <LogoCard
              key={`${it.kind}-${it.name}`}
              item={it}
              selected={selected.has(it.name)}
              onToggleSelect={() => onToggleSelect(it)}
              onPreview={() => onPreview(it)}
              onQuickDeploy={it.kind === "site" ? () => onQuickDeploy(it) : undefined}
              onEdit={it.kind === "site" ? () => onEdit(it) : undefined}
              onDelete={it.kind === "site" ? () => onDeleteOne(it) : undefined}
            />
          ))}
        </div>
      )}

      <EditDialog
        open={editOpen}
        domain={editDomain}
        onClose={() => setEditOpen(false)}
        onChanged={() => void refresh()}
      />
      <DeployModal
        open={deployOpen}
        domains={deployDomains}
        onClose={() => {
          setDeployOpen(false);
          setSelected(new Set());
          void refresh();
        }}
      />
    </div>
  );
}
