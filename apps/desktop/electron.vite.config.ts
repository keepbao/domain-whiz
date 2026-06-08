import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

const pkg = (name: string) => resolve(__dirname, "../../packages", name, "src/index.ts");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      sourcemap: true,
    },
    resolve: {
      alias: {
        "@domain-whiz/deployer": pkg("deployer"),
        "@domain-whiz/generator": pkg("generator"),
        "@domain-whiz/feishu": pkg("feishu"),
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react()],
  },
});
