// 花满天下仪表盘 · Cloudflare Worker 反向代理（国内直连，无需梯子）
// 上游 = GitHub Pages 站点；因为站点内部用的是相对路径，保持路径原样转发即可，无需改写 HTML。
//
// 部署（二选一）：
//   A. 本目录 deploy.sh（用 Cloudflare API token，脚本自动建脚本 + 绑定自定义域）
//   B. 控制台手点：Workers → 创建 Worker → 粘贴本文件 → 部署 → Settings → Domains & Routes
//      → Add → Custom domain → huaman.myhub.site
//
// 注意：不要挂到 myhub.site 根路径上，那里已经有 gh-proxy 的 worker 在用。
const UPSTREAM = 'https://chenweiask.github.io/huaman-dashboard';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const resp = await fetch(UPSTREAM + url.pathname + url.search, {
      method: request.method,
      headers: { 'user-agent': request.headers.get('user-agent') || 'cf-worker' },
      redirect: 'manual',                              // 上游跳转自己改，别把用户甩到被墙的 github.io
      cf: { cacheTtl: 60, cacheEverything: true },     // 边缘缓存 60s：跟上每日更新，又不至于每次回源
    });

    const h = new Headers(resp.headers);
    const loc = h.get('location');
    if (loc && loc.startsWith(UPSTREAM)) {
      h.set('location', 'https://' + url.host + loc.slice(UPSTREAM.length));
    }
    h.set('cache-control', 'public, max-age=60');
    h.set('x-robots-tag', 'noindex');                  // 镜像别被搜索引擎收录，避免和主站重复
    return new Response(resp.body, { status: resp.status, headers: h });
  },
};
