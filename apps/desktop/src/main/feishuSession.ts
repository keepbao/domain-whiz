/**
 * 飞书 OAuth 登录会话（主进程）。
 *
 * 设计：
 * - 单例 service，懒加载磁盘 session；登录 / 登出 / 查询 三件套通过 IPC 暴露给渲染层。
 * - 登录流程：
 *   1) 起一个临时 HTTP 服务监听 127.0.0.1:CALLBACK_PORT/callback；
 *   2) shell.openExternal 打开飞书授权页；
 *   3) 用户授权后浏览器跳回本地服务，拿到 code/state；
 *   4) state 必须匹配；用 code 换 user_access_token；
 *   5) 拉 user_info 拿 user_id / open_id / union_id；
 *   6) 写入 .feishu-session.json；
 *   7) 关闭 HTTP 服务，最长 5 分钟超时。
 * - 多次并发登录请求：返回同一个 in-flight Promise（避免开多个 HTTP server 抢端口）。
 * - 不持久化 refresh_token（按方案问 1A：过期就重登）。
 *
 * 注意：CALLBACK_PORT 必须与飞书后台「网页应用 → 重定向 URL」白名单一致。
 */
import { existsSync, unlinkSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { shell } from "electron";
import {
  buildAuthorizeUrl,
  exchangeCodeForUserToken,
  fetchUserInfo,
  type FeishuUserInfo,
} from "@domain-whiz/feishu";
import { loadDesktopConfig } from "./config.js";
import { getAppRoot } from "./paths.js";
import { readJsonFile, writeJsonFileAtomic } from "./jsonStore.js";

const SESSION_FILENAME = ".feishu-session.json";
const SESSION_SCHEMA_VERSION = 1;
/**
 * 回调地址必须与飞书后台「网页应用 → 桌面端主页」完全一致（含协议 / 主机名 / 端口 / 路径）。
 * 这里用 `localhost` 与飞书后台对齐；HTTP 服务实际监听不指定 host，Node 在双栈系统上
 * 会同时接受 IPv4（127.0.0.1）与 IPv6（::1）的连接，避免浏览器/OS 解析差异导致回调连不上。
 */
const CALLBACK_HOST = "localhost";
const CALLBACK_PORT = 53682;
const CALLBACK_PATH = "/callback";
const LOGIN_TIMEOUT_MS = 5 * 60_000;

export interface FeishuSessionUser {
  userId: string;
  openId: string;
  unionId?: string;
  name: string;
  email?: string;
  avatarUrl?: string;
}

export interface FeishuSession {
  user: FeishuSessionUser;
  /** 登录完成的本地时间戳。 */
  loggedInAt: number;
  /** access_token 失效时间戳；过期后需要重登。 */
  accessTokenExpiresAt: number;
}

interface SessionFile {
  version: number;
  session: FeishuSession | null;
}

export type LoginResult =
  | { ok: true; session: FeishuSession }
  | { ok: false; error: string };

function getSessionPath(): string {
  return join(getAppRoot(), SESSION_FILENAME);
}

function loadSessionFromDisk(): FeishuSession | null {
  const parsed = readJsonFile<SessionFile | null>(getSessionPath(), null);
  if (!parsed || parsed.version !== SESSION_SCHEMA_VERSION) return null;
  const s = parsed.session;
  if (!s || !s.user?.userId || !s.user.openId) return null;
  return s;
}

function saveSessionToDisk(session: FeishuSession | null): void {
  writeJsonFileAtomic(getSessionPath(), {
    version: SESSION_SCHEMA_VERSION,
    session,
  } satisfies SessionFile);
}

function clearSessionOnDisk(): void {
  const p = getSessionPath();
  if (existsSync(p)) {
    try {
      unlinkSync(p);
    } catch {
      saveSessionToDisk(null);
    }
  }
}

class FeishuSessionService {
  private current: FeishuSession | null = loadSessionFromDisk();
  private inflightLogin: Promise<LoginResult> | null = null;

  whoAmI(): FeishuSession | null {
    if (!this.current) return null;
    // access_token 过期判定（容差 60s）
    if (Date.now() > this.current.accessTokenExpiresAt - 60_000) {
      // 不主动清磁盘，让用户看到上次身份；下次登录覆盖即可
    }
    return this.current;
  }

  logout(): void {
    this.current = null;
    clearSessionOnDisk();
  }

  /** 触发一次 OAuth 登录；同一时刻只允许一个 in-flight。 */
  login(): Promise<LoginResult> {
    if (this.inflightLogin) return this.inflightLogin;
    this.inflightLogin = this.runLoginFlow().finally(() => {
      this.inflightLogin = null;
    });
    return this.inflightLogin;
  }

  private async runLoginFlow(): Promise<LoginResult> {
    const cfg = loadDesktopConfig();
    const appId = cfg.feishu?.appId?.trim();
    const appSecret = cfg.feishu?.appSecret?.trim();
    if (!appId || !appSecret) {
      return { ok: false, error: "desktop.config.json 未配置 feishu.appId / appSecret" };
    }

    const redirectUri = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;
    const state = randomBytes(16).toString("hex");
    const authorizeUrl = buildAuthorizeUrl({
      appId,
      redirectUri,
      state,
      scope: "contact:user.base:readonly",
    });

    let server: Server | null = null;
    const callbackPromise = new Promise<{ code: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`飞书登录超时（${Math.round(LOGIN_TIMEOUT_MS / 1000)}s 未完成）`));
      }, LOGIN_TIMEOUT_MS);

      const onReq = (req: IncomingMessage, res: ServerResponse): void => {
        try {
          const url = new URL(req.url ?? "/", `http://localhost:${CALLBACK_PORT}`);
          if (url.pathname !== CALLBACK_PATH) {
            res.statusCode = 404;
            res.end("Not Found");
            return;
          }
          const code = url.searchParams.get("code");
          const stateParam = url.searchParams.get("state");
          const errorParam = url.searchParams.get("error");
          if (errorParam) {
            sendCallbackPage(res, false, `飞书返回错误：${errorParam}`);
            clearTimeout(timer);
            reject(new Error(`飞书授权失败：${errorParam}`));
            return;
          }
          if (!code || !stateParam) {
            sendCallbackPage(res, false, "回调缺少 code / state");
            clearTimeout(timer);
            reject(new Error("飞书回调缺少 code / state"));
            return;
          }
          if (stateParam !== state) {
            sendCallbackPage(res, false, "state 校验失败（可能被劫持）");
            clearTimeout(timer);
            reject(new Error("OAuth state 校验失败"));
            return;
          }
          sendCallbackPage(res, true, "登录成功，可以关闭此窗口回到桌面应用。");
          clearTimeout(timer);
          resolve({ code });
        } catch (e) {
          clearTimeout(timer);
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      };

      const s = createServer(onReq);
      s.on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      });
      // 不指定 host → Node 在双栈系统上同时监听 IPv4 / IPv6 回环，
      // 避免 `localhost` 被 OS 解析到 ::1 而 server 只绑 127.0.0.1（或反之）造成连不上。
      s.listen(CALLBACK_PORT, () => {
        server = s;
      });
    });

    try {
      await shell.openExternal(authorizeUrl);
    } catch (e) {
      closeServer(server);
      return { ok: false, error: `打开飞书授权页失败：${e instanceof Error ? e.message : String(e)}` };
    }

    try {
      const { code } = await callbackPromise;
      const token = await exchangeCodeForUserToken({
        appId,
        appSecret,
        code,
        redirectUri,
      });
      const user = await fetchUserInfo(token.accessToken);
      const session = toSession(user, token.expiresIn);
      this.current = session;
      saveSessionToDisk(session);
      return { ok: true, session };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: msg };
    } finally {
      closeServer(server);
    }
  }
}

