import { FeishuError, type FeishuClientConfig } from "./types.js";

interface TenantTokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire?: number;
}

interface ApiEnvelope<T> {
  code: number;
  msg: string;
  data?: T;
}

const DEFAULT_BASE_URL = "https://open.feishu.cn";
const DEFAULT_TIMEOUT_MS = 15_000;
/** 飞书 tenant_access_token 标称 2h，过期前 5 分钟主动续期。 */
const TOKEN_REFRESH_BUFFER_MS = 5 * 60_000;

/**
 * 飞书开放平台 HTTP 客户端：负责 tenant_access_token 缓存 / 自动续期 / 错误归一化。
 *
 * 设计原则：
 * - 只暴露三个原语：`getTenantAccessToken()` / `request<T>(method, path, body?)` / `dispose()`。
 * - 不缓存任何业务数据；上层 `approval.ts` / `message.ts` 决定语义。
 * - `app_secret` 永远不进异常 message、不进日志。
 */
export class FeishuClient {
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private token: { value: string; expiresAt: number } | null = null;
  /** 同一时刻只允许一个 token 请求飞行，避免抖动期重复刷。 */
  private inflightTokenRequest: Promise<string> | null = null;

  constructor(cfg: FeishuClientConfig) {
    if (!cfg.appId?.trim()) throw new Error("FeishuClient: 缺少 appId");
    if (!cfg.appSecret?.trim()) throw new Error("FeishuClient: 缺少 appSecret");
    this.appId = cfg.appId.trim();
    this.appSecret = cfg.appSecret;
    this.baseUrl = (cfg.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = cfg.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** 返回当前可用的 tenant_access_token；命中缓存直接返回，过期或将要过期自动续。 */
  async getTenantAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.token.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.token.value;
    }
    if (this.inflightTokenRequest) return this.inflightTokenRequest;
    this.inflightTokenRequest = this.fetchTokenOnce()
      .finally(() => {
        this.inflightTokenRequest = null;
      });
    return this.inflightTokenRequest;
  }

  /**
   * 任意 v3/v4 接口的统一通道：自动注入 Authorization、Content-Type 与超时；
   * 401 / 99991663 / 99991664（token 失效）会强制刷一次 token 重试一次。
   */
  async request<T>(method: "GET" | "POST" | "PUT" | "DELETE", path: string, body?: unknown): Promise<T> {
    const send = async (token: string): Promise<Response> => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(new Error("飞书 API 请求超时")), this.timeoutMs);
      try {
        return await fetch(this.urlOf(path), {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json; charset=utf-8",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    };

    let token = await this.getTenantAccessToken();
    let resp = await send(token);
    if (resp.status === 401 || resp.status === 403) {
      // 强制刷新一次再试
      this.token = null;
      token = await this.getTenantAccessToken();
      resp = await send(token);
    }

    const json = (await resp.json().catch(() => ({}))) as ApiEnvelope<T>;
    if (!resp.ok) {
      logFailure(method, path, body, resp.status, json);
      throw new FeishuError(json.code ?? resp.status, json.msg || `HTTP ${resp.status}`);
    }
    if (json.code === 99991663 || json.code === 99991664) {
      this.token = null;
      token = await this.getTenantAccessToken();
      const retry = await send(token);
      const retryJson = (await retry.json().catch(() => ({}))) as ApiEnvelope<T>;
      if (retryJson.code !== 0) {
        logFailure(method, path, body, retry.status, retryJson);
        throw new FeishuError(retryJson.code, retryJson.msg || "unknown");
      }
      return (retryJson.data ?? ({} as T)) as T;
    }
    if (json.code !== 0) {
      logFailure(method, path, body, resp.status, json);
      throw new FeishuError(json.code, json.msg || "unknown");
    }
    return (json.data ?? ({} as T)) as T;
  }

  dispose(): void {
    this.token = null;
  }

  private urlOf(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) return path;
    if (!path.startsWith("/")) path = `/${path}`;
    return `${this.baseUrl}${path}`;
  }

  private async fetchTokenOnce(): Promise<string> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error("tenant_access_token 请求超时")), this.timeoutMs);
    let resp: Response;
    try {
      resp = await fetch(this.urlOf("/open-apis/auth/v3/tenant_access_token/internal"), {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const json = (await resp.json().catch(() => ({}))) as TenantTokenResponse;
    if (!resp.ok || json.code !== 0 || !json.tenant_access_token) {
      throw new FeishuError(json.code ?? resp.status, json.msg || `tenant_access_token 获取失败`);
    }
    const expireSec = typeof json.expire === "number" && json.expire > 0 ? json.expire : 7200;
    this.token = { value: json.tenant_access_token, expiresAt: Date.now() + expireSec * 1000 };
    return this.token.value;
  }
}

/** 打印失败的请求/响应（dev 调试用）；body 截断 2KB 避免日志过长。 */
function logFailure(
  method: string,
  path: string,
  body: unknown,
  httpStatus: number,
  json: { code?: number; msg?: string } & Record<string, unknown>,
): void {
  try {
    const bodyStr =
      body === undefined
        ? "(no body)"
        : JSON.stringify(body, null, 2).slice(0, 2048);
    // eslint-disable-next-line no-console
    console.error(
      `\n[FeishuClient] ${method} ${path} FAILED\n` +
        `  http=${httpStatus} code=${json.code} msg=${json.msg}\n` +
        `  request body:\n${bodyStr}\n` +
        `  response:\n${JSON.stringify(json, null, 2).slice(0, 2048)}\n`,
    );
  } catch {
    /* 日志失败不影响主流程 */
  }
}
