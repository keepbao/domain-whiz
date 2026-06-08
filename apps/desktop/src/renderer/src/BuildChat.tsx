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
  Input,
  Segmented,
  Select,
  Space,
  Tag,
  Typography,
  theme,
} from "antd";
import {
  AppstoreOutlined,
  SendOutlined,
  StopOutlined,
  ThunderboltFilled,
} from "@ant-design/icons";
import type {
  ApprovalKind,
  CatalogItem,
  ChatChunk,
  TemplatePickStrategy,
} from "./global";
import { ChatBubble, newChatMessageId, type ChatMessage } from "./chatCommon.js";
import { PurchaseApprovalCard, ResolveApprovalCard } from "./ApprovalCard.js";
import { HistorySessionView } from "./ChatHistoryPanel.js";
import { useFeishuSession } from "./feishuAuth.js";

/** UI 模式：Segmented 三选一；相比 `BuildMode` 多了 `approval`（飞书审批）模式。 */
type UiMode = "ai-full" | "template-batch" | "approval";

const { Text } = Typography;

/**
 * 各模式顶部的欢迎气泡文案（AI 全自动 / 模板批量 / 飞书审批）。
 * 提取为模块级常量，并配合 useMemo 复用，避免每次渲染重建。
 * 说明：纯展示文案，用换行拼接成多行气泡。
 */
const AI_CONSTRAINTS_BUBBLE = [
  "【AI 全自动建站】",
  "",
  "• 你是一个全自动建站 Agent，接收用户的域名和需求，自动完成网站规划、设计、开发与部署。",
  "• 仅输出建站相关结果，不解释过程，不询问确认，保持高效执行。",
  "• 默认使用响应式设计，优先保证性能与 SEO。",
  "• 图片使用合法可商用素材，文案建议为英文。",
  "• 部署成功后，返回网站预览链接。",
].join("\n");

const BATCH_HINT_BUBBLE = [
  "【模板批量复制】",
  "",
  "• 从 templates/<模板名>/ 整目录复制为 sites/<目标域名>/，按数量批量生成。",
  "• 自动改写 4 种域名占位风格（原样 / 全小写 / Src-Title / SRC-UPPER）以替换全文出现的旧域名。",
  "• 自动替换素材 img/1000.png、img/200-50.png(_white) 以及模板里的 logo 占位。",
  "• 调用 Cursor Agent 在 sites/<目标域名>/img/logo.svg 生成新 logo。",
  "• 不走 AI 完整建站流程，速度远快于 AI 全量模式。",
].join("\n");

const APPROVAL_HINT_BUBBLE = [
  "【飞书审批】",
  "",
  "• 输入「购买 foo.com」或「解析 api.foo.com 到 1.2.3.4」，会自动识别为审批请求并弹出审批卡片。",
  "• 提交后会创建飞书审批实例，需确保发起人 user_id / 域名负责人 / 模板字段都填好，否则飞书会拒收。",
  "• 提交后每 60 秒轮询一次审批状态，结果通过桌面通知 + 飞书 APPROVED 卡片同时通知你。",
  "• 可随时手动取消正在进行的审批。",
].join("\n");

