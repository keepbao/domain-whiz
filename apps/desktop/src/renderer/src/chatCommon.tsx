import { Avatar, Button, Tooltip, theme, type ThemeConfig } from "antd";
import {
  CheckOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  InfoCircleOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useState, type CSSProperties, type ReactElement } from "react";

/**
 * 一条对话气泡。
 *
 * - 普通文本气泡：填 `text` 即可（默认行为）。
 * - 交互式卡片（飞书审批卡）：`cardKind` 指定卡片类型，`initialDomains` 是用户在输入框里
 *   被解析出的域名列表，渲染层会找到对应的 `<ApprovalCard>` 自接管，本字段对话历史里只是用来描述。
 *
 * 视觉规则：
 *  · 用户气泡：浅紫色背景 + 深色文本 + 右下角 `HH:MM ✓✓`，头像用飞书 avatarUrl（无则首字母占位）。
 *  · 助手气泡：白色卡片 + 1px 极浅边框；头像用品牌色圆角方块 + 机器人图形。
 *  · 系统气泡：虚线提示框（保持原状）。
 */
export type ChatCardKind = "purchase-approval" | "resolve-approval";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  taskId?: string;
  status?: "streaming" | "done" | "error";
  /** 非空时表示这条消息是一个交互式卡片（飞书审批），text 字段会被忽略，由对应 Card 组件接管渲染。 */
  cardKind?: ChatCardKind;
  /** 用户在原始输入里被解析出的域名（按出现顺序，已去重 + 全小写）。 */
  initialDomains?: string[];
  /** 域名解析卡片：从用户输入里解析出的解析地址（IP），用于默认填充「解析地址」列。 */
  resolveValue?: string;
  /** 消息发生时间戳；用户气泡右下角会显示 HH:MM。 */
  ts?: number;
}

