# 安全策略

## 支持范围

安全修复只进入最新发布版本。请先确认 `dsh-mutipleagent` 是当前版本（见 [CHANGELOG.md](CHANGELOG.md)）再报告问题。

## 报告漏洞

请**不要**在公开 issue 中披露可被利用的细节。使用 GitHub 的私密报告通道：

<https://github.com/lkuliuying/dsh-mutipleagent/security/advisories/new>

报告中请尽量包含：受影响版本、复现步骤、期望与实际结果，以及你认为的影响面。48 小时内会收到初步答复；修复发布后会在 Release 说明中致谢（除非你要求匿名）。

## 设计上的安全边界

这个插件是只读观察器，边界写进了代码，也写在这里，便于审计：

- **只读**：不启动、暂停或审批任何 Harness 任务，不调用模型，不写入会话文件，不修改配置。
- **数据来源**：只通过 Harness 公开的 `sessionQuery` 接口读取当前 profile 的会话事件；不读取 `auth.json`、凭据、私有推理、系统消息或开发者消息。
- **网络**：服务只监听 `127.0.0.1`；所有浏览器接口都是 `GET`；拒绝跨源请求、非本机 Host 和非 owner 访问（沿用宿主登录校验）。没有遥测、外部字体、CDN 或第三方脚本。
- **渲染**：页面中的任务、汇报等文本一律用 `textContent` 写入，不拼接 HTML。
- **响应头**：CSP（`default-src 'self'`、`object-src 'none'`、`form-action 'none'`）、`x-content-type-options: nosniff`、`referrer-policy: no-referrer`、`permissions-policy` 关闭摄像头/麦克风/定位/支付/USB、`cross-origin-resource-policy: same-origin`。
- **面板 iframe**：`sandbox="allow-scripts allow-same-origin"`。同源是必需的（面板要读同源 API 与本地偏好），页面内容全部来自插件自身的静态文件，不接受用户 HTML；弹窗、顶层跳转、表单提交、下载、插件和指针锁定仍被沙箱拒绝。
- **本地服务**：静态资源带 ETag 与 `must-revalidate`，不会被中间层长期缓存；gzip 缓存上限 32 MB。

如果你发现以上任一边界可以被绕过（例如通过会话内容注入脚本、越权读取其他会话、绕过 owner 校验），那就是安全问题，请按上面的通道报告。
