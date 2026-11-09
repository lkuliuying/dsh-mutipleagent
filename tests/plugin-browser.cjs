'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { createOfficeServer } = require('../src/server');
const { DemoWatcher } = require('../src/demo');
const { CodexWatcher } = require('../src/codex');

// 仅使用内存夹具，验证插件挂载后的真实模式界面，不读取用户会话。
class HarnessFixture extends DemoWatcher {
  constructor() {
    super();
    this.agent(this.rootId).cwd = 'F:\\Projects\\Agent';
    this.extraRoots = [];
    this.addRoot('history-main', 'f:/projects/agent/', '接口与回归检查', this.epoch - 86400000);
    this.addRoot('algorithm-main', 'F:\\Projects\\Algorithm', '接口与回归检查', this.epoch - 172800000);
    this.addRoot('another-algorithm', 'G:\\Archive\\Algorithm', '接口与回归检查', this.epoch - 259200000);
    this.addRoot('no-directory-main', '', '', this.epoch - 345600000);
  }
  addRoot(id, cwd, title, createdAt = Date.now() + 60000) {
    const agent = this.agent(id);
    agent.cwd = cwd; agent.task = title; agent.relationship = 'root'; agent.status = 'idle';
    this.extraRoots.unshift({ id, cwd, title, createdAt, at: createdAt, status: 'idle' });
    this.emit('change');
  }
  roots() {
    const current = { ...super.roots()[0], cwd: this.agent(this.rootId).cwd, title: '接口与回归检查', createdAt: this.epoch };
    return [current, ...(this.extraRoots || [])].sort((a, b) => b.createdAt - a.createdAt);
  }
  snapshot(rootId) {
    return { ...CodexWatcher.prototype.snapshot.call(this, rootId), mode: 'live', source: 'harness' };
  }
}

