/**
 * 全局飞书审批列表 context。
 *
 * - 启动时拉一次 `window.dw.approvalList()` 拿到本地跟踪表快照；
 * - 订阅 `window.dw.onApprovalEvent()` —— 主进程轮询 / 提交 / 状态变更都会广播，
 *   这里按 instanceCode upsert 进 items；
 * - 所有需要展示"我的审批"的 UI（如右上角 UserAvatarMenu）都消费这个 context，
 *   避免每个组件各自订阅造成多次刷新与状态不一致。
 *
 * 必须挂在 `FeishuLoginGate` 之后 —— 未登录态下没有审批意义。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import type { ApprovalEvent, ApprovalTrackerItem } from "./global";

interface ApprovalsContextValue {
  items: ApprovalTrackerItem[];
  loading: boolean;
  refresh: () => Promise<void>;
  /** 强制刷新一条（调主进程 approval:refresh）。 */
  refreshOne: (instanceCode: string) => Promise<{ ok: boolean; error?: string }>;
}

const ApprovalsContext = createContext<ApprovalsContextValue | null>(null);

function sortByRecent(list: ApprovalTrackerItem[]): ApprovalTrackerItem[] {
  return [...list].sort((a, b) => {
    // 进行中靠前；完成的按 finishedAt 降序；都没的按 submittedAt 降序
    const aPending = !a.finishedAt ? 1 : 0;
    const bPending = !b.finishedAt ? 1 : 0;
    if (aPending !== bPending) return bPending - aPending;
    return (b.lastChangedAt ?? b.submittedAt) - (a.lastChangedAt ?? a.submittedAt);
  });
}

export function ApprovalsProvider({ children }: { children: ReactNode }): ReactElement {
  const [items, setItems] = useState<ApprovalTrackerItem[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const r = await window.dw.approvalList();
      setItems(sortByRecent(r.items));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshOne = useCallback(async (instanceCode: string) => {
    return await window.dw.approvalRefresh(instanceCode);
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.dw.onApprovalEvent((ev: ApprovalEvent) => {
      setItems((prev) => {
        const idx = prev.findIndex((it) => it.instanceCode === ev.item.instanceCode);
        const merged =
          idx < 0
            ? [...prev, ev.item]
            : prev.map((it, i) => (i === idx ? { ...it, ...ev.item } : it));
        return sortByRecent(merged);
      });
    });
    return off;
  }, [refresh]);

  const value = useMemo<ApprovalsContextValue>(
    () => ({ items, loading, refresh, refreshOne }),
    [items, loading, refresh, refreshOne],
  );

  return <ApprovalsContext.Provider value={value}>{children}</ApprovalsContext.Provider>;
}

export function useApprovals(): ApprovalsContextValue {
  const v = useContext(ApprovalsContext);
  if (!v) throw new Error("useApprovals 必须在 <ApprovalsProvider> 内调用");
  return v;
}
