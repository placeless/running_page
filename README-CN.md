# Running Page — 隐私优先的维护版 Fork

[English](README.md) · [线上主页](https://m.placeless.net/) · [原项目 Running Page](https://github.com/yihong0618/running_page)

这是基于 [yihong0618/running_page](https://github.com/yihong0618/running_page) 维护的 `placeless/running_page` Fork：采用 **React 19、TypeScript、Vite** 的中英文运动仪表盘，并提供可选的 Python／COROS 数据同步工具。这里的文档以 **本 Fork 的实际代码与部署**为准，不继承上游已经不适用的自动部署或原始数据缓存教程。

生产站点 `https://m.placeless.net/` 由 **Vercel** 托管，Cloudflare 负责前端代理。`https://placeless.net/running/` 属于**另一个仓库和 Cloudflare 应用**，不能混为一谈。

## 本地启动（无需任何账号）

只需 Node.js 20.19+、22.13+ 或 24+ 与 pnpm（版本由 `package.json` 的 `packageManager` 指定）。只有运行 Python 同步或测试时才需要 Python 3.12+。

```sh
corepack enable  # 仅在当前 Node 环境提供 Corepack 时执行
pnpm install --frozen-lockfile
pnpm dev:sample  # 使用完全合成的示例数据
```

Vite 会显示本地访问地址。`dev:sample` 加载 `data/samples/activities.sample.json` 中的 **12 条虚构记录**，没有真实 GPS、私人身份或 COROS 密钥，也不会修改受 Git 追踪的公开数据。`pnpm dev` 则使用仓库现有、已经通过隐私检查的公开快照。

```sh
pnpm run check
pnpm run lint
node --test scripts/*.test.mjs
pnpm run build
node scripts/performance/check-bundles.mjs
pnpm preview
```

正式构建**始终**检查 `src/static/activities.json` 的隐私 schema 和 Git 索引；示例模式不能绕过构建安全检查。若要研究数据生成，请先向 `/tmp` 导出并校验，不要直接把 FIT／SQLite 或完整 GPS 放进仓库。

## 实际架构

```text
COROS Training Hub（私人账号）
           ↓
FIT 原始文件（独立 GitHub 私有归档）
           ↓
Python importer → SQLite（私人）
           ↓
privacy_export.py（私有位置保护规则）
           ↓
src/static/activities.json（脱敏后的公开记录）
           ↓
GitHub Actions 只提交公开 JSON 到 master
           ↓
Vercel → Cloudflare 代理 → 浏览器
```

浏览器不需要 COROS 密码、原始 FIT、SQLite 或敏感区域规则。**公开 JSON 就是可被任何人下载的数据**，前端隐藏路线不是隐私措施。

| 目录 / 文件                                | 职责                                          |
| ------------------------------------------ | --------------------------------------------- |
| `src/App.tsx`, `src/main.tsx`              | Web 入口、主题注册                            |
| `src/core/`                                | 共享配置、Hooks、日历计算、领域统计、路线几何 |
| `src/components/`, `src/themes/dashboard/` | 主仪表盘及组件                                |
| `src/themes/classic/`                      | 可选经典主题，共用活动加载器                  |
| `src/static/`                              | 已脱敏的公开快照、地区数据、站点资料          |
| `run_page/coros_sync.py`                   | COROS 下载与私人数据库导入                    |
| `run_page/privacy_export.py`               | 隐私策略与公开数据导出                        |
| `run_page/reconciliation.py`               | COROS → FIT → SQLite → JSON 计数对账          |
| `.github/workflows/run_data_sync.yml`      | COROS 定时同步和私人数据备份                  |
| `scripts/`                                 | 隐私检查、回归测试、可选性能测量工具          |

`run_page/` 中的其它历史平台脚本仍为上游兼容、手动使用保留；**自动同步只支持 COROS**。本 Fork 不再提供 GitHub Pages 自动发布流程，也不包含 Cloudflare Workers 部署代码。

## 个性化与扩展

修改 `config.yml` 可以设置 Dashboard／Classic、默认语言、深浅主题、运动目标及已有的公开资料配置。新增主题在 `src/themes/<name>/` 下建立模块，并在 `src/App.tsx` 中注册。共享统计及日期计算优先复用 `src/core/`，避免在组件中重新实现。

**Mapbox token 可选**：Dashboard 无 token 时使用 **MapLibre + CARTO**，必要时退化为无底图的路线视图。若使用 Mapbox，需在构建环境配置 `VITE_MAPBOX_TOKEN` 并限制允许的域名。`VITE_*` 在浏览器中可见，**不能存真正的秘密**。Classic 主题的 Mapbox 地图可能需要 token。路线展示完全取决于公开数据是否包含经审核的路线片段。

## CI、数据同步与安全边界

- **CI**：对 Python、TypeScript、格式、Lint、测试、隐私和生产构建进行自动检查；验证命令不应偷偷修改代码。
- **COROS**：每日定时和手动运行（仅 `master`），要求独立私人归档、只针对该归档的 SSH Deploy Key、COROS 凭据及私有隐私策略。原始数据先备份，公开 JSON 对账通过后才会提交。
- **生产环境**：由 Vercel 从 Git 构建 `dist/`；Vercel 环境变量与 GitHub Actions secrets 是两套配置。不能把本仓库操作应用到另一个 Cloudflare 站点。
- **隐私**：`private/`、原始 FIT／GPX／TCX、SQLite、`PNG_OUT/` 个人分享图、训练原始文件和 GPS 海报均不得加入公开 Git。`.gitignore` 不能消除历史泄露；历史处理另见专门文档。

具体说明：[Fork 维护](docs/fork-maintenance.md)、[部署边界](docs/deployment-boundaries.md)、[隐私导出](docs/privacy-export.md)、[数据对账](docs/data-integrity.md)、[性能实测](docs/performance.md)、[Git 历史处理](docs/history-remediation.md)。

## 参与贡献与原作者

请阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和 [AGENTS.md](AGENTS.md)。代码沿用原项目的 **MIT License**（见 `LICENSE`）；原作者及通用多平台能力以 [yihong0618/running_page](https://github.com/yihong0618/running_page) 为准。本 Fork 的变化、数据规则与运维边界由仓库自身文档描述。**未经明确批准，不向上游仓库推送修改。**
