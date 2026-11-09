'use strict';
// 从 CHANGELOG.md 抽出当前版本段落，作为 GitHub Release / 市场更新说明的正文。
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lines = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8').split(/\r?\n/);
const start = lines.findIndex(line => new RegExp(`^##\\s+v?${pkg.version.replace(/\./g, '\\.')}(\\s|$)`).test(line));
if (start < 0) {
  console.error(`CHANGELOG.md 缺少 “## v${pkg.version}” 段落`);
  process.exit(1);
}
let end = lines.findIndex((line, index) => index > start && /^##\s/.test(line));
if (end < 0) end = lines.length;
const body = lines
  .slice(start + 1, end)
  .join('\n')
  .trim();
const extras = [
  '',
  '---',
  '',
  `- 版本：\`dsh-mutipleagent@${pkg.version}\``,
  `- 兼容：DeepSeek Harness \`${pkg.engines.dsh}\` · Node \`${pkg.engines.node}\``,
  '- 安装包：本 Release 附带的 `dsh-mutipleagent.tgz`，或在 Harness 插件市场更新。',
  '',
  '> 只读：插件不读取会话以外的文件，不调用模型，也不向外部发送数据。',
].join('\n');
process.stdout.write(body + '\n' + extras + '\n');
