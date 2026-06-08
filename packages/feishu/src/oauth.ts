/**
 * 飞书 OAuth 2.0（authen v2）：用浏览器跳转 → 拿 code → 换 user_access_token → 拉 user_info。
 *
 * 与 FeishuClient 的区别：
 * - FeishuClient 用 tenant_access_token，代表「应用身份」；
 * - 这里用 user_access_token，代表「真实用户身份」，能直接拿到登录人的 user_id / open_id / union_id 三件套。
 *
 * 设计原则：
 * - 纯函数，不持有任何状态，所有 token 由调用方负责存。
 * - 错误统一归一化成 Error；调用方决定 UI 表达。
 */

const AUTH_BASE = "https://accounts.feishu.cn";
const API_BASE = "https://open.feishu.cn";

export interface BuildAuthorizeUrlInput {
  appId: string;
  redirectUri: string;
  state: string;
  /** 默认 `contact:user.base:readonly`（含 user_id），按需追加用空格分隔。 */
  scope?: string;
}

/** 构造飞书授权页 URL；用户在浏览器里完成授权后，会带 code/state 回到 redirectUri。 */
export function buildAuthorizeUrl(input: BuildAuthorizeUrlInput): string {
  const params = new URLSearchParams({
    app_id: input.appId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    state: input.state,
  });
  if (input.scope?.trim()) params.set("scope", input.scope.trim());
  return `${AUTH_BASE}/open-apis/authen/v1/authorize?${params.toString()}`;
}

export interface ExchangeCodeInput {
  appId: string;
  appSecret: string;
  code: string;
  redirectUri: string;
}

export interface UserTokenResult {
  accessToken: string;
  /** 通常 7200 秒。 */
  expiresIn: number;
  refreshToken?: string;
  refreshExpiresIn?: number;
  tokenType: string;
  scope?: string;
}

interface RawTokenResp {
  code?: number;
  error?: string;
  error_description?: string;
  access_token?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  token_type?: string;
  scope?: string;
}

/** 用授权码换 user_access_token（authen v2）。 */
export async function exchangeCodeForUserToken(
  input: ExchangeCodeInput,
): Promise<UserTokenResult> {
  const resp = await fetch(`${API_BASE}/open-apis/authen/v2/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: input.appId,
      client_secret: input.appSecret,
      code: input.code,
      redirect_uri: input.redirectUri,
    }),
  });
  const json = (await resp.json().catch(() => ({}))) as RawTokenResp;
  if (!resp.ok || !json.access_token) {
    const msg =
      json.error_description ||
      json.error ||
      `飞书 OAuth 换 token 失败 (HTTP ${resp.status})`;
    throw new Error(msg);
  }
  return {
    accessToken: json.access_token,
    expiresIn: json.expires_in ?? 7200,
    refreshToken: json.refresh_token,
    refreshExpiresIn: json.refresh_expires_in,
    tokenType: json.token_type ?? "Bearer",
    scope: json.scope,
  };
}

export interface FeishuUserInfo {
  userId: string;
  openId: string;
  unionId?: string;
  name: string;
  enName?: string;
  email?: string;
  enterpriseEmail?: string;
  mobile?: string;
  avatarUrl?: string;
}

interface RawUserInfo {
  code?: number;
  msg?: string;
  data?: {
    user_id?: string;
    open_id?: string;
    union_id?: string;
    name?: string;
    en_name?: string;
    email?: string;
    enterprise_email?: string;
    mobile?: string;
    avatar_url?: string;
  };
  // 老接口字段直接在顶层（兼容）
  user_id?: string;
  open_id?: string;
  union_id?: string;
  name?: string;
  email?: string;
  avatar_url?: string;
}

/** 用 user_access_token 拉登录人完整资料。 */
export async function fetchUserInfo(accessToken: string): Promise<FeishuUserInfo> {
  const resp = await fetch(`${API_BASE}/open-apis/authen/v1/user_info`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = (await resp.json().catch(() => ({}))) as RawUserInfo;
  if (!resp.ok || (json.code !== undefined && json.code !== 0)) {
    throw new Error(json.msg || `飞书拉用户信息失败 (HTTP ${resp.status})`);
  }
  const d = json.data ?? json;
  const userId = d.user_id ?? "";
  const openId = d.open_id ?? "";
  if (!userId || !openId) {
    throw new Error("飞书未返回 user_id / open_id，请检查应用权限（contact:user.base:readonly）");
  }
  return {
    userId,
    openId,
    unionId: d.union_id,
    name: d.name ?? "",
    enName: (d as RawUserInfo["data"] & { en_name?: string })?.en_name,
    email: d.email,
    enterpriseEmail: (d as RawUserInfo["data"] & { enterprise_email?: string })?.enterprise_email,
    mobile: (d as RawUserInfo["data"] & { mobile?: string })?.mobile,
    avatarUrl: d.avatar_url,
  };
}
