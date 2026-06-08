/**
 * 公共 JSON 持久化原语：所有「仓库根隐藏文件」落盘统一走这里。
 *
 * - writeJsonFileAtomic：写 tmp → fsync → rename 的原子套路，避免崩在写一半把文件干没。
 * - readJsonFile：读不到 / 坏文件一律返回 fallback，不抛错（不阻塞主进程启动）。
 *
 * 之前 chatHistoryStore / approvalStore 各写了一份原子写，feishuSession / config
 * 还是普通 writeFileSync（非原子）。收敛到此处后，写盘语义全仓库一致。
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

/** 读取并 JSON.parse；文件不存在 / 解析失败 / 校验不过 → 返回 fallback。 */
export function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/** 原子写：tmp → fsync → rename。父目录不存在时自动创建。 */
export function writeJsonFileAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const body = JSON.stringify(data, null, 2);
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, body);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}
