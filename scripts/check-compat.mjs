'use strict';
// 版本与宿主兼容自检：范围可解析、清单与实际文件一致、版本号三处同步。
import fs from 'node:fs';
import path from 'node:path';
import * as semver from 'semver';

const root = path.resolve(import.meta.dirname, '..');
const problems = [];
const fail = message => problems.push(message);
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const exists = file => fs.existsSync(path.join(root, file));

const pkg = JSON.parse(read('package.json'));
if (!semver.valid(pkg.version)) fail(`package.json version 不是合法版本号：${pkg.version}`);

for (const engine of ['node', 'dsh']) {
  const range = pkg.engines?.[engine];
  if (typeof range !== 'string' || semver.validRange(range) === null) fail(`engines.${engine} 不是合法 semver 范围：${range}`);
}
// 精确钉死预发布版会让同类补丁版被拒绝，这里要求范围能覆盖宿主。
const dshRange = pkg.engines?.dsh;
const hostFlag = process.argv.indexOf('--dsh');
const host = hostFlag > 0 ? process.argv[hostFlag + 1] : null;
if (host && dshRange && !semver.satisfies(host, dshRange)) fail(`engines.dsh=${dshRange} 不接受宿主 ${host}`);

const bundle = pkg.dsh?.bundle;
const patchFile = typeof bundle?.patch === 'string' ? bundle.patch.replace(/^\.\//, '') : '';
if (!patchFile) fail('缺少 dsh.bundle.patch');
else if (!exists(patchFile)) fail(`dsh.bundle.patch 指向的文件不存在：${patchFile}`);
else if (
  !(pkg.files || []).some(entry => patchFile === entry.replace(/^\.\//, '') || patchFile.startsWith(entry.replace(/^\.\//, '').replace(/\/$/, '') + '/'))
) {
  fail(`dsh.bundle.patch（${patchFile}）没有包含在 package.json 的 files 中，发布后会缺失`);
}
if (!pkg.main || !exists(pkg.main)) fail(`main 入口不存在：${pkg.main}`);
if (!pkg.dsh?.client) fail('缺少 dsh.client 入口');

for (const file of ['README.md', 'CHANGELOG.md', 'LICENSE']) if (!exists(file)) fail(`缺少 ${file}`);
for (const dir of ['public', 'assets', 'vendor']) if (!exists(dir)) fail(`缺少 ${dir}/ 目录`);

// 插件市场的截图约定：仓库根的 screenshots.json 里，相对路径必须真的存在。
if (exists('screenshots.json')) {
  let shots = null;
  try {
    const doc = JSON.parse(read('screenshots.json'));
    shots = Array.isArray(doc) ? doc : Array.isArray(doc?.screenshots) ? doc.screenshots : null;
  } catch (error) {
    fail(`screenshots.json 不是合法 JSON：${error.message}`);
  }
  if (shots === null) fail('screenshots.json 必须是路径数组或 { "screenshots": [...] }');
  else {
    if (!shots.length) fail('screenshots.json 没有声明任何图片');
    if (shots.length > 8) fail(`screenshots.json 声明了 ${shots.length} 张图，市场上限是 8 张`);
    for (const shot of shots) {
      if (typeof shot !== 'string' || !shot.trim()) fail('screenshots.json 的每一项都必须是非空字符串');
      else if (!/^https?:\/\//i.test(shot) && !exists(shot)) fail(`screenshots.json 引用的图片不存在：${shot}`);
    }
  }
}

if (problems.length === 0) {
  const top = read('CHANGELOG.md').match(/^##\s+v?(\d+\.\d+\.\d+\S*)/m);
  if (!top) fail('CHANGELOG.md 顶部缺少 “## v<版本>” 标题');
  else if (top[1] !== pkg.version) fail(`CHANGELOG.md 最新版本 ${top[1]} 与 package.json ${pkg.version} 不一致`);
  const readme = read('README.md').match(/当前版本[为是]?\s*`?v?(\d+\.\d+\.\d+\S*?)`?(?=[，,。\s]|$)/m);
  if (!readme) fail('README.md 缺少“当前版本为 vX.Y.Z”声明');
  else if (readme[1] !== pkg.version) fail(`README.md 声明的版本 ${readme[1]} 与 package.json ${pkg.version} 不一致`);
}

if (problems.length) {
  console.error('兼容自检失败：');
  for (const problem of problems) console.error(' - ' + problem);
  process.exitCode = 1;
} else {
  console.log(`兼容自检通过：${pkg.name}@${pkg.version} · engines.dsh=${dshRange}` + (host ? ` · 宿主 ${host}` : ''));
}
