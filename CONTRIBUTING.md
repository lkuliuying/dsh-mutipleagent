# 参与开发

欢迎 issue、截图和 PR。改动前请先看这一页，能省掉来回。

## 环境

- Node.js `^22.19.0 || >=24.0.0`（与 `package.json` 的 `engines` 一致）
- 支持 WebGL 的浏览器；浏览器测试使用 Playwright Chromium（`npx playwright install chromium`）
- Windows、macOS、Linux 都可以开发；本地服务只监听 `127.0.0.1`

    npm ci
    npm run build
    npm test

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run build` | esbuild 打包 `web/` 到 `public/`（含共享 chunk） |
| `npm test` | 单元测试（Node 内置 test runner） |
| `npm run test:ui` | Playwright 浏览器验收（WebGL、交互、响应式） |
| `npm run test:plugin:ui` | 以插件面板形态验收 |
| `npm run smoke:host` | 在隔离进程用本机 Desktop 的真实 SDK 加载插件 |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run check:compat` | 校验 `engines`、入口、`dsh.bundle.patch` 与版本一致性 |
| `npm run screenshots` | 启动演示服务并生成 `assets/screenshots/*.jpg` 与 `screenshots.json` |

## 改动约定

- **不要手改构建产物**：`public/app.js`、`public/demo.js`、`public/chunks/**` 由 `npm run build` 生成，CI 会检查它们与源码一致。
- 源码位置：`src/` 是只读服务与 Harness 会话解析；`web/` 是页面交互与 3D 场景；`vendor/` 是固定版本的上游渲染代码（尽量少改，改了要写清原因）。
- 新增用户可见文案时同时补齐 `web/i18n.mjs` 的中英文条目，不要只写中文。
- 提交前跑 `npm run lint && npm run format:check && npm test`。CI 会在 Node 22.19 与 24 上重复这些检查。
- 提交信息用 `type(scope): 说明` 的形式（`feat`、`fix`、`docs`、`chore`、`refactor`、`test`、`perf`、`build`、`ci`）。
- 一次 PR 只做一件事；涉及界面的改动请附截图（`npm run screenshots` 生成的图可直接引用）。

## 发布

维护者执行：

    npm run release -- 0.2.0

脚本会校验版本递增、要求 CHANGELOG 已有 `## v0.2.0` 段落、跑全部闸门，然后提交、打 tag 并推送。推 tag 后 `.github/workflows/release.yml` 会创建 GitHub Release，并在配置了 `NPM_TOKEN` 时发布到 npm。

## 不要做的事

- 不要新增对会话文件的直接路径读取——只走 `sessionQuery` 公开接口。
- 不要引入 CDN、外部字体、遥测或任何外发请求。
- 不要把只读观察扩成"能启动/审批任务"的写操作，这是插件的核心边界。
