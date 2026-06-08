import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { getSitesRoot, getTemplatesRoot } from "./paths.js";

const LOGO_CANDIDATES = [
  "img/logo.svg",
  "img/logo.png",
  "img/logo.webp",
  "img/logo.jpg",
  "img/logo.jpeg",
  "assets/logo.svg",
  "assets/logo.png",
  "logo.svg",
  "logo.png",
  "img/200-50.png",
  "img/200-50_white.png",
];

const MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function readAsDataUrl(absPath: string): string | null {
  try {
    if (!existsSync(absPath) || !statSync(absPath).isFile()) return null;
    const buf = readFileSync(absPath);
    const ext = extname(absPath).toLowerCase();
    const mime = MIME[ext] ?? "application/octet-stream";
    if (mime === "image/svg+xml") {
      return `data:${mime};utf8,${encodeURIComponent(buf.toString("utf8"))}`;
    }
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export function pickLogoDataUrl(siteRoot: string): string | null {
  for (const rel of LOGO_CANDIDATES) {
    const url = readAsDataUrl(join(siteRoot, rel));
    if (url) return url;
  }
  return null;
}

export function listTemplateVariants(): string[] {
  const root = getTemplatesRoot();
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  return readdirSync(root)
    .filter((n) => statSync(join(root, n)).isDirectory())
    .sort((a, b) => a.localeCompare(b));
}

export function listBuiltSiteDomains(): string[] {
  const root = getSitesRoot();
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  return readdirSync(root)
    .filter((n) => {
      const p = join(root, n);
      return statSync(p).isDirectory() && existsSync(join(p, "index.html"));
    })
    .sort((a, b) => a.localeCompare(b));
}

export interface CatalogItem {
  name: string;
  kind: "site" | "template";
  hasIndex: boolean;
  logoDataUrl: string | null;
}

export interface CatalogList {
  sites: CatalogItem[];
  templates: CatalogItem[];
}

export function listCatalog(): CatalogList {
  const sitesRoot = getSitesRoot();
  const templatesRoot = getTemplatesRoot();

  const sites: CatalogItem[] = listBuiltSiteDomains().map((name) => {
    const dir = join(sitesRoot, name);
    return {
      name,
      kind: "site",
      hasIndex: existsSync(join(dir, "index.html")),
      logoDataUrl: pickLogoDataUrl(dir),
    };
  });

  const templates: CatalogItem[] = listTemplateVariants().map((name) => {
    const dir = join(templatesRoot, name);
    return {
      name,
      kind: "template",
      hasIndex: existsSync(join(dir, "index.html")),
      logoDataUrl: pickLogoDataUrl(dir),
    };
  });

  return { sites, templates };
}
