'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const { createOfficeServer } = require('../src/server');
const { DemoWatcher } = require('../src/demo');
const { CodexWatcher } = require('../src/codex');

async function openPicker(frame, id, touch = false, filterable = true) {
  const trigger = frame.locator('#' + id + '-trigger');
  if (touch) await trigger.tap();
  else await trigger.click();
  const panel = frame.locator('#' + id + '-popover');
  await panel.waitFor({ state: 'visible' });
  await panel.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)));
  assert.equal(await frame.locator('#' + id + '-trigger').getAttribute('aria-expanded'), 'true');
  if (filterable) assert.equal(await panel.locator('.select-filter-input').evaluate(input => input === document.activeElement), true);
  else {
    assert.equal(await panel.locator('.select-filter-input').count(), 0, '不可筛选的下拉不应显示搜索框');
    assert.equal(await frame.locator('#' + id + '-trigger').evaluate(button => button === document.activeElement), true);
  }
  return panel;
}

async function choosePicker(frame, id, value, query = '', filterable = true) {
  const panel = await openPicker(frame, id, false, filterable);
  if (query) await panel.locator('.select-filter-input').fill(query);
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  await panel.locator('[role="option"][data-value="' + escaped + '"]').click();
  await panel.waitFor({ state: 'hidden' });
  await frame.waitForFunction(([key, selected]) => document.getElementById(key).value === selected, [id, value]);
}

