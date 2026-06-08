import type { FeishuClient } from "./client.js";

export type ReceiveIdType = "open_id" | "user_id" | "union_id" | "email" | "chat_id";

interface SendMessageResp {
  message_id?: string;
}

/** 发文本消息。 */
export async function sendTextMessage(
  client: FeishuClient,
  args: { receiveId: string; receiveIdType?: ReceiveIdType; text: string },
): Promise<string | undefined> {
  const idType: ReceiveIdType = args.receiveIdType ?? "open_id";
  const data = await client.request<SendMessageResp>(
    "POST",
    `/open-apis/im/v1/messages?receive_id_type=${idType}`,
    {
      receive_id: args.receiveId,
      msg_type: "text",
      content: JSON.stringify({ text: args.text }),
    },
  );
  return data.message_id;
}

/**
 * 发交互式消息卡片（简化版：标题 + 状态色 + 几行字段 + 备注）。
 * 想要更复杂的卡片可以直接调用 client.request 自行拼。
 */
export async function sendApprovalResultCard(
  client: FeishuClient,
  args: {
    receiveId: string;
    receiveIdType?: ReceiveIdType;
    title: string;
    statusLabel: string;
    /** "green" / "red" / "grey" / "blue" / "yellow" —— 飞书卡片支持的语义色 */
    statusColor: "green" | "red" | "grey" | "blue" | "yellow";
    rows: Array<{ label: string; value: string }>;
    note?: string;
  },
): Promise<string | undefined> {
  const idType: ReceiveIdType = args.receiveIdType ?? "open_id";
  const elements: unknown[] = [
    {
      tag: "div",
      fields: args.rows.map((r) => ({
        is_short: true,
        text: { tag: "lark_md", content: `**${r.label}**\n${r.value}` },
      })),
    },
  ];
  if (args.note?.trim()) {
    elements.push({
      tag: "note",
      elements: [{ tag: "plain_text", content: args.note.trim() }],
    });
  }
  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: args.title },
      template: args.statusColor,
      subtitle: { tag: "plain_text", content: args.statusLabel },
    },
    elements,
  };
  const data = await client.request<SendMessageResp>(
    "POST",
    `/open-apis/im/v1/messages?receive_id_type=${idType}`,
    {
      receive_id: args.receiveId,
      msg_type: "interactive",
      content: JSON.stringify(card),
    },
  );
  return data.message_id;
}
