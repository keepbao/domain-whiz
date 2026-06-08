/**
 * 写死的部署路径（与批量脚本 scripts/deploy-batch.mjs 行为一致）。
 *
 * - 站点目录会被部署到 `WEB_ROOT/<域名>/`，例如 `/var/www/foo.com`。
 * - nginx site config 会被写入 `NGINX_SITES_ENABLED_DIR/<域名>`，例如
 *   `/etc/nginx/sites-enabled/foo.com`。
 * - 部署完成后远端执行 `sudo nginx -t && sudo nginx -s reload`（非 root 自动 sudo + /tmp 中转）。
 *
 * 这两个路径是远端 Linux 上的绝对路径，对所有服务器都相同，故写死不再暴露到 UI。
 */
export const WEB_ROOT = "/var/www";
export const NGINX_SITES_ENABLED_DIR = "/etc/nginx/sites-enabled";
