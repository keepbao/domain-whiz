import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  AppstoreOutlined,
  CloudUploadOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { Layout, Spin, theme } from "antd";
import { useUiStore } from "./store";
import { BuildChat } from "./BuildChat.js";
import { CatalogPanel } from "./CatalogPanel.js";
import { DeployPanel } from "./DeployPanel.js";
import { ChatHistoryPanel } from "./ChatHistoryPanel.js";
import {
  FeishuLoginGate,
  FeishuSessionProvider,
  UserAvatarMenu,
} from "./feishuAuth.js";
import { ApprovalsProvider } from "./approvalsContext.js";

const { Content, Sider } = Layout;

type AppRouteKey = "build" | "catalog" | "deploy";

function TopNavPills({
  active,
  onChange,
}: {
  active: AppRouteKey;
  onChange: (k: AppRouteKey) => void;
}): ReactElement {
  const { token } = theme.useToken();
  const items: { key: AppRouteKey; label: string; icon: ReactElement }[] = [
    { key: "build", label: "建站", icon: <RobotOutlined /> },
    { key: "catalog", label: "网站库", icon: <AppstoreOutlined /> },
    { key: "deploy", label: "部署", icon: <CloudUploadOutlined /> },
  ];

  // 滑块指示器：测量当前激活按钮的位置/尺寸，用 transform 平滑滑过去。
  const btnRefs = useRef<Partial<Record<AppRouteKey, HTMLButtonElement | null>>>({});
  const [ind, setInd] = useState<{ left: number; top: number; width: number; height: number }>({
    left: 0,
    top: 0,
    width: 0,
    height: 0,
  });

  useLayoutEffect(() => {
    const el = btnRefs.current[active];
    if (el) {
      setInd({
        left: el.offsetLeft,
        top: el.offsetTop,
        width: el.offsetWidth,
        height: el.offsetHeight,
      });
    }
  }, [active]);

  return (
    <div
      style={{
        position: "fixed",
        top: 10,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 100,
        display: "inline-flex",
        padding: 4,
        background: "rgba(255,255,255,0.85)",
        backdropFilter: "saturate(180%) blur(14px)",
        WebkitBackdropFilter: "saturate(180%) blur(14px)",
        borderRadius: 999,
        gap: 4,
        border: `1px solid ${token.colorBorderSecondary}`,
        pointerEvents: "auto",
      }}
    >
      {/* 会滑动的品牌紫蓝胶囊（垫在按钮下方），切换时平滑移动到激活项位置 */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: ind.width,
          height: ind.height,
          transform: `translate(${ind.left}px, ${ind.top}px)`,
          background: "#5B6CFF",
          borderRadius: 999,
          boxShadow: "0 4px 12px rgba(91, 108, 255, 0.35)",
          opacity: ind.width ? 1 : 0,
          transition:
            "transform 0.34s cubic-bezier(0.22, 1, 0.36, 1), width 0.34s cubic-bezier(0.22, 1, 0.36, 1)",
          zIndex: 0,
          pointerEvents: "none",
        }}
      />
      {items.map((item) => {
        const on = item.key === active;
        return (
          <button
            key={item.key}
            ref={(el) => {
              btnRefs.current[item.key] = el;
            }}
            type="button"
            onClick={() => onChange(item.key)}
            onMouseEnter={(e) => {
              if (!on) (e.currentTarget.style.background = token.colorFillTertiary);
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
            style={{
              position: "relative",
              zIndex: 1,
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "9px 18px",
              borderRadius: 999,
              fontWeight: 600,
              fontSize: 14,
              lineHeight: 1.2,
              background: "transparent",
              // 文字颜色淡入淡出，与下方滑块的移动一起形成丝滑切换
              color: on ? "#fff" : token.colorText,
              transition: "color 0.34s ease",
            }}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

export function App(): ReactElement {
  return (
    <FeishuSessionProvider>
      <FeishuLoginGate>
        <ApprovalsProvider>
          <AppShell />
        </ApprovalsProvider>
      </FeishuLoginGate>
    </FeishuSessionProvider>
  );
}

function AppShell(): ReactElement {
  const { token } = theme.useToken();
  const { config, setConfig } = useUiStore();

  const [route, setRoute] = useState<AppRouteKey>("build");
  /** 当前选中的历史会话；为 null 表示「实时模式」（显示 BuildChat）。 */
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  /** BuildChat 正在跑的 taskId（侧栏用于高亮"实时这一条"）。 */
  const [liveTaskId, setLiveTaskId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const c = await window.dw.getConfig();
    setConfig(c);
  }, [setConfig]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onNewChat = useCallback(() => {
    // 触发 BuildChat 重置（通过强制重 mount：换 key 即可）
    setSelectedHistoryId(null);
    setBuildChatKey((k) => k + 1);
  }, []);

  const [buildChatKey, setBuildChatKey] = useState(0);

  return (
    <Layout style={{ minHeight: "100vh", background: token.colorBgLayout }}>
      <TopNavPills active={route} onChange={setRoute} />

      <div
        style={{
          position: "fixed",
          top: 10,
          right: 16,
          zIndex: 100,
          pointerEvents: "auto",
        }}
      >
        <UserAvatarMenu />
      </div>

      {!config ? (
        <Content style={{ padding: 60, textAlign: "center" }}>
          <Spin />
        </Content>
      ) : (
        <>
          {/* 建站界面常驻挂载：切到「网站库 / 部署」再切回来时，进行中的 AI 对话与其流式
              订阅不会被卸载丢失，依然停留在界面上；只有用户主动点「新建对话」（buildChatKey
              自增触发重挂载）才会重置为新对话界面。非激活时用 display:none 隐藏。 */}
          <Layout style={{ display: route === "build" ? undefined : "none" }}>
            <Sider
              width={260}
              style={{
                background: token.colorBgContainer,
                height: "100vh",
                position: "sticky",
                top: 0,
                borderRight: `1px solid ${token.colorBorderSecondary}`,
              }}
            >
              <ChatHistoryPanel
                selectedId={selectedHistoryId}
                onSelect={setSelectedHistoryId}
                onNewChat={onNewChat}
                liveTaskId={liveTaskId}
              />
            </Sider>
            <Content
              style={{
                padding: "62px 16px 0",
                maxWidth: 1100,
                margin: "0 auto",
                width: "100%",
              }}
            >
              <BuildChat
                key={buildChatKey}
                selectedHistoryId={selectedHistoryId}
                onClearSelection={() => setSelectedHistoryId(null)}
                onLiveTaskChange={setLiveTaskId}
              />
            </Content>
          </Layout>

          {route !== "build" ? (
            <Content style={{ padding: "62px 16px 0px", maxWidth: 1200, margin: "0 auto", width: "100%" }}>
              {route === "catalog" ? <CatalogPanel /> : null}
              {route === "deploy" ? <DeployPanel /> : null}
            </Content>
          ) : null}
        </>
      )}
    </Layout>
  );
}
