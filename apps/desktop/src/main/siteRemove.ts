/**
 * 站点目录的「强力删除」工具（删除网站库 / 模板批量清理旧目录共用）。
 *
 * Windows 上单次 `rmSync` 经常删不干净：
 *  - 杀软扫描 / 资源管理器预览 / 编辑器句柄会造成短暂 EBUSY/EPERM；
 *  - Cursor 本地 agent 沙箱有时给生成的子目录（如 assets/fonts）留下「当前账户
 *    无权访问」的受限 ACL，这是 OS 级硬性 access-deny，`force` 也绕不过去。
 *
 * 这里统一成「重试 →（受限时）takeown+icacls 拿回权限再删 → 复核」三步。
 */
import { existsSync, rmSync, readdirSync, rmdirSync, unlinkSync, lstatSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * 带重试的递归删除：`maxRetries` 让 Node 内部 rimraf 自动重试 EBUSY/EPERM/
 * ENOTEMPTY（短暂占用），`force` 顺带忽略不存在 + chmod 掉只读属性。
 */
export function rmRecursiveWithRetries(target: string): void {
  rmSync(target, { recursive: true, force: true, maxRetries: 6, retryDelay: 120 });
}

/**
 * Windows 兜底：takeown 拿回所有权、icacls 授予完全控制，破掉受限 ACL。
 * 两条命令都尽力而为（失败也不抛），把最终成败交给后续的删除 + 复核判断。
 */
export function reclaimWindowsPermissions(target: string): void {
  const user = process.env.USERNAME;
  try {
    execFileSync("takeown", ["/f", target, "/r", "/d", "y"], { stdio: "ignore" });
  } catch {
    /* 拿不到所有权也继续试 icacls / 删除 */
  }
  if (user) {
    try {
      execFileSync("icacls", [target, "/grant", `${user}:(OI)(CI)F`, "/t", "/c", "/q"], {
        stdio: "ignore",
      });
    } catch {
      /* 授权失败也继续试删除 */
    }
  }
}

function isLockCode(code: string): boolean {
  return code === "EPERM" || code === "EACCES" || code === "EBUSY" || code === "ENOTEMPTY";
}

/**
 * 探测目录树里第一个「无法列举」的子路径（受限 ACL / 越权 / 被 Cursor 沙箱锁定）。
 *
 * 复刻本地 Agent 启动时对 cwd 的递归 scandir 行为：本地 Agent 一旦扫到这种目录就会
 * 直接 EPERM 崩（报 `⨯ EPERM ... scandir ...`）。建站前先用它预检，就能把那种看不懂的
 * SDK 原始错误，换成「请退出 Cursor / 重启后删除再重试」的可操作提示。
 *
 * 返回第一个不可访问的路径；整棵树都可读则返回 null。
 */
export function findInaccessiblePath(dir: string): string | null {
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return dir;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      const sub = findInaccessiblePath(join(dir, e.name));
      if (sub) return sub;
    }
  }
  return null;
}

/**
 * 「能删则删」的手动递归删除：逐项处理，删得掉的全部删掉，删不掉的（被占用 / 沙箱改了
 * 属主、当前账户无权访问）记录下来跳过，最后返回所有残留路径。
 *
 * 这样批量删除不会因为某个站点里有一个顽固子目录（如 Cursor 沙箱留下的
 * fonts/font-awesome）就整批失败——其余站点照常删除，只把删不掉的精确报出来。
 */
function removeWhatYouCan(dir: string): string[] {
  const blocked: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    // 连列目录都被拒（受限 ACL / 越权）：整个目录无法处理。
    return [dir];
  }
  for (const name of entries) {
    const p = join(dir, name);
    let isDir = false;
    try {
      isDir = lstatSync(p).isDirectory();
    } catch {
      blocked.push(p);
      continue;
    }
    if (isDir) {
      const sub = removeWhatYouCan(p);
      if (sub.length) {
        blocked.push(...sub);
        continue;
      }
      try {
        rmdirSync(p);
      } catch {
        blocked.push(p);
      }
    } else {
      try {
        unlinkSync(p);
      } catch {
        try {
          // 只读文件：清掉只读位再删一次。
          chmodSync(p, 0o666);
          unlinkSync(p);
        } catch {
          blocked.push(p);
        }
      }
    }
  }
  if (blocked.length === 0) {
    try {
      rmdirSync(dir);
    } catch {
      blocked.push(dir);
    }
  }
  return blocked;
}

/**
 * 强力删除一个目录，分多级兜底，最大化删除成功率：
 *  1. 带重试的递归删除（处理短暂占用 / 只读）；
 *  2. 失败且 Windows 受限 → takeown+icacls 拿回权限再删（对「仅改了 ACL、未改属主」有效）；
 *  3. 仍残留 → 「能删则删」手动递归，删掉一切可删项，只跳过真正越权 / 被锁的子项；
 *  4. 若最终仍有残留，抛出带「具体残留路径 + 可操作指引」的错误。
 *
 * 注意：若子目录被 Cursor 本地沙箱改了属主（当前账户非属主），非管理员既无法 takeown 也
 * 无法删除，只能退出 Cursor / 重启或以管理员身份清理——此时会保留这些残留并明确报出。
 */
export function forceRemoveDir(target: string): void {
  if (!existsSync(target)) return;

  try {
    rmRecursiveWithRetries(target);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code ?? "";
    if (isLockCode(code) && process.platform === "win32") {
      reclaimWindowsPermissions(target);
      try {
        rmRecursiveWithRetries(target);
      } catch {
        /* 落到下面的「能删则删」手动递归 */
      }
    }
  }
  if (!existsSync(target)) return;

  // 仍残留：先（Windows）尽力拿回权限，再做「能删则删」手动递归。
  if (process.platform === "win32") reclaimWindowsPermissions(target);
  const blocked = removeWhatYouCan(target);
  if (!existsSync(target)) return;

  const preview = blocked.slice(0, 5).join("; ");
  const more = blocked.length > 5 ? ` 等共 ${blocked.length} 处` : "";
  throw new Error(
    `目录未能完全删除：${target}。删不掉的子项：${preview}${more}。` +
      `这些通常是 Cursor 本地沙箱生成时改了属主 / 留下受限 ACL 的目录（常见 fonts/font-awesome），` +
      `非管理员无法删除。请退出 Cursor 或重启电脑后重试；或以管理员身份运行：` +
      `takeown /f "${target}" /r /d y 然后 rmdir /s /q "${target}"`,
  );
}
