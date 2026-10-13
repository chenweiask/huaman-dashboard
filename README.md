# 花满天下数据仪表盘（三国冰河时代 · 三冰联盟）

联盟每日数据的静态仪表盘。数据来自飞书表格「花满天下成员每日数据」，
由 `scripts/fetch_and_build.py` 拉取后生成 `assets/data.js`，纯静态托管在 GitHub Pages。

- 线上：`https://<user>.github.io/huaman-dashboard/`
- 入口：`index.html`（与 `huaman-dashboard.html` 同内容；**改页面请改 `huaman-dashboard.html`**，脚本会同步过去）
- 单文件版：`花满天下数据仪表盘-单文件版.html`（echarts/字体/数据全部内联，可离线发群）

## 数据自动更新

`scripts/update.sh` 一次跑完「拉数据 → 重建 → 提交 → push」，Pages 在 push 后约 1 分钟自动生效：

```bash
bash scripts/update.sh          # 手动跑一次
tail -f scripts/update.log      # 看日志
```

数据无变化时不提交（`fetch_and_build.py` 退出码 2），所以可以放心高频调用。
失败会推告警：Linux 走 `scripts/notify.sh`（飞书>微信>TG），Mac 走系统通知。

**当前部署位置**：J4125（`~/huaman-dashboard`），user crontab 每小时 :25 跑一次。
选它是因为它常开且已有飞书应用凭据；Mac 上的 launchd 任务默认**不启用**（Mac 会休眠，
lark-cli 的钥匙串在 SSH/非交互环境下取不到），Mac 只当开发机。

## 取数通道

`fetch_and_build.py` 自动二选一：

| 通道 | 条件 | 用在哪 |
|---|---|---|
| 飞书开放平台 API | `~/.hermes/.env` 里有 `FEISHU_APP_ID/SECRET` 且应用已加入该表格 | J4125 定时任务 |
| `lark-cli` | TRAE 插件自带（`~/.trae-cn/plugins/trae-remote-official/lark/*/bin/`），需已 `lark-cli auth login` | Mac 开发时 |

⚠️ 读取行数**不再硬编码**：`SHEETS` 里只留「最少行数」，真实范围由 `metainfo.rowCount` 动态决定
（`sheet_range()`）。**行数会持续增长，写死范围会静默丢人**：
- 2026-09：写 `A1:K400` 丢了最后 26 人；
- 2026-10-13：写 `A1:K2000` 时表已涨到 2050 行，10/13 那天的 99 人只读到前 49 人
  → 页面「本周·在册成员」显示 49（正确值 99）。
人数突然变少时先查这里（对比 `metainfo` 的 `rowCount`）。

## 表格结构约定

| 页签 | sheet_id | 列 |
|---|---|---|
| 成员数据 | `c7b925` | 日期\|序号\|成员名称\|阶级\|火炉等级\|战力\|周功勋\|总功勋\|周捐献\|实力\|成员ID |
| 功勋累计 | `2FckUN` | 成员ID\|当前昵称\|年度累计功勋\|本赛季总功勋\|本周功勋\|本周是否参加\|参加活动次数\|首次参加活动\|最近参加活动\|最近一次获得功勋\|最新战力\|阶级\|记录天数\|备注 |
| 活动明细 | `3lbxIY` | 活动日期\|活动名称\|成员ID\|成员昵称\|本次获得功勋 |

口径、派生表重建规则、每日导入流程见 Hermes 技能 `game-data-daily-update`。

## 改前端

`huaman-dashboard.html` + `assets/{app,charts}.js` 是页面本体；
`assets/data.js` **由脚本生成，不要手改**（下一次跑脚本会被覆盖）。
改完记得让 `index.html` 跟 `huaman-dashboard.html` 一致，否则 Pages 入口会停在旧版。

## 国内访问（中转加速）

GitHub Pages 在国内需要梯子。镜像走 Cloudflare Worker 反代：`cloudflare/worker.js`
（上游仍是 GitHub Pages，站点用相对路径，原样转发即可，无需改写 HTML）。
自定义域建议 `huaman.myhub.site`，部署脚本见 `cloudflare/deploy.sh`。

⚠️ **`myhub.site` 上已有的 github.myhub.site 是 gh-proxy（hunshcn/gh-proxy）**，它只认
`github.com/{releases,archive,blob,raw,info,git-,tags}/…`、`raw.githubusercontent.com/…`、
`gist.github.com/…` 这几类路径；**其它路径会被它转发到它自己的项目主页**，
所以拿它代理 `*.github.io` 站点只会得到一个 GitHub Pages 的 404 页。镜像必须用独立 Worker + 子域。

## Cloudflare 部署（国内访问）

Cloudflare 用 **Workers 静态资源**模式（CF 已把新项目都收到 Workers 下，Pages 只做维护）：

| 设置项 | 值 |
|---|---|
| Git 仓库 / 生产分支 | `chenweiask/huaman-dashboard` / `main` |
| Build command | `bash build.sh` |
| Deploy command | `npx wrangler deploy` |
| 非生产分支命令（Preview） | `npx wrangler versions upload` |
| Root directory（Path） | `/` |

`bash build.sh` 产出 `dist/`，`wrangler.jsonc` 里的 `assets.directory` 指向它；
`npx wrangler deploy` 把 `dist/` 上传成静态资源 Worker。推到 `main` 即自动重建，
所以数据更新链路是：cron → 推 GitHub → CF 自动构建 → 镜像生效，不需要额外的部署步骤。
