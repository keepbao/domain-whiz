import "@ant-design/v5-patch-for-react-19";
import "./global.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { App as AntdApp, ConfigProvider, theme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          // "域名小能手 / Domain Whiz" 品牌主色：智能紫蓝，配合 BrandMark 的紫→青渐变
          colorPrimary: "#5B6CFF",
          colorInfo: "#5B6CFF",
          colorLink: "#5B6CFF",
          colorSuccess: "#10B981",
          colorWarning: "#F59E0B",
          colorError: "#EF4444",
          colorBgLayout: "#fff",
          borderRadius: 8,
          borderRadiusLG: 16,
          fontFamily: `'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'PingFang SC', 'Microsoft YaHei', sans-serif`,
          fontSize: 14,
        },
        components: {
          Button: { controlHeight: 34, fontWeight: 500 },
          Tag: { borderRadiusSM: 6 },
          Card: { boxShadowTertiary: "0 4px 24px rgba(91,108,255,0.06)" },
        },
      }}
    >
      <AntdApp>
        <App />
      </AntdApp>
    </ConfigProvider>
  </React.StrictMode>,
);