const WELCOME_BUBBLE_BY_MODE: Record<UiMode, string> = {
  "ai-full": AI_CONSTRAINTS_BUBBLE,
  "template-batch": BATCH_HINT_BUBBLE,
  approval: APPROVAL_HINT_BUBBLE,
};

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
const DOMAIN_TOKEN_RE = /[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+/gi;

const PURCHASE_KEYWORDS_RE = /购买|采购|注册\s*域名|买\s*域名/;
const RESOLVE_KEYWORDS_RE = /解析\s*域名|域名\s*解析|解析/;

const IPV4_TOKEN_RE = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;

function isIpv4(s: string): boolean {
  const parts = s.split(".");
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

function extractDomains(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(DOMAIN_TOKEN_RE)) {
    const d = m[0].toLowerCase();
    // IPv4（解析地址）会被 DOMAIN_TOKEN_RE 误匹配为域名，这里显式排除。
    if (isIpv4(d)) continue;
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

/** 从「域名解析」输入里提取第一个合法 IPv4 作为默认解析地址（无则返回空串）。 */
function extractResolveValue(text: string): string {
  for (const m of text.matchAll(IPV4_TOKEN_RE)) {
    if (isIpv4(m[0])) return m[0];
  }
  return "";
}

function detectApprovalIntent(
  text: string,
): { kind: ApprovalKind; domains: string[]; value: string } | null {
  const isPurchase = PURCHASE_KEYWORDS_RE.test(text);
  const isResolve = RESOLVE_KEYWORDS_RE.test(text);
  if (!isPurchase && !isResolve) return null;
  const kind: ApprovalKind = isResolve ? "domain-resolve" : "domain-purchase";
  return {
    kind,
    domains: extractDomains(text),
    value: isResolve ? extractResolveValue(text) : "",
  };
}

function parseAiInput(text: string): { domain: string; message: string } {
  const trimmed = text.trim();
  if (!trimmed) return { domain: "", message: "" };
  const m = trimmed.match(/^(\S+)(?:[\s\n]+([\s\S]+))?$/);
  if (!m) return { domain: "", message: trimmed };
  const first = m[1] ?? "";
  const rest = (m[2] ?? "").trim();
  if (DOMAIN_RE.test(first)) return { domain: first.toLowerCase(), message: rest };
  return { domain: "", message: trimmed };
}

function parseDomainList(text: string): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\n,;\s]+/)) {
    const d = raw.trim().toLowerCase();
    if (!d) continue;
    if (DOMAIN_RE.test(d)) valid.push(d);
    else invalid.push(d);
  }
  return { valid, invalid };
}

function renderChatItem(
  msg: ChatMessage,
  ctx: { userAvatarUrl?: string | null; userName?: string },
): ReactElement {
  if (msg.cardKind === "purchase-approval") {
    return (
      <PurchaseApprovalCard
        key={msg.id}
        initialDomains={msg.initialDomains ?? []}
        originalInput={msg.text}
      />
    );
  }
  if (msg.cardKind === "resolve-approval") {
    return (
      <ResolveApprovalCard
        key={msg.id}
        initialDomains={msg.initialDomains ?? []}
        initialValue={msg.resolveValue ?? ""}
        originalInput={msg.text}
      />
    );
  }
  return (
    <ChatBubble
      key={msg.id}
      msg={msg}
      userAvatarUrl={ctx.userAvatarUrl}
      userName={ctx.userName}
    />
  );
}

interface BuildChatProps {
  onBuilt?: () => void;
  /** 选中的历史会话 id（只读回看历史时使用） */
  selectedHistoryId?: string | null;
  /** 点击「返回」时清除选中态的回调 */
  onClearSelection?: () => void;
  /** 实时任务 id 变化回调（用于与「目录」联动展示） */
  onLiveTaskChange?: (taskId: string | null) => void;
}