function toSession(user: FeishuUserInfo, expiresInSec: number): FeishuSession {
  return {
    user: {
      userId: user.userId,
      openId: user.openId,
      unionId: user.unionId,
      name: user.name,
      email: user.email ?? user.enterpriseEmail,
      avatarUrl: user.avatarUrl,
    },
    loggedInAt: Date.now(),
    accessTokenExpiresAt: Date.now() + expiresInSec * 1000,
  };
}

function closeServer(server: Server | null): void {
  if (!server) return;
  try {
    server.close();
  } catch {
    /* ignore */
  }
}

function sendCallbackPage(res: ServerResponse, ok: boolean, msg: string): void {
  res.statusCode = ok ? 200 : 400;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>飞书登录</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:${ok ? "#f0fdf4" : "#fef2f2"};color:#111;text-align:center}
.box{padding:32px 40px;border-radius:16px;background:#fff;box-shadow:0 8px 30px rgba(0,0,0,.08);max-width:480px}
h1{margin:0 0 12px;font-size:20px;color:${ok ? "#059669" : "#b91c1c"}}
p{margin:0;color:#555;line-height:1.6}</style></head>
<body><div class="box"><h1>${ok ? "✅ 登录成功" : "❌ 登录失败"}</h1><p>${msg}</p></div></body></html>`,
  );
}

let singleton: FeishuSessionService | null = null;
export function getFeishuSessionService(): FeishuSessionService {
  if (!singleton) singleton = new FeishuSessionService();
  return singleton;
}