async function assertPanelWithinViewport(panel) {
  assert.ok(
    await panel.evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return (
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.left >= 0 &&
        bounds.right <= innerWidth + 1 &&
        bounds.top >= 0 &&
        bounds.bottom <= innerHeight + 1 &&
        element.scrollWidth <= element.clientWidth + 1
      );
    }),
    '下拉面板应在视口内，长内容不能造成横向溢出',
  );
}

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
    agent.cwd = cwd;
    agent.task = title;
    agent.relationship = 'root';
    agent.status = 'idle';
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
  const office = createOfficeServer({
    watcher,
    basePath: mount.slice(0, -1),
    defaultDocument: 'demo.html',
    authorize: req => (req.headers.cookie === cookie ? undefined : 401),
  });
  // 同源父页面模拟 Harness 主面板；子页面仍经过实际服务的身份与 CSP 检查。
  const server = http.createServer((req, res) => {
    if (req.url.startsWith(mount)) return office.emit('request', req, res);
    if (req.url === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.url !== '/') {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': cookie + '; HttpOnly; SameSite=Strict; Path=/' });
    res.end(
      '<!doctype html><html lang="zh-CN"><head><title>Harness 插件验证</title>' +
        '<style>html,body{height:100%;margin:0}iframe{display:block;border:0;width:100%;height:100%}</style></head><body>' +
        '<iframe id="office-frame" name="office-frame" title="DSH 协作办公室" sandbox="allow-scripts allow-same-origin" ' +
        'src="' +
        mount +
        '?mode=live&amp;source=harness"></iframe></body></html>',
    );
  });
  const out = path.resolve(__dirname, '../.verification');
  fs.mkdirSync(out, { recursive: true });
  let browser;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const base = 'http://127.0.0.1:' + server.address().port;
    assert.equal((await fetch(base + mount + 'api/sessions')).status, 401);
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, deviceScaleFactor: 1, locale: 'zh-CN' });
    const page = await context.newPage();
    const errors = [],
      failedResponses = [],
      glbResponses = new Set();
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
    await frame.waitForFunction(() => document.getElementById('mode-select')?.value === 'live');
    assert.match(await frame.title(), /DSH Office/);
    assert.equal((await frame.locator('.brand').innerText()).replace(/\s/g, ''), 'DSHOffice');
    assert.equal(await frame.locator('#notification-dot').isHidden(), false, '真实协作事件到达时显示未读红点');
    await frame.locator('#notifications-button').click();
    await frame.locator('#notifications').waitFor({ state: 'visible' });
    assert.equal(await frame.locator('#notification-dot').isHidden(), true, '打开协作动态后红点应立即消除');
    assert.ok(await frame.evaluate(() => !!localStorage.getItem('office.notify.seen.v1.live')), '已读锚点应写入 localStorage');
    await frame.locator('#notifications-button').click();
    await frame.locator('#notifications').waitFor({ state: 'hidden' });
    assert.equal(await frame.locator('#metric-assigned').innerText(), '2');
    assert.equal(await frame.locator('.scene-pin').count(), 3);
    assert.equal(await frame.locator('#workspace-directory-trigger').isVisible(), true);
    let panel = await openPicker(frame, 'workspace-directory');
    const directories = await panel
      .locator('[role="option"]')
      .evaluateAll(options => options.map(option => ({ value: option.dataset.value, text: option.textContent })));
    assert.equal(directories.length, 4, '同一 Windows 目录的大小写和分隔符变化应合并');
    const agentDirectory = directories.find(option => /F:\\Projects\\Agent/i.test(option.text));
    const algorithmDirectory = directories.find(option => option.text.includes('F:\\Projects\\Algorithm'));
    const archivedDirectory = directories.find(option => option.text.includes('G:\\Archive\\Algorithm'));
    assert.ok(agentDirectory && algorithmDirectory && archivedDirectory, '同名目录应展示完整路径以区分');
    assert.ok(directories.some(option => option.text.includes('未记录')));
    assert.ok(
      (await frame.locator('#workspace-directory-trigger').getAttribute('aria-label')).includes('F:\\Projects\\Agent'),
      '目录触发器的可访问名称应包含当前路径',
    );
    assert.equal(await panel.locator('[role="option"][aria-selected="true"]').getAttribute('data-value'), agentDirectory.value);
    await assertPanelWithinViewport(panel);
    await panel.locator('.select-filter-input').fill('没有这个工作目录');
    assert.equal(await panel.locator('[role="option"]').count(), 0);
    assert.match(await panel.innerText(), /没有|无匹配|未找到/);
    await panel.locator('.select-filter-clear').focus();
    await panel.locator('.select-filter-clear').press('Enter');
    assert.equal(await panel.locator('.select-filter-input').inputValue(), '');
    assert.equal(await frame.locator('#workspace-directory').inputValue(), agentDirectory.value, '清除筛选按钮上的 Enter 只能清空筛选，不能选择选项');
    await panel.locator('.select-filter-input').fill('没有这个工作目录');
    await panel.locator('.select-filter-input').press('Escape');
    assert.equal(await frame.locator('#workspace-directory-trigger').evaluate(button => button === document.activeElement), true);
    assert.equal(await frame.locator('#workspace-directory').inputValue(), agentDirectory.value);
    panel = await openPicker(frame, 'scenario');
    const sessions = await panel
      .locator('[role="option"]')
      .evaluateAll(options => options.map(option => ({ value: option.dataset.value, text: option.textContent })));
    assert.deepEqual(new Set(sessions.map(option => option.value)), new Set(['demo-main', 'history-main']));
    assert.equal(new Set(sessions.map(option => option.text)).size, 2, '同名会话应显示不同的时间与短 ID');
    for (const option of sessions) {
      assert.ok(option.text.includes('接口与回归检查'));
      assert.ok(option.text.includes(option.value.slice(-8)));
      assert.match(option.text, /\d{4}/, '会话选项应包含日期');
    }
    assert.ok((await frame.locator('#scenario-trigger').getAttribute('aria-label')).includes('接口与回归检查'), '会话触发器的可访问名称应包含当前标题');
    await panel.locator('.select-filter-input').press('End');
    assert.equal(await panel.locator('[role="option"][data-active="true"]').getAttribute('data-value'), 'history-main');
    await panel.locator('.select-filter-input').press('Home');
    assert.equal(await panel.locator('[role="option"][data-active="true"]').getAttribute('data-value'), 'demo-main');
    await panel.locator('.select-filter-input').press('ArrowDown');
    assert.equal(await panel.locator('[role="option"][data-active="true"]').getAttribute('data-value'), 'history-main');
    await panel.locator('.select-filter-input').press('Escape');
    assert.equal(await frame.locator('#scenario').inputValue(), 'demo-main', '取消下拉不能更改当前会话');
    assert.equal(await frame.locator('.office-gl').count(), 1);
    assert.ok(
      await frame.evaluate(() => {
        const gl = document.querySelector('.office-gl').getContext('webgl2');
        return gl && !gl.isContextLost() && gl.getParameter(gl.VERSION);
      }),
    );
    assert.ok(glbResponses.size > 2, '三维场景应实际读取本地 GLB 模型');
    assert.ok(
      [...glbResponses].every(url => url.startsWith(mount)),
      '模型请求应保留插件挂载路径',
    );
    assert.equal((await context.cookies(base)).find(value => value.name === 'fixture-owner').httpOnly, true);
    assert.equal(await frame.evaluate(() => document.cookie), '');

    const inputWidth = (await frame.locator('#task-search').boundingBox()).width;
    await frame.locator('#task-search').fill('·');
    assert.equal(await frame.locator('.search-result').count(), 3);
    assert.match(await frame.locator('#search-status').innerText(), /3/);
    await frame.locator('#task-search').press('End');
    assert.equal(await frame.locator('.search-result[data-active="true"]').count(), 1);
    assert.match(await frame.locator('.search-result[data-active="true"]').innerText(), /夏 · 测试审阅/);
    const activeResultId = await frame.locator('.search-result[data-active="true"]').getAttribute('id');
    assert.equal(await frame.locator('#task-search').getAttribute('aria-activedescendant'), activeResultId);
    await frame.locator('#task-search').press('Enter');
    assert.equal(
      await frame.locator('#detail-name').innerText(),
      '夏 · 测试审阅',
      JSON.stringify(
        await frame.evaluate(() => ({
          focused: document.activeElement.id,
          active: document.querySelector('.search-result[data-active="true"]')?.textContent,
          expanded: document.getElementById('task-search').getAttribute('aria-expanded'),
        })),
      ),
    );
    assert.equal(await frame.locator('#search-results').isHidden(), true, '选择搜索结果后应收起结果列表');
    await frame.locator('#task-search').fill('林');
    await frame.locator('#task-search').dispatchEvent('compositionstart');
    await frame.locator('#task-search').press('Enter');
    assert.equal(await frame.locator('#detail-name').innerText(), '夏 · 测试审阅', '中文组合输入时 Enter 不能提前选择');
    assert.equal(await frame.locator('#search-results').isVisible(), true);
    await frame.locator('#task-search').dispatchEvent('compositionend', { data: '林' });
    await frame.locator('#search-results').waitFor({ state: 'visible' });
    assert.equal(await frame.locator('.search-result').count(), 1);
    await frame.locator('.search-result').click();
    assert.equal(await frame.locator('#detail-name').innerText(), '林 · 接口分析');
    assert.equal(await frame.locator('#search-results').isHidden(), true);
    while (watcher.step < 12) watcher.advance();
    await frame.waitForFunction(() => document.getElementById('metric-reports').textContent === '2');
    assert.equal(await frame.locator('#metric-progress').innerText(), '—', '子任务完成不能推断主任务完成');
    await frame.locator('#view-report').click();
    await frame.waitForFunction(() => document.getElementById('dialog-content').textContent.endsWith('完整报告结束标记'));
    assert.equal(await frame.locator('#dialog-content').innerText(), fullReport);
    await frame.locator('#close-demo-dialog').click();
    await frame.locator('#task-search').fill('Archive');
    await frame.locator('#search-results').waitFor({ state: 'visible' });
    const archivedResult = frame.locator('.search-result[data-value="session:another-algorithm"]');
    assert.equal(await archivedResult.count(), 1, '顶部搜索应能按工作目录找到其他目录的会话');
    assert.match(await archivedResult.innerText(), /会话 · G:\\Archive\\Algorithm/);
    await archivedResult.click();
    await frame.waitForFunction(() => document.getElementById('scenario').value === 'another-algorithm');
    assert.match(await frame.locator('#workspace-directory-trigger').innerText(), /Archive/);
    assert.equal(await frame.locator('#search-results').isHidden(), true, '打开跨目录会话后应收起搜索结果');
    await page.waitForTimeout(250);
    assert.equal(await frame.locator('#demo-toast').isHidden(), true, '跨目录打开成功时不应出现失败提示');
    assert.equal(await frame.locator('#task-search').inputValue(), '', '打开会话后应清空搜索词');
    assert.match(await frame.locator('#queue-heading').innerText(), /^团队任务/, '打开会话后团队列表不应再按旧关键词过滤');
    await choosePicker(frame, 'workspace-directory', agentDirectory.value);
    await frame.waitForFunction(() => document.getElementById('scenario').value === 'demo-main');
    await frame.locator('#task-search').fill('demo-api');
    await frame.locator('.search-result[data-value="agent:demo-api"]').click();
    await frame.waitForFunction(() => document.getElementById('detail-code').textContent.includes('demo-api'));
    assert.equal(await frame.locator('#task-search').inputValue(), '', '选择 Agent 后应清空搜索词');
    await frame.locator('#task-search').fill('demo');
    await frame.locator('#clear-search').click();
    assert.equal(await frame.locator('#task-search').inputValue(), '');
    assert.equal(await frame.locator('#task-search').evaluate(input => input === document.activeElement), true);
    assert.ok(Math.abs((await frame.locator('#task-search').boundingBox()).width - inputWidth) < 1, '清空按钮出现时输入区不能跳动');
    await frame.locator('#task-search').fill('不存在的任务');
    assert.equal(await frame.locator('.search-result').count(), 0);
    await frame.locator('#task-search').press('ArrowDown');
    assert.equal(await frame.locator('#task-search').getAttribute('aria-activedescendant'), null);
    assert.match(await frame.locator('#search-status').innerText(), /0|没有|无匹配/);
    await frame.locator('#task-search').press('Escape');
    assert.equal(await frame.locator('#search-results').isHidden(), true);
    assert.equal(await frame.locator('#task-search').inputValue(), '不存在的任务');
    await frame.locator('#task-search').press('Escape');
    assert.equal(await frame.locator('#task-search').inputValue(), '');
    await frame.locator('#task-search').fill('林');
    await frame.locator('#task-search').press('Escape');
    const originalApiName = watcher.agent('demo-api').name;
    watcher.agent('demo-api').name = originalApiName + ' · 实时更新标记';
    watcher.emit('change');
    await frame.waitForFunction(() => document.getElementById('detail-name').textContent.includes('实时更新标记'));
    assert.equal(await frame.locator('#search-results').isHidden(), true, '实时更新不能重新打开已经收起的搜索面板');
    await frame.locator('#task-search').press('ArrowDown');
    assert.ok((await frame.locator('#search-results').innerText()).includes('实时更新标记'), '方向键重开搜索时应使用最新快照，不能沿用旧结果');
    watcher.agent('demo-api').name = originalApiName;
    watcher.emit('change');
    await frame.waitForFunction(name => document.getElementById('detail-name').textContent === name, originalApiName);
    await frame.locator('#clear-search').click();
    await frame.waitForFunction(() => {
      const fill = document.getElementById('detail-progress-fill');
      return Math.abs(fill.getBoundingClientRect().width - fill.parentElement.getBoundingClientRect().width) < 1;
    });
    await page.screenshot({ path: path.join(out, 'directory-sessions-desktop.png'), fullPage: true });

    panel = await openPicker(frame, 'scenario');
    await panel.locator('.select-filter-input').fill('history-main');
    assert.equal(await panel.locator('[role="option"]').count(), 1, '会话可按完整 ID 搜索');
    await panel.locator('.select-filter-input').dispatchEvent('compositionstart');
    await panel.locator('.select-filter-input').press('Enter');
    assert.equal(await frame.locator('#scenario').inputValue(), 'demo-main', '下拉筛选组合输入期间不能提前切换会话');
    await panel.locator('.select-filter-input').dispatchEvent('compositionend', { data: 'history-main' });
    await panel.locator('.select-filter-input').press('Enter');
    await frame.waitForFunction(() => document.getElementById('detail-code').textContent.endsWith('ory-main'));
    await choosePicker(frame, 'workspace-directory', algorithmDirectory.value, 'F:\\Projects\\Algorithm');
    await frame.waitForFunction(() => document.getElementById('scenario').value === 'algorithm-main');
    assert.deepEqual(await frame.locator('#scenario option').evaluateAll(options => options.map(option => option.value)), ['algorithm-main']);
    await frame.locator('#team-picker').click();
    assert.equal(await frame.locator('#dialog-content .session-choice').count(), 2, '团队弹窗仅列出本目录的成员和会话');
    assert.equal(await frame.locator('#dialog-content select').inputValue(), algorithmDirectory.value);
    panel = await openPicker(frame, 'team-workspace-directory');
    await assertPanelWithinViewport(panel);
    await panel.locator('.select-filter-input').press('Escape');
    assert.equal(await frame.locator('#demo-dialog').evaluate(dialog => dialog.open), true, 'Escape 应先关闭下拉，保留团队弹窗');
    assert.equal(await frame.locator('#team-workspace-directory-trigger').evaluate(button => button === document.activeElement), true);
    await frame.locator('#close-demo-dialog').click();
    const explicitSessionUrl = frame.url();
    assert.equal(new URL(explicitSessionUrl).searchParams.get('rootId'), 'algorithm-main');
    await frame.evaluate(() => localStorage.setItem('office.harness.live.directory', 'g:/archive/algorithm'));
    await frame.goto(explicitSessionUrl);
    await frame.waitForFunction(() => document.body.dataset.demoReady === 'true' && document.getElementById('scenario').value === 'algorithm-main');
    assert.equal(await frame.locator('#workspace-directory').inputValue(), algorithmDirectory.value, '显式 rootId 地址优先于旧的目录记忆');
    await choosePicker(frame, 'workspace-directory', '', '未记录');
    await frame.waitForFunction(() => document.getElementById('scenario').value === 'no-directory-main');
    assert.match(await frame.locator('#workspace-directory-trigger').innerText(), /未记录/);
    await choosePicker(frame, 'workspace-directory', agentDirectory.value, 'Agent');
    await frame.waitForFunction(() => document.getElementById('scenario').value === 'demo-main');
    if ((await frame.locator('#play-label').innerText()).includes('固定')) await frame.locator('#toggle-play').click();
    const oldArchivedLabel = await frame
      .locator('#workspace-directory option')
      .evaluateAll((options, key) => options.find(option => option.value === key).textContent, archivedDirectory.value);
    panel = await openPicker(frame, 'workspace-directory');
    await panel.locator('.select-filter-input').fill('Algorithm');
    await panel.locator('.select-filter-input').press('End');
    const activeDirectory = await panel.locator('[role="option"][data-active="true"]').getAttribute('data-value');
    watcher.addRoot('new-other-directory', 'G:\\Archive\\Algorithm', '其他目录的新会话');
    await frame.waitForFunction(
      ([key, previous]) => [...document.getElementById('workspace-directory').options].find(option => option.value === key)?.textContent !== previous,
      [archivedDirectory.value, oldArchivedLabel],
    );
    assert.equal(await panel.locator('.select-filter-input').inputValue(), 'Algorithm', 'SSE 更新不能清空正在输入的目录筛选');
    assert.equal(await panel.locator('.select-filter-input').evaluate(input => input === document.activeElement), true);
    assert.equal(await panel.locator('[role="option"][data-active="true"]').getAttribute('data-value'), activeDirectory);
    await page.screenshot({ path: path.join(out, 'directory-menu-desktop.png'), fullPage: true });
    await panel.locator('.select-filter-input').press('Escape');
    assert.equal(await frame.locator('#scenario').inputValue(), 'demo-main', '跟随不能被其他目录的新会话抢走');
    assert.equal(await frame.locator('#workspace-directory').inputValue(), agentDirectory.value);

    const longDirectory = 'F:\\Projects\\' + '多层嵌套工作目录\\'.repeat(12) + '完整路径末尾';
    const longTitle = '检查接口兼容与超长会话标题'.repeat(10) + '标题末尾检索标记';
    watcher.addRoot('long-session-id-87654321', longDirectory, longTitle);
    await frame.waitForFunction(() => [...document.getElementById('workspace-directory').options].some(option => option.textContent.includes('完整路径末尾')));
    const longKey = longDirectory.replace(/\\/g, '/').toLowerCase();
    await choosePicker(frame, 'workspace-directory', longKey, '完整路径末尾');
    panel = await openPicker(frame, 'scenario');
    await panel.locator('.select-filter-input').fill('标题末尾检索标记');
    assert.equal(await panel.locator('[role="option"]').count(), 1, '筛选应使用完整标题，不能仅搜索截断后的展示标签');
    assert.ok((await panel.locator('[role="option"]').innerText()).includes('标题末尾检索标记'));
    await assertPanelWithinViewport(panel);
    await page.screenshot({ path: path.join(out, 'session-menu-long-title.png'), fullPage: true });
    await panel.locator('.select-filter-input').press('Tab');
    assert.equal(await panel.isVisible(), false, 'Tab 离开下拉时收起面板');
    await choosePicker(frame, 'workspace-directory', agentDirectory.value, 'Agent');
    watcher.addRoot('new-same-directory', 'F:\\Projects\\Agent', '本目录的新会话');
    await frame.waitForFunction(() => document.getElementById('scenario').value === 'new-same-directory');
    assert.equal(await frame.locator('#workspace-directory').inputValue(), agentDirectory.value);

    const modePanel = await openPicker(frame, 'mode-select', false, false);
    await Promise.all([frame.waitForURL(url => url.searchParams.get('mode') !== 'live'), modePanel.locator('[role="option"][data-value="demo"]').click()]);
    await frame.waitForFunction(() => document.body.dataset.demoReady === 'true');
    assert.equal(new URL(frame.url()).searchParams.get('source'), 'harness');
    assert.equal(await frame.locator('#mode-select-trigger').innerText(), '演示会话');
    assert.match(await frame.title(), /DSH Office/);
    await choosePicker(frame, 'scenario', 'review');
    assert.match(await frame.locator('#scenario-trigger').innerText(), /接口|审阅/);
    await frame.locator('#task-search').fill('不存在的演示任务');
    assert.equal(await frame.locator('.search-result').count(), 0);
    await frame.locator('#task-search').press('Escape');
    await frame.locator('#task-search').press('Escape');
    assert.equal(await frame.locator('#task-search').inputValue(), '');
    const backPanel = await openPicker(frame, 'mode-select', false, false);
    await Promise.all([frame.waitForURL(url => url.searchParams.get('mode') === 'live'), backPanel.locator('[role="option"][data-value="live"]').click()]);
    await frame.waitForFunction(() => document.body.dataset.demoReady === 'true');
    await frame.waitForFunction(() => document.getElementById('mode-select')?.value === 'live');
    assert.equal(new URL(frame.url()).searchParams.get('source'), 'harness');
    assert.equal(new URL(frame.url()).pathname, mount + 'demo.html');

    await page.setViewportSize({ width: 900, height: 720 });
    await page.reload();
    frame = await (await page.waitForSelector('#office-frame')).contentFrame();
    await frame.waitForFunction(() => document.body.dataset.demoReady === 'true');
    await frame.waitForFunction(() => document.getElementById('mode-select')?.value === 'live');
    assert.equal(await frame.locator('#agent-details').isHidden(), true);
    assert.equal(await frame.locator('#open-details').isVisible(), true);
    assert.equal(await frame.locator('#team-picker').isVisible(), true);
    assert.equal(await frame.locator('#workspace-directory-trigger').isVisible(), true);
    assert.equal(await frame.locator('#scenario-trigger').isVisible(), true);
    assert.ok(
      await frame.evaluate(() => {
        const within = selector => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
        };
        return (
          document.documentElement.scrollWidth <= innerWidth &&
          within('.nav') &&
          within('.stats') &&
          within('#workflow-dock') &&
          within('.scene-tools') &&
          within('#workspace-directory-trigger') &&
          within('#scenario-trigger')
        );
      }),
      '紧凑窗口的主要控件应位于视口内',
    );
    await frame.locator('#open-details').click();
    assert.equal(await frame.locator('#agent-details').isVisible(), true);
    await frame.locator('#close-details').click();
    panel = await openPicker(frame, 'workspace-directory');
    await panel.locator('.select-filter-input').fill('完整路径末尾');
    await assertPanelWithinViewport(panel);
    await page.screenshot({ path: path.join(out, 'directory-sessions-compact.png'), fullPage: true });
    await frame.locator('#metric-active').click();
    assert.equal(await panel.isVisible(), false, '点击下拉外部应收起面板');

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    frame = await (await page.waitForSelector('#office-frame')).contentFrame();
    await frame.waitForFunction(() => document.body.dataset.demoReady === 'true');
    assert.equal(await frame.locator('#workspace-directory-trigger').isVisible(), true);
    assert.equal(await frame.locator('#scenario-trigger').isVisible(), true);
    assert.ok(
      await frame.evaluate(() => {
        const within = selector => {
          const rect = document.querySelector(selector).getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
        };
        return within('#workspace-directory-trigger') && within('#scenario-trigger');
      }),
      '窄屏应把目录与会话选择器放在视口内的独立一行',
    );
    const mobileGeometry = await frame.evaluate(() => {
      const picker = document.querySelector('.workspace-switch.harness-picker').getBoundingClientRect();
      const stats = document.querySelector('.stats').getBoundingClientRect();
      return { pickerBottom: picker.bottom, statsTop: stats.top };
    });
    assert.ok(mobileGeometry.pickerBottom <= mobileGeometry.statsTop, '窄屏选择器行不能压住指标卡');
    await frame.locator('#task-search').fill('Archive');
    await frame.locator('#search-results').waitFor({ state: 'visible' });
    assert.ok(
      await frame.evaluate(() => {
        const item = document.querySelector('#search-result-list .search-result');
        const rect = item.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return hit === item || item.contains(hit);
      }),
      '390px 搜索结果应显示在目录选择器之上并可按坐标点击',
    );
    await frame.locator('#clear-search').click();
    assert.equal(await frame.locator('#search-results').isHidden(), true);
    assert.equal(await frame.locator('#team-picker').isVisible(), true);
    await frame.locator('#demo-reduced').check();
    await frame.locator('#team-picker').click();
    panel = await openPicker(frame, 'team-workspace-directory');
    await panel.locator('.select-filter-input').fill('完整路径末尾');
    await assertPanelWithinViewport(panel);
    assert.ok(
      await panel.evaluate(element => {
        const style = getComputedStyle(element);
        return [style.animationDuration, style.transitionDuration].every(value => value.split(',').every(part => parseFloat(part) < 0.02));
      }),
      '减少动画设置应去掉下拉展开的位移动画',
    );
    await page.screenshot({ path: path.join(out, 'directory-sessions-mobile.png'), fullPage: true });
    await panel.locator('[role="option"]').click();
    await frame.waitForFunction(() => document.getElementById('scenario').value === 'long-session-id-87654321');
    assert.equal(await frame.locator('#demo-dialog').evaluate(dialog => dialog.open), true);
    assert.ok((await frame.locator('#team-workspace-directory-trigger').innerText()).includes('完整路径末尾'));
    await choosePicker(frame, 'team-workspace-directory', agentDirectory.value, 'Agent');
    await frame.waitForFunction(() => document.getElementById('scenario').value === 'new-same-directory');
    panel = await openPicker(frame, 'team-workspace-directory');
    await panel.locator('.select-filter-input').press('Escape');
    assert.equal(await frame.locator('#demo-dialog').evaluate(dialog => dialog.open), true, '弹窗切换目录后重建的下拉仍可再次使用');
    await frame.locator('#close-demo-dialog').click();
    assert.ok(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '手机窗口不能出现横向页面滚动');

    const touchContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, locale: 'zh-CN' });
    const touchPage = await touchContext.newPage();
    touchPage.on('pageerror', error => errors.push(error.message));
    await touchContext.addCookies([{ name: 'fixture-owner', value: '1', url: base, httpOnly: true, sameSite: 'Strict' }]);
    await touchPage.goto(base + mount + 'demo.html?mode=live&source=harness');
    await touchPage.waitForFunction(() => document.body.dataset.demoReady === 'true' && document.getElementById('mode-select')?.value === 'live');
    assert.equal(await touchPage.evaluate(() => navigator.maxTouchPoints > 0 && innerWidth === 390), true);
    await touchPage.locator('#team-picker').tap();
    panel = await openPicker(touchPage, 'team-workspace-directory', true);
    await panel.locator('.select-filter-input').fill('未记录');
    await panel.locator('[role="option"][data-value=""]').tap();
    await touchPage.waitForFunction(() => document.getElementById('scenario').value === 'no-directory-main');
    assert.match(await touchPage.locator('#team-workspace-directory-trigger').innerText(), /未记录/);
    panel = await openPicker(touchPage, 'team-workspace-directory', true);
    await assertPanelWithinViewport(panel);
    await panel.locator('.select-filter-input').press('Escape');
    await touchContext.close();

    // 空状态通过拦截本地只读接口提供合成快照，不触碰真实会话或生产接口。
    const emptyPage = await context.newPage();
    emptyPage.on('pageerror', error => errors.push(error.message));
    const emptySnapshot = { mode: 'live', source: 'harness', rootId: null, roots: [], agents: [], events: [] };
    await emptyPage.route('**/api/sessions**', route => route.fulfill({ json: emptySnapshot }));
    await emptyPage.route('**/events**', route => route.fulfill({ contentType: 'text/event-stream', body: 'data: ' + JSON.stringify(emptySnapshot) + '\n\n' }));
    const emptyLoaded = emptyPage.waitForResponse(response => new URL(response.url()).pathname.endsWith('/api/sessions'));
    await emptyPage.goto(base + mount + 'demo.html?mode=live&source=harness');
    await emptyLoaded;
    await emptyPage.waitForFunction(
      () => document.getElementById('workspace-directory-trigger')?.disabled && document.getElementById('scenario-trigger')?.disabled,
    );
    assert.equal(await emptyPage.locator('#workspace-directory-trigger').isDisabled(), true);
    assert.equal(await emptyPage.locator('#scenario-trigger').isDisabled(), true);
    assert.match(await emptyPage.locator('#workspace-directory-trigger').innerText(), /尚未发现/);
    assert.match(await emptyPage.locator('#scenario-trigger').innerText(), /尚未发现/);
    await emptyPage.close();
    assert.deepEqual(errors, []);
    assert.deepEqual(failedResponses, []);
    const result = {
      ok: true,
      browser: 'Google Chrome',
      data: 'isolated in-memory fixture',
      webgl: true,
      checks: [
        '同源 sandbox iframe',
        'HttpOnly 身份校验及未登录 401',
        'DSH 品牌',
        '真实模式团队与 SSE 更新',
        '子路径 GLB 模型',
        '搜索选择成员',
        '顶部搜索跨目录打开会话',
        '跨目录打开无失败提示与查询残留',
        '完整汇报全文',
        '工作目录与会话两级选择',
        '同名目录完整路径与同名会话时间/ID',
        '团队弹窗目录筛选与嵌套 Escape',
        '地址 rootId 优先于目录记忆',
        '只跟随本目录的新会话',
        '模拟与真实切换保留来源',
        '搜索键盘导航、输入法组合与清空占位',
        '未知目录有效空键',
        '实时刷新保留查询与高亮',
        '收起搜索后实时更新再用方向键打开使用最新快照',
        '完整长路径与完整标题筛选',
        '下拉空匹配、空快照禁用与减少动画',
        '可访问名称包含当前选择',
        '390px 触屏 tap 打开、选择与重开',
        '390px 搜索结果不被选择器遮挡',
        '1500x1000、900x720 与 390x844 布局及面板边界',
      ],
      pageErrors: errors,
      failedResponses,
      modelCalls: 0,
      profileWrites: 0,
    };
    fs.writeFileSync(path.join(out, 'directory-sessions-browser-result.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (browser) await browser.close();
    office.closeOffice();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