export function BuildChat({
  onBuilt,
  selectedHistoryId,
  onClearSelection,
  onLiveTaskChange,
}: BuildChatProps): ReactElement {
  const { message } = AntdApp.useApp();
  const { token } = theme.useToken();
  const { session } = useFeishuSession();
  const userAvatarUrl = session?.user.avatarUrl ?? null;
  const userName = session?.user.name ?? "";

  const [mode, setMode] = useState<UiMode>("ai-full");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [running, setRunning] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const liveTaskIdRef = useRef<string | null>(null);
  const streamingMsgIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const [domain, setDomain] = useState("");
  const [input, setInput] = useState("");

  const [domainsText, setDomainsText] = useState("");
  const [templatePick, setTemplatePick] = useState<TemplatePickStrategy>("round-robin");
  const [fixedVariant, setFixedVariant] = useState<string>("");
  const [templates, setTemplates] = useState<CatalogItem[]>([]);

  useEffect(() => {
    let alive = true;
    void window.dw
      .catalogListAll()
      .then((r) => {
        if (alive) setTemplates(r.templates);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const off = window.dw.onChatChunk((chunk: ChatChunk) => {
      if (!streamingMsgIdRef.current) return;
      const text = chunk.text ?? "";
      setMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === streamingMsgIdRef.current);
        if (idx < 0) return prev;
        const cur = prev[idx]!;
        const next: ChatMessage = (() => {
          if (chunk.type === "text") return { ...cur, text: (cur.text ?? "") + text };
          if (chunk.type === "info") {
            return { ...cur, text: (cur.text ?? "") + (cur.text ? "\n" : "") + `· ${text}` };
          }
          if (chunk.type === "done") {
            return { ...cur, status: "done", text: (cur.text ?? "") + (text ? `\n${text}` : "") };
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
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const onStop = useCallback(async () => {
    if (!running || cancelling) return;
    setCancelling(true);
    try {
      const r = await window.dw.chatCancel();
      if (!r.ok) message.warning(r.error);
    } finally {
      setCancelling(false);
    }
  }, [running, cancelling, message]);

  const setLiveTaskId = useCallback(
    (id: string | null) => {
      liveTaskIdRef.current = id;
      onLiveTaskChange?.(id);
    },
    [onLiveTaskChange],
  );

  const onSubmitAi = useCallback(async () => {
    if (running) return;
    const raw = input.trim();
    if (!raw) {
      message.warning("请输入内容");
      return;
    }

    const intent = detectApprovalIntent(raw);
    if (intent) {
      const newMsgs: ChatMessage[] = [];
      newMsgs.push({
        id: newChatMessageId(),
        role: "user",
        text: raw,
        status: "done",
        ts: Date.now(),
      });
      newMsgs.push({
        id: newChatMessageId(),
        role: "assistant",
        text: raw,
        status: "done",
        cardKind: intent.kind === "domain-purchase" ? "purchase-approval" : "resolve-approval",
        initialDomains: intent.domains,
        resolveValue: intent.value,
      });
      setMessages((prev) => [...prev, ...newMsgs]);
      setInput("");
      if (intent.domains.length === 0) {
        message.info(
          "没有识别到域名，请在卡片里手动补充；或在消息里直接写明域名",
        );
      }
      return;
    }

    const parsed = parseAiInput(raw);
    const effectiveDomain = domain || parsed.domain;
    if (!effectiveDomain) {
      message.warning(
        "请先输入或在消息里以域名开头（例如：foo.com Describe the landing page）",
      );
      return;
    }
    const effectiveMsg = domain ? raw : parsed.message;
    if (!effectiveMsg) {
      message.warning("请输入修改说明");
      return;
    }
    if (!domain) setDomain(effectiveDomain);
    setInput("");

    const userBubbleText = domain ? raw : `${effectiveDomain} · ${effectiveMsg}`;
    const userMsg: ChatMessage = {
      id: newChatMessageId(),
      role: "user",
      text: userBubbleText,
      status: "done",
      ts: Date.now(),
    };
    const assistantId = newChatMessageId();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      text: "",
      status: "streaming",
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setRunning(true);
    streamingMsgIdRef.current = assistantId;

    const r = await window.dw.chatRun({
      mode: "ai-full",
      domain: effectiveDomain,
      message: effectiveMsg,
    });
    if (r.taskId) setLiveTaskId(r.taskId);
    if (!r.ok) {
      streamingMsgIdRef.current = null;
      setMessages((prev) =>
        prev.map((x) =>
          x.id === assistantId
            ? { ...x, status: "error", text: `[error] ${r.error ?? "失败"}` }
            : x,
        ),
      );
      message.error(r.error ?? "处理失败");
      setRunning(false);
      setLiveTaskId(null);
      return;
    }
    setMessages((prev) =>
      prev.map((x) => (x.id === assistantId ? { ...x, taskId: r.taskId, status: "done" } : x)),
    );
    setRunning(false);
    streamingMsgIdRef.current = null;
    setLiveTaskId(null);
    if (onBuilt) onBuilt();
  }, [domain, input, message, onBuilt, running, setLiveTaskId]);

  const onSubmitBatch = useCallback(async () => {
    if (running) return;
    const { valid, invalid } = parseDomainList(domainsText);
    if (valid.length === 0) {
      message.warning(
        "未识别到合法域名，请检查格式（一行一个 / 逗号分隔均可）",
      );
      return;
    }
    if (invalid.length > 0) {
      message.warning(
        `已忽略 ${invalid.length} 个非法域名：${invalid
          .slice(0, 3)
          .join(", ")}…`,
      );
    }
    if (fixedVariant && !templates.some((t) => t.name === fixedVariant)) {
      message.error(`未找到该模板：${fixedVariant}`);
      return;
    }

    const summary = fixedVariant
      ? `固定模板 ${fixedVariant}`
      : `策略 ${templatePick === "round-robin" ? "轮询" : "随机"}`;
    const userBubbleText = `[批量复制模板] ${valid.length} 个域名 · ${summary}\n${valid.join("\n")}`;
    const userMsg: ChatMessage = {
      id: newChatMessageId(),
      role: "user",
      text: userBubbleText,
      status: "done",
      ts: Date.now(),
    };
    const assistantId = newChatMessageId();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: "assistant",
      text: "",
      status: "streaming",
    };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setRunning(true);
    streamingMsgIdRef.current = assistantId;

    const r = await window.dw.chatRun({
      mode: "template-batch",
      domains: valid,
      fixedVariant: fixedVariant || undefined,
      templatePick,
    });
    if (r.taskId) setLiveTaskId(r.taskId);

    if (!r.ok && !r.batch) {
      streamingMsgIdRef.current = null;
      setMessages((prev) =>
        prev.map((x) =>
          x.id === assistantId
            ? { ...x, status: "error", text: `[error] ${r.error ?? "失败"}` }
            : x,
        ),
      );
      message.error(r.error ?? "批量生成失败");
      setRunning(false);
      setLiveTaskId(null);
      return;
    }

    setMessages((prev) =>
      prev.map((x) =>
        x.id === assistantId
          ? {
              ...x,
              taskId: r.taskId,
              status: r.ok ? "done" : "error",
            }
          : x,
      ),
    );
    setRunning(false);
    streamingMsgIdRef.current = null;
    setLiveTaskId(null);
    if (r.batch) {
      const tip = `批量生成完成：成功 ${r.batch.succeeded} / 失败 ${r.batch.failed} / 总计 ${r.batch.total}`;
      if (r.batch.failed > 0) message.warning(tip);
      else message.success(tip);
    }
    if (onBuilt) onBuilt();
  }, [domainsText, fixedVariant, templatePick, templates, message, onBuilt, running, setLiveTaskId]);

  const onSubmitApproval = useCallback(async () => {
    if (running) return;
    const raw = input.trim();
    if (!raw) {
      message.warning("请输入审批说明，例如“购买 foo.com”或“解析 api.foo.com 到 1.2.3.4”");
      return;
    }
    const intent = detectApprovalIntent(raw);
    const kind: ApprovalKind = intent?.kind ?? "domain-purchase";
    const domains = intent?.domains ?? extractDomains(raw);

    const newMsgs: ChatMessage[] = [
      {
        id: newChatMessageId(),
        role: "user",
        text: raw,
        status: "done",
        ts: Date.now(),
      },
      {
        id: newChatMessageId(),
        role: "assistant",
        text: raw,
        status: "done",
        cardKind: kind === "domain-purchase" ? "purchase-approval" : "resolve-approval",
        initialDomains: domains,
        resolveValue: intent?.value ?? "",
      },
    ];
    setMessages((prev) => [...prev, ...newMsgs]);
    setInput("");
    if (domains.length === 0) {
      message.info(
        "没有识别到域名，请在卡片里手动补充",
      );
    }
  }, [running, input, message]);

  const onSubmit =
    mode === "template-batch"
      ? onSubmitBatch
      : mode === "approval"
        ? onSubmitApproval
        : onSubmitAi;

  const onReset = useCallback(() => {
    setMessages([]);
    setDomain("");
    setInput("");
    setDomainsText("");
    streamingMsgIdRef.current = null;
  }, []);

  /**
   * 当前模式对应的欢迎气泡消息。
   * 仅依赖 mode；与真实 messages 列表无关，故单独用 useMemo 维护。
   */
  const welcomeMsg = useMemo<ChatMessage>(
    () => ({
      id: `welcome-${mode}`,
      role: "assistant",
      text: WELCOME_BUBBLE_BY_MODE[mode],
      status: "done",
    }),
    [mode],
  );

  const surface = {
    background: token.colorBgContainer,
    borderRadius: 20,
    border: `1px solid ${token.colorBorderSecondary}`,
    boxShadow: "0 8px 30px rgba(15, 23, 42, 0.06)",
  } as const;

  const templateOptions = useMemo(
    () =>
      templates.map((t) => ({
        label: t.name,
        value: t.name,
      })),
    [templates],
  );

  // 注意：modeOptions 用 useMemo 缓存，避免每次渲染重建 antd Segmented + 抖动。
  // 同时必须放在 `if (selectedHistoryId)` 的提前 return 之前，
  // 否则历史态 <-> 编辑态切换时 hook 数量会变化，
  // 触发 React「Rendered fewer hooks than expected」报错。
  const modeOptions = useMemo<
    Array<{ value: UiMode; label: string; icon: ReactElement }>
  >(
    () => [
      { value: "ai-full", icon: <ThunderboltFilled />, label: "AI 全量" },
      { value: "template-batch", icon: <AppstoreOutlined />, label: "模板批量" },
      { value: "approval", icon: <SendOutlined />, label: "飞书审批" },
    ],
    [],
  );

  if (selectedHistoryId) {
    return (
      <Space direction="vertical" style={{ width: "100%" }} size={14}>
        <div style={{ ...surface, padding: 0, overflow: "hidden" }}>
          <HistorySessionView
            sessionId={selectedHistoryId}
            onBack={() => onClearSelection?.()}
          />
        </div>
      </Space>
    );
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={14}>
      {/* ===== 消息区：顶部 header bar（含「新会话」按钮） ===== */}
      <div style={{ ...surface, padding: 0, overflow: "hidden", position: "relative" }}>
        {messages.length > 0 ? (
          <Button
            size="small"
            type="text"
            onClick={onReset}
            disabled={running}
            style={{
              position: "absolute",
              top: 8,
              right: 10,
              zIndex: 2,
              color: token.colorTextTertiary,
            }}
          >
            {"新会话"}
          </Button>
        ) : null}
        <div ref={scrollRef} style={{ height: 480, overflowY: "auto", padding: "16px 24px" }}>
          <ChatBubble msg={welcomeMsg} userAvatarUrl={userAvatarUrl} userName={userName} />
          {messages.map((m) => renderChatItem(m, { userAvatarUrl, userName }))}
        </div>
      </div>

      {/* ===== 输入区：Segmented + textarea + 发送按钮 ===== */}
      <div style={{ ...surface, padding: 14, position: "relative" }}>
        {mode === "ai-full" && domain ? (
          <Tag color="processing" style={{ position: "absolute", left: 14, top: -10, margin: 0 }}>
            {domain}
          </Tag>
        ) : null}

        {/* Mode selector: override Segmented tokens so the active option is a
            solid primary pill (white text) -- the antd default light-grey
            capsule was too low-contrast to tell which mode is active. */}
        <div style={{ marginBottom: 10 }}>
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
            <Segmented<UiMode>
              value={mode}
              onChange={(v) => setMode(v as UiMode)}
              disabled={running}
              options={modeOptions}
              style={{ fontWeight: 500 }}
            />
          </ConfigProvider>
        </div>

        {mode === "template-batch" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 14 }}>
            <Input.TextArea
              autoSize={{ minRows: 4, maxRows: 12 }}
              placeholder={
                "粘贴域名列表，一行一个：\nfoo.com\nbar.io\nbaz.net"
              }
              value={domainsText}
              onChange={(e) => setDomainsText(e.target.value)}
              disabled={running}
              style={{ fontSize: 14, fontFamily: "ui-monospace, Menlo, Consolas, monospace" }}
            />
            <Space direction="vertical" size={10} style={{ width: "100%" }}>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {"选择策略"}
                </Text>
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
                  <Segmented<TemplatePickStrategy>
                    block
                    size="small"
                    value={templatePick}
                    onChange={(v) => setTemplatePick(v as TemplatePickStrategy)}
                    disabled={running || !!fixedVariant}
                    options={[
                      { label: "轮询", value: "round-robin" },
                      { label: "随机", value: "random" },
                    ]}
                    style={{ fontWeight: 600 }}
                  />
                </ConfigProvider>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {"或固定模板（设置后忽略策略）"}
                </Text>
                <Select
                  allowClear
                  showSearch
                  placeholder={"留空 = 按策略自动选择"}
                  value={fixedVariant || undefined}
                  onChange={(v) => setFixedVariant(v ?? "")}
                  options={templateOptions}
                  disabled={running}
                  style={{ width: "100%" }}
                />
              </div>
              {running ? (
                <Button
                  type="primary"
                  danger
                  icon={<StopOutlined />}
                  loading={cancelling}
                  onClick={() => void onStop()}
                  block
                >
                  {"停止"}
                </Button>
              ) : (
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  disabled={!domainsText.trim()}
                  onClick={() => void onSubmit()}
                  block
                >
                  {"开始批量生成"}
                </Button>
              )}
            </Space>
          </div>
        ) : (
          <div style={{ position: "relative" }}>
            <Input.TextArea
              variant="borderless"
              autoSize={{ minRows: 3, maxRows: 10 }}
              placeholder={
                mode === "approval"
                  ? "例如：购买 foo.com bar.com 这两个域名 / 解析 api.foo.com 到 10.0.0.5"
                  : domain
                    ? `继续与 ${domain} 对话；Enter 发送 / Shift+Enter 换行；想换域名直接以 <域名> 开头重新输入即可`
                    : "输入域名 + 需求描述（中文）…"
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPressEnter={(e) => {
                if (!e.shiftKey) {
                  e.preventDefault();
                  void onSubmit();
                }
              }}
              disabled={running}
              style={{ width: "100%", padding: "6px 60px 6px 4px", resize: "none", fontSize: 14 }}
            />
            {running ? (
              <Button
                type="primary"
                danger
                shape="circle"
                size="large"
                icon={<StopOutlined />}
                loading={cancelling}
                onClick={() => void onStop()}
                title="Stop"
                style={{ position: "absolute", right: 6, bottom: 6, ...sendButtonGradient(true) }}
              />
            ) : (
              <Button
                type="primary"
                shape="circle"
                size="large"
                icon={<SendOutlined />}
                disabled={!input.trim()}
                onClick={() => void onSubmit()}
                style={{ position: "absolute", right: 6, bottom: 6, ...sendButtonGradient(false) }}
              />
            )}
          </div>
        )}
      </div>
    </Space>
  );
}

/** 发送按钮样式：品牌色 #5B6CFF；danger=true 时返回红色渐变（用于停止按钮）。 */
function sendButtonGradient(danger: boolean): Record<string, string> {
  if (danger) {
    return {
      background: "linear-gradient(135deg, #EF4444 0%, #F97316 100%)",
      border: "none",
      boxShadow: "0 4px 10px rgba(239, 68, 68, 0.35)",
    };
  }
  return {
    background: "#5B6CFF",
    border: "none",
    boxShadow: "0 4px 10px rgba(91, 108, 255, 0.35)",
  };
}