(async () => {
  const mount = '/dsh-mutipleagent/';
  const cookie = 'fixture-owner=1';
  const watcher = new HarnessFixture();
  const fullReport = '接口检查完成。\n' + '逐项核对金额精度、幂等键和库存错误响应。\n'.repeat(120) + '完整报告结束标记';
  watcher.plan[10][2].last_agent_message = fullReport;
  const office = createOfficeServer({ watcher, basePath: mount.slice(0, -1), defaultDocument: 'demo.html',
    authorize: req => req.headers.cookie === cookie ? undefined : 401 });
  // 同源父页面模拟 Harness 主面板；子页面仍经过实际服务的身份与 CSP 检查。
  const server = http.createServer((req, res) => {
    if (req.url.startsWith(mount)) return office.emit('request', req, res);
    if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    if (req.url !== '/') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8',
      'set-cookie': cookie + '; HttpOnly; SameSite=Strict; Path=/' });
    res.end('<!doctype html><html lang="zh-CN"><head><title>Harness 插件验证</title>' +
      '<style>html,body{height:100%;margin:0}iframe{display:block;border:0;width:100%;height:100%}</style></head><body>' +
      '<iframe id="office-frame" name="office-frame" title="DSH 协作办公室" sandbox="allow-scripts allow-same-origin" ' +
      'src="' + mount + '?mode=live&amp;source=harness"></iframe></body></html>');
  });
  const out = path.resolve(__dirname, '../.verification');
  fs.mkdirSync(out, { recursive: true });
  let browser;
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const base = 'http://127.0.0.1:' + server.address().port;
    assert.equal((await fetch(base + mount + 'api/sessions')).status, 401);
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [], failedResponses = [], glbResponses = new Set();
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin !== base) return;
      if (response.status() >= 400) failedResponses.push(url.pathname + ': ' + response.status());
      if (url.pathname.endsWith('.glb') && response.ok()) glbResponses.add(url.pathname);
    });
    await page.goto(base);
    let frame = await (await page.waitForSelector('#office-frame')).contentFrame();
    await frame.waitForFunction(() => document.body.dataset.demoReady === 'true');
    await frame.waitForFunction(() => document.getElementById('mode-label').textContent === '真实会话');
    assert.match(await frame.title(), /DSH Office/);
    assert.equal((await frame.locator('.brand').innerText()).replace(/\s/g, ''), 'DSHOffice');
    assert.equal(await frame.locator('#metric-assigned').innerText(), '2');
    assert.equal(await frame.locator('.scene-pin').count(), 3);
    assert.equal(await frame.locator('#workspace-directory').isVisible(), true);
    const directories = await frame.locator('#workspace-directory option').evaluateAll(options => options.map(option => ({ value: option.value, text: option.textContent })));
    assert.equal(directories.length, 4, '同一 Windows 目录的大小写和分隔符变化应合并');
    const agentDirectory = directories.find(option => /F:\\Projects\\Agent/i.test(option.text));
    const algorithmDirectory = directories.find(option => option.text.includes('F:\\Projects\\Algorithm'));
    const archivedDirectory = directories.find(option => option.text.includes('G:\\Archive\\Algorithm'));
    assert.ok(agentDirectory && algorithmDirectory && archivedDirectory, '同名目录应展示完整路径以区分');
    assert.ok(directories.some(option => option.text.includes('未记录')));
    assert.equal(await frame.locator('#workspace-directory').inputValue(), agentDirectory.value);
    const sessions = await frame.locator('#scenario option').evaluateAll(options => options.map(option => ({ value: option.value, text: option.textContent })));
    assert.deepEqual(new Set(sessions.map(option => option.value)), new Set(['demo-main', 'history-main']));
    assert.equal(new Set(sessions.map(option => option.text)).size, 2, '同名会话应显示不同的时间与短 ID');
    for (const option of sessions) {
      assert.ok(option.text.includes('接口与回归检查'));
      assert.ok(option.text.includes(option.value.slice(-8)));
      assert.match(option.text, /\d{4}/, '会话选项应包含日期');
    }
    assert.equal(await frame.locator('.office-gl').count(), 1);
    assert.ok(await frame.evaluate(() => {
      const gl = document.querySelector('.office-gl').getContext('webgl2');
      return gl && !gl.isContextLost() && gl.getParameter(gl.VERSION);
    }));
    assert.ok(glbResponses.size > 2, '三维场景应实际读取本地 GLB 模型');
    assert.ok([...glbResponses].every(url => url.startsWith(mount)), '模型请求应保留插件挂载路径');
    assert.equal((await context.cookies(base)).find(value => value.name === 'fixture-owner').httpOnly, true);
    assert.equal(await frame.evaluate(() => document.cookie), '');

    await frame.locator('#task-search').fill('林');
    await frame.locator('#search-results').waitFor({ state: 'visible' });
    assert.equal(await frame.locator('.search-result').count(), 1);
    await frame.locator('.search-result').click();
    assert.equal(await frame.locator('#detail-name').innerText(), '林 · 接口分析');
    while (watcher.step < 12) watcher.advance();
    await frame.waitForFunction(() => document.getElementById('metric-reports').textContent === '2');
    assert.equal(await frame.locator('#metric-progress').innerText(), '—', '子任务完成不能推断主任务完成');
    await frame.locator('#view-report').click();
    await frame.waitForFunction(() => document.getElementById('dialog-content').textContent.endsWith('完整报告结束标记'));
    assert.equal(await frame.locator('#dialog-content').innerText(), fullReport);
    await frame.locator('#close-demo-dialog').click();
    await frame.locator('#clear-search').click();
    await frame.waitForFunction(() => {
      const fill = document.getElementById('detail-progress-fill');
      return Math.abs(fill.getBoundingClientRect().width - fill.parentElement.getBoundingClientRect().width) < 1;
    });
    await page.screenshot({ path: path.join(out, 'directory-sessions-desktop.png'), fullPage: true });

    await frame.locator('#scenario').selectOption('history-main');
    await frame.waitForFunction(() => document.getElementById('detail-code').textContent.endsWith('ory-main'));
    await frame.locator('#workspace-directory').selectOption(algorithmDirectory.value);
    await frame.waitForFunction(() => document.getElementById('scenario').value === 'algorithm-main');
    assert.deepEqual(await frame.locator('#scenario option').evaluateAll(options => options.map(option => option.value)), ['algorithm-main']);
    await frame.locator('#team-picker').click();
    assert.equal(await frame.locator('#dialog-content .session-choice').count(), 2, '团队弹窗仅列出本目录的成员和会话');
    assert.equal(await frame.locator('#dialog-content select').inputValue(), algorithmDirectory.value);
    await frame.locator('#close-demo-dialog').click();
    const explicitSessionUrl = frame.url();
    assert.equal(new URL(explicitSessionUrl).searchParams.get('rootId'), 'algorithm-main');
    await frame.evaluate(() => localStorage.setItem('office.harness.live.directory', 'g:/archive/algorithm'));
    await frame.goto(explicitSessionUrl);
    await frame.waitForFunction(() => document.body.dataset.demoReady === 'true' && document.getElementById('scenario').value === 'algorithm-main');
    assert.equal(await frame.locator('#workspace-directory').inputValue(), algorithmDirectory.value, '显式 rootId 地址优先于旧的目录记忆');
    await frame.locator('#workspace-directory').selectOption(agentDirectory.value);
    await frame.waitForFunction(() => document.getElementById('scenario').value === 'demo-main');
    if ((await frame.locator('#play-label').innerText()).includes('固定')) await frame.locator('#toggle-play').click();
    const oldArchivedLabel = await frame.locator('#workspace-directory option').evaluateAll((options, key) => options.find(option => option.value === key).textContent, archivedDirectory.value);
    watcher.addRoot('new-other-directory', 'G:\\Archive\\Algorithm', '其他目录的新会话');
    await frame.waitForFunction(([key, previous]) => [...document.getElementById('workspace-directory').options].find(option => option.value === key)?.textContent !== previous,
      [archivedDirectory.value, oldArchivedLabel]);
    assert.equal(await frame.locator('#scenario').inputValue(), 'demo-main', '跟随不能被其他目录的新会话抢走');
    assert.equal(await frame.locator('#workspace-directory').inputValue(), agentDirectory.value);
    watcher.addRoot('new-same-directory', 'F:\\Projects\\Agent', '本目录的新会话');
    await frame.waitForFunction(() => document.getElementById('scenario').value === 'new-same-directory');
    assert.equal(await frame.locator('#workspace-directory').inputValue(), agentDirectory.value);

    await Promise.all([frame.waitForURL(url => url.searchParams.get('mode') !== 'live'), frame.locator('#mode-toggle').click()]);
    await frame.waitForFunction(() => document.body.dataset.demoReady === 'true');
    assert.equal(new URL(frame.url()).searchParams.get('source'), 'harness');
    assert.equal(await frame.locator('#mode-label').innerText(), '演示数据');
    assert.match(await frame.title(), /DSH Office/);
    await Promise.all([frame.waitForURL(url => url.searchParams.get('mode') === 'live'), frame.locator('#mode-toggle').click()]);
    await frame.waitForFunction(() => document.body.dataset.demoReady === 'true');
    await frame.waitForFunction(() => document.getElementById('mode-label').textContent === '真实会话');
    assert.equal(new URL(frame.url()).searchParams.get('source'), 'harness');
    assert.equal(new URL(frame.url()).pathname, mount + 'demo.html');

    await page.setViewportSize({ width: 900, height: 720 });
    await page.reload();
    frame = await (await page.waitForSelector('#office-frame')).contentFrame();
    await frame.waitForFunction(() => document.body.dataset.demoReady === 'true');
    await frame.waitForFunction(() => document.getElementById('mode-label').textContent === '真实会话');
    assert.equal(await frame.locator('#agent-details').isHidden(), true);
    assert.equal(await frame.locator('#open-details').isVisible(), true);
    assert.equal(await frame.locator('#team-picker').isVisible(), true);
    assert.equal(await frame.locator('#workspace-directory').isVisible(), true);
    assert.equal(await frame.locator('#scenario').isVisible(), true);
    assert.ok(await frame.evaluate(() => {
      const within = selector => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
      };
      return document.documentElement.scrollWidth <= innerWidth && within('.nav') && within('.stats') && within('#workflow-dock') && within('.scene-tools') && within('#workspace-directory') && within('#scenario');
    }), '紧凑窗口的主要控件应位于视口内');
    await frame.locator('#open-details').click();
    assert.equal(await frame.locator('#agent-details').isVisible(), true);
    await frame.locator('#close-details').click();
    await page.screenshot({ path: path.join(out, 'directory-sessions-compact.png'), fullPage: true });
    assert.deepEqual(errors, []);
    assert.deepEqual(failedResponses, []);
    const result = { ok: true, browser: 'Google Chrome', data: 'isolated in-memory fixture', webgl: true,
      checks: ['同源 sandbox iframe', 'HttpOnly 身份校验及未登录 401', 'DSH 品牌', '真实模式团队与 SSE 更新',
        '子路径 GLB 模型', '搜索选择成员', '完整汇报全文', '工作目录与会话两级选择', '同名目录完整路径与同名会话时间/ID',
        '团队弹窗目录筛选', '地址 rootId 优先于目录记忆', '只跟随本目录的新会话', '模拟与真实切换保留来源', '1500x1000 与 900x720 布局'],
      pageErrors: errors, failedResponses, modelCalls: 0, profileWrites: 0 };
    fs.writeFileSync(path.join(out, 'directory-sessions-browser-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (browser) await browser.close();
    office.closeOffice();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
