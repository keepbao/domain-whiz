import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app } from "electron";

/** 开发态：定位到含 templates 的仓库根；打包后：与 exe 同级的安装目录。 */
export function getAppRoot(): string {
  if (app.isPackaged) {
    return dirname(process.execPath);
  }
  const cwd = process.cwd();
  if (existsSync(join(cwd, "templates"))) {
    return cwd;
  }
  let d = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(d, "templates"))) {
      return d;
    }
    const p = dirname(d);
    if (p === d) break;
    d = p;
  }
  return cwd;
}

export function getTemplatesRoot(): string {
  const p = join(getAppRoot(), "templates");
  mkdirSync(p, { recursive: true });
  return p;
}

export function getSitesRoot(): string {
  const p = join(getAppRoot(), "sites");
  mkdirSync(p, { recursive: true });
  return p;
}

/**
 * 运行时配置路径。
 * 开发态：仓库根 `desktop.config.json`；打包后：与 exe 同级的 `desktop.config.json`（安装时由 extraFiles 带入）。
 */
export function getUserConfigPath(): string {
  return join(getAppRoot(), "desktop.config.json");
}

export function getConfigExamplePath(): string {
  return join(getAppRoot(), "config", "desktop.config.example.json");
}