export function newChatMessageId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function formatHHmm(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 品牌色机器人头像 —— 圆角方块 + 内置 SVG 机器人图形。
 * 用于全部 assistant 消息；与右上角飞书圆头像形成视觉区分。
 */
function AssistantAvatar(): ReactElement {
  return (
    <div
      style={{
        width: 36,
        height: 36,
        borderRadius: 12,
        background: "#5B6CFF",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#fff",
        flexShrink: 0,
        boxShadow: "0 4px 10px rgba(91, 108, 255, 0.30)",
      }}
      aria-label="AI 助手"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path d="M12 2v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="12" cy="2.2" r="0.9" fill="currentColor" />
        <rect
          x="4"
          y="6"
          width="16"
          height="13"
          rx="3.4"
          stroke="currentColor"
          strokeWidth="1.6"
        />
        <circle cx="9" cy="12.5" r="1.4" fill="currentColor" />
        <circle cx="15" cy="12.5" r="1.4" fill="currentColor" />
        <path
          d="M9.5 16.2c.8.4 1.6.6 2.5.6s1.7-.2 2.5-.6"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <path d="M2.5 11v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M21.5 11v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/**
 * 用户头像 —— 优先飞书 avatarUrl；否则用 antd Avatar 的首字母占位。
 * 形状为圆形，与 assistant 圆角方块对应。
 */
function UserAvatar({
  avatarUrl,
  name,
}: {
  avatarUrl?: string | null;
  name?: string;
}): ReactElement {
  const initials = (name ?? "").trim().slice(0, 1).toUpperCase();
  return (
    <Avatar
      size={36}
      src={avatarUrl || undefined}
      icon={!avatarUrl && !initials ? <UserOutlined /> : undefined}
      style={{
        background: avatarUrl ? "transparent" : "#5B6CFF",
        color: "#fff",
        fontWeight: 600,
        flexShrink: 0,
        boxShadow: "0 2px 8px rgba(15, 23, 42, 0.10)",
      }}
    >
      {!avatarUrl && initials ? initials : null}
    </Avatar>
  );
}

/**
 * 轻量 Markdown 渲染（不引第三方依赖）：支持
 *  - 标题 `#`/`##`/`###`
 *  - 围栏代码块 ```
 *  - 无序列表 `- ` / `* `、有序列表 `1. `
 *  - 分隔线 `---`
 *  - 行内 **加粗**、`代码`
 * 实时建站气泡与历史回放共用，保证「生成中」与「回看」样式一致。
 */
export function Markdown({ text }: { text: string }): ReactElement {
  const { token } = theme.useToken();
  const lines = text.split(/\r?\n/);
  const blocks: ReactElement[] = [];
  let listItems: string[] = [];
  let listOrdered = false;
  let inList = false;
  let inCode = false;
  let codeLines: string[] = [];

  const flushCode = (key: string): void => {
    if (!inCode) return;
    blocks.push(<CodeBlock key={key} code={codeLines.join("\n")} />);
    inCode = false;
    codeLines = [];
  };

  const flushList = (key: string): void => {
    if (!inList || listItems.length === 0) {
      inList = false;
      listItems = [];
      return;
    }
    const ordered = listOrdered;
    const items = listItems;
    blocks.push(
      ordered ? (
        <ol key={key} style={{ margin: "6px 0", paddingLeft: 22 }}>
          {items.map((it, i) => (
            <li key={i} style={{ margin: "2px 0" }}>
              {renderInline(it, token)}
            </li>
          ))}
        </ol>
      ) : (
        <ul key={key} style={{ margin: "6px 0", paddingLeft: 22 }}>
          {items.map((it, i) => (
            <li key={i} style={{ margin: "2px 0" }}>
              {renderInline(it, token)}
            </li>
          ))}
        </ul>
      ),
    );
    inList = false;
    listItems = [];
  };

  lines.forEach((raw, idx) => {
    const line = raw;

    // 围栏代码块 ```：开/闭切换；块内原样收集（不解析行内语法）。
    if (/^\s*```/.test(line)) {
      if (inCode) {
        flushCode(`c${idx}`);
      } else {
        flushList(`l${idx}`);
        inCode = true;
        codeLines = [];
      }
      return;
    }
    if (inCode) {
      codeLines.push(raw);
      return;
    }

    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    const h = /^\s*(#{1,3})\s+(.*)$/.exec(line);

    if (/^\s*---+\s*$/.test(line)) {
      flushList(`l${idx}`);
      blocks.push(
        <div
          key={idx}
          style={{
            height: 1,
            background: token.colorBorderSecondary,
            margin: "10px 0",
          }}
        />,
      );
      return;
    }
    if (h) {
      flushList(`l${idx}`);
      const level = h[1].length;
      const size = level === 1 ? 16 : level === 2 ? 15 : 14;
      blocks.push(
        <div
          key={idx}
          style={{ fontSize: size, fontWeight: 700, margin: "10px 0 4px", color: token.colorText }}
        >
          {renderInline(h[2], token)}
        </div>,
      );
      return;
    }
    if (ul) {
      if (!inList || listOrdered) {
        flushList(`l${idx}`);
        inList = true;
        listOrdered = false;
        listItems = [];
      }
      listItems.push(ul[1]);
      return;
    }
    if (ol) {
      if (!inList || !listOrdered) {
        flushList(`l${idx}`);
        inList = true;
        listOrdered = true;
        listItems = [];
      }
      listItems.push(ol[1]);
      return;
    }
    flushList(`l${idx}`);
    if (line.trim() === "") {
      blocks.push(<div key={idx} style={{ height: 6 }} />);
      return;
    }
    // 「思考碎句」视觉降噪：进度类短句（正在…/优化…/…中/以 … 结尾 / · 系统日志）
    // 渲染成更小更淡的次要文本，不隐藏、仍可读，避免误伤正文。
    if (isProcessLine(line)) {
      blocks.push(
        <div
          key={idx}
          style={{ margin: "1px 0", fontSize: 12, color: token.colorTextTertiary }}
        >
          {renderInline(line, token)}
        </div>,
      );
      return;
    }
    blocks.push(
      <div key={idx} style={{ margin: "1px 0" }}>
        {renderInline(line, token)}
      </div>,
    );
  });
  flushList("l-end");
  flushCode("c-end");

  return <>{blocks}</>;
}

/** 行内：**加粗** 与 `代码`。 */
function renderInline(
  text: string,
  token: { colorFillTertiary: string; colorText: string },
): ReactElement {
  const parts: ReactElement[] = [];
  const re = /(\*\*([^*]+)\*\*|`([^`]+)`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(<span key={i++}>{text.slice(last, m.index)}</span>);
    if (m[2] != null) {
      parts.push(
        <strong key={i++} style={{ fontWeight: 700 }}>
          {m[2]}
        </strong>,
      );
    } else if (m[3] != null) {
      parts.push(
        <code
          key={i++}
          style={{
            background: token.colorFillTertiary,
            borderRadius: 4,
            padding: "1px 5px",
            fontFamily: "ui-monospace, Menlo, Consolas, monospace",
            fontSize: "0.92em",
          }}
        >
          {m[3]}
        </code>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(<span key={i++}>{text.slice(last)}</span>);
  return <>{parts}</>;
}

/** 代码块 + 右上角一键复制按钮（复制后短暂显示 ✓）。 */
function CodeBlock({ code }: { code: string }): ReactElement {
  const { token } = theme.useToken();
  const [copied, setCopied] = useState(false);

  const onCopy = (): void => {
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => undefined);
  };

  return (
    <div className="dw-codeblock" style={{ position: "relative", margin: "8px 0" }}>
      <Tooltip title={copied ? "已复制" : "复制"}>
        <Button
          size="small"
          type="text"
          icon={copied ? <CheckOutlined style={{ color: token.colorSuccess }} /> : <CopyOutlined />}
          onClick={onCopy}
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            zIndex: 1,
            background: token.colorBgContainer,
            border: `1px solid ${token.colorBorderSecondary}`,
          }}
        />
      </Tooltip>
      <pre
        style={{
          margin: 0,
          padding: "10px 40px 10px 12px",
          borderRadius: 8,
          background: token.colorFillTertiary,
          border: `1px solid ${token.colorBorderSecondary}`,
          overflowX: "auto",
          fontFamily: "ui-monospace, Menlo, Consolas, monospace",
          fontSize: 12,
          lineHeight: 1.5,
          whiteSpace: "pre",
        }}
      >
        {code}
      </pre>
    </div>
  );
}

/**
 * 进度 / 思考类短句识别（用于视觉降噪）：
 *  - `· ` 开头：来自主进程的系统日志（[task ...] / [1/3] ...）
 *  - 以省略号结尾：典型的进行时提示（如 "Agent.send: 开始生成…"）
 *  - 以进度动词开头的中文短句：正在 / 优化 / 创建 ...
 * 仅做「变淡」处理，不隐藏；判别从严，尽量不误伤最终正文。
 */
function isProcessLine(line: string): boolean {
  const s = line.trim();
  if (!s) return false;
  if (s.startsWith("· ")) return true;
  if (/(…|\.{3})$/.test(s)) return true;
  return /^(正在|优化|创建|搭建|生成|构建|准备|分析|检查|配置|安装|验证|渲染|扫描|读取|写入|更新|删除|修改|调整|处理|加载|初始化|完成度)/.test(
    s,
  );
}

export interface ChatBubbleProps {
  msg: ChatMessage;
  /** 用户头像 URL（建议传飞书 OAuth session 的 avatarUrl）。 */
  userAvatarUrl?: string | null;
  /** 用户姓名（头像兜底首字母用）。 */
  userName?: string;
}

export function ChatBubble({ msg, userAvatarUrl, userName }: ChatBubbleProps): ReactElement {
  const { token } = theme.useToken();
  const isUser = msg.role === "user";
  const isSystem = msg.role === "system";

  if (isSystem) {
    return (
      <div style={{ display: "flex", justifyContent: "center", margin: "12px 0" }}>
        <div
          style={{
            maxWidth: "82%",
            padding: "10px 14px",
            borderRadius: 12,
            background: token.colorFillAlter,
            border: `1px dashed ${token.colorBorderSecondary}`,
            color: token.colorTextSecondary,
            fontSize: 12.5,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
          }}
        >
          <InfoCircleOutlined style={{ marginRight: 6, color: token.colorPrimary }} />
          {msg.text}
        </div>
      </div>
    );
  }

  const ts = msg.ts ?? null;
  const wrap: CSSProperties = {
    display: "flex",
    gap: 12,
    margin: "14px 0",
    flexDirection: isUser ? "row-reverse" : "row",
    alignItems: "flex-start",
  };

  const userBubble: CSSProperties = {
    maxWidth: "78%",
    background: "#F1EFFE",
    color: "#1F1B3A",
    padding: "10px 14px 6px",
    borderRadius: 14,
    border: "1px solid #E4E0FB",
    boxShadow: "0 1px 2px rgba(91, 108, 255, 0.06)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontSize: 13.5,
    lineHeight: 1.6,
  };

  const assistantBubble: CSSProperties = {
    maxWidth: "82%",
    background: token.colorBgContainer,
    color: token.colorText,
    padding: "12px 16px",
    borderRadius: 14,
    border: `1px solid ${token.colorBorderSecondary}`,
    boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    fontSize: 13.5,
    lineHeight: 1.65,
  };

  return (
    <div style={wrap}>
      {isUser ? (
        <UserAvatar avatarUrl={userAvatarUrl} name={userName} />
      ) : (
        <AssistantAvatar />
      )}
      <div style={isUser ? userBubble : assistantBubble}>
        {isUser ? renderRichText(msg.text) : <Markdown text={msg.text} />}
        {msg.status === "streaming" && !isUser ? (
          <span
            style={{
              display: "inline-block",
              width: 8,
              height: 14,
              marginLeft: 4,
              verticalAlign: "-2px",
              background: token.colorTextSecondary,
              animation: "dw-blink 1s steps(2, start) infinite",
              borderRadius: 1,
            }}
          />
        ) : null}
        {msg.status === "error" && !isUser ? (
          <div style={{ marginTop: 6, color: token.colorError, fontSize: 12 }}>
            <CloseCircleOutlined /> 失败
          </div>
        ) : null}
        {isUser && ts ? (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "center",
              gap: 4,
              marginTop: 6,
              fontSize: 11,
              color: "#7C7892",
            }}
          >
            <span>{formatHHmm(ts)}</span>
            <DoubleCheck />
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * `[标题]` 形式的首行会被加粗高亮；其它行原样输出。
 * 这是为了在 AI assistant bubble 里把约束说明的标题（如 `[AI 全自动建站约束]`）做视觉强调。
 */
function renderRichText(text: string): ReactElement {
  if (!text) return <span />;
  const lines = text.split(/\r?\n/);
  return (
    <>
      {lines.map((ln, i) => {
        const m = /^(\[[^\]]+\])(.*)$/.exec(ln);
        if (m) {
          return (
            <div key={i}>
              <strong style={{ fontWeight: 600 }}>{m[1]}</strong>
              {m[2]}
            </div>
          );
        }
        return <div key={i}>{ln || "\u00A0"}</div>;
      })}
    </>
  );
}

/** 用户气泡右下角的 WhatsApp 风格双勾选（已读语义，本应用恒为"已发送"状态）。 */
function DoubleCheck(): ReactElement {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        color: "#7C8AA6",
        marginLeft: 2,
      }}
      aria-label="已发送"
    >
      <CheckOutlined style={{ fontSize: 11 }} />
      <CheckOutlined style={{ fontSize: 11, marginLeft: -4 }} />
    </span>
  );
}

// keep type-only re-export to make tree-shaking happy in callers
export type { ThemeConfig };
