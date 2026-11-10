'use strict';
// 发布脚本：改版本号 → 校验 CHANGELOG → 跑闸门 → 提交 + 打 tag。
// 用法：npm run release -- 0.2.0 [--no-push] [--dry-run]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import * as semver from 'semver';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const flags = new Set(args.filter(value => value.startsWith('--')));
const version = args.find(value => !value.startsWith('--'));
const dryRun = flags.has('--dry-run');
const push = !flags.has('--no-push');
const run = (command, commandArgs, options = {}) =>
  execFileSync(command, commandArgs, { cwd: root, stdio: dryRun && !options.always ? 'pipe' : 'inherit', encoding: 'utf8' });

const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
if (!version) {
  console.error('用法：npm run release -- <版本号>（例如 0.2.0）');
  process.exit(1);
}
if (!semver.valid(version)) {
  console.error(`不是合法版本号：${version}`);
  process.exit(1);
}
if (semver.lte(version, pkg.version)) {
  console.error(`新版本 ${version} 必须大于当前版本 ${pkg.version}`);
  process.exit(1);
}

const changelogPath = path.join(root, 'CHANGELOG.md');
const changelog = fs.readFileSync(changelogPath, 'utf8');
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const section = new RegExp(`^## v${escaped}(?=\\s|$)`, 'm');
if (!section.test(changelog)) {
  console.error(`CHANGELOG.md 缺少 “## v${version}” 段落，请先写好本次变更再发布。`);
  process.exit(1);
}

const readmePath = path.join(root, 'README.md');
const englishPath = path.join(root, 'README.en.md');
const previous = pkg.version;
const escapeRe = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// 只把「上一版」的版本号换成新版本：历史版本的标题与安装命令要保持原样。
const rewriteReadme = text =>
  text
    .replace(new RegExp(`(当前版本[为是]?\\s*\`?)v${escapeRe(previous)}(\`?)`), `$1v${version}$2`)
    .replace(new RegExp(`(Current version\\s*\`?)v${escapeRe(previous)}(\`?)`), `$1v${version}$2`)
    .replace(new RegExp(`(##\\s+v)${escapeRe(previous)}(\\s*更新)`), `$1${version}$2`)
    .replace(new RegExp(`(## What's new in v)${escapeRe(previous)}`), `$1${version}`)
    .replace(/refs\/tags\/v\d+\.\d+\.\d+/g, `refs/tags/v${version}`)
    .replace(new RegExp(`${escapeRe(pkg.name)}-\\d+\\.\\d+\\.\\d+\\.tgz`, 'g'), `${pkg.name}-${version}.tgz`);
const readme = fs.readFileSync(readmePath, 'utf8');
const english = fs.existsSync(englishPath) ? fs.readFileSync(englishPath, 'utf8') : '';
const updatedReadme = rewriteReadme(readme);
const updatedEnglish = rewriteReadme(english);
if (!updatedReadme.includes(`v${version}`)) {
  console.error('README.md 里没有可替换的版本号，请先确认“当前版本为 vX”一行存在。');
  process.exit(1);
}

console.log(`发布 ${pkg.name}@${pkg.version} → ${version}`);
if (!dryRun) {
  fs.writeFileSync(pkgPath, JSON.stringify({ ...pkg, version }, null, 2) + '\n');
  fs.writeFileSync(readmePath, updatedReadme);
  if (updatedEnglish) fs.writeFileSync(englishPath, updatedEnglish);
}
for (const [label, command, commandArgs] of [
  ['lint', 'npm', ['run', 'lint']],
  ['格式', 'npm', ['run', 'format:check']],
  ['构建', 'npm', ['run', 'build']],
  ['兼容自检', 'npm', ['run', 'check:compat']],
  ['测试', 'npm', ['test']],
]) {
  process.stdout.write(`- ${label}… `);
  try {
    run(command, commandArgs);
    console.log('ok');
  } catch {
    console.error('失败');
    process.exit(1);
  }
}

const tag = `v${version}`;
if (dryRun) {
  console.log(`dry-run：将提交 “chore(release): ${tag}”，打 tag ${tag}${push ? ' 并推送' : ''}`);
  process.exit(0);
}
run('git', ['add', 'package.json', 'package-lock.json', 'README.md', 'README.en.md', 'CHANGELOG.md', 'public'], { always: true });
run('git', ['commit', '-m', `chore(release): ${tag}`], { always: true });
run('git', ['tag', '-a', tag, '-m', `${pkg.name} ${tag}`], { always: true });
if (push) run('git', ['push', 'origin', 'HEAD', '--follow-tags'], { always: true });
console.log(`完成：${tag}${push ? ' 已推送' : '（未推送）'}。GitHub Release 由 .github/workflows/release.yml 依据 CHANGELOG 生成。`);
