'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createOfficeServer } = require('../src/server');
const { DemoWatcher } = require('../src/demo');
const { fixture, IDS } = require('./helpers.cjs');

async function running(t, watcher) {
  const server = createOfficeServer({ watcher });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.closeOffice());
  return 'http://127.0.0.1:' + server.address().port;
}

test('快照与报告接口仅接受会话和事件 ID，不暴露内部文件引用', async t => {
  const f = fixture(t);
  f.create(IDS.main);
  const full = '汇报正文\n'.repeat(1000);
  f.write(IDS.main, 'event_msg', { type: 'task_complete', last_agent_message: full });
  f.tick();
  const base = await running(t, f.watcher);
  const snapshot = await (await fetch(base + '/api/sessions')).json();
  assert.equal(snapshot.agents.length, 1);
  assert.equal(JSON.stringify(snapshot).includes(f.home.replaceAll('\\', '\\\\')), false);
  const eventId = snapshot.agents[0].reportEventId;
  const report = await (await fetch(base + '/api/report?' + new URLSearchParams({ sessionId: IDS.main, eventId }))).json();
  assert.equal(report.text, full);
  assert.equal((await fetch(base + '/api/report?sessionId=invalid&eventId=' + eventId)).status, 404);
  assert.equal((await fetch(base + '/api/report?path=C:/Windows/win.ini')).status, 404);
  assert.equal((await fetch(base + '/api/update', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/api/sessions', { headers: { Origin: 'https://example.com' } })).status, 403);
});

test('拒绝非本机 Host；服务只提供预期静态资源', async t => {
  const base = await running(t, new DemoWatcher());
  const status = await new Promise((resolve, reject) => {
    http
      .get(base + '/api/sessions', { headers: { Host: 'example.com' } }, res => {
        res.resume();
        resolve(res.statusCode);
      })
      .on('error', reject);
  });
  assert.equal(status, 403);
  assert.equal((await fetch(base + '/src/codex.js')).status, 404);
  const html = await fetch(base);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /协作办公室/);
  assert.equal((await fetch(base + '/assets/kenney/characters/character-male-a.glb')).status, 200);
});

test('健康检查在演示模式下也返回版本与轮询指标', async t => {
  const base = await running(t, new DemoWatcher());
  const response = await fetch(base + '/api/health');
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.ok, true);
  assert.equal(health.mode, 'demo');
  assert.match(health.version, /^\d+\.\d+\.\d+/);
  assert.equal(typeof health.uptimeMs, 'number');
  assert.equal(typeof health.members, 'number');
});

test('静态资源带 ETag，可协商 304，并支持 gzip', async t => {
  const base = await running(t, new DemoWatcher());
  const first = await fetch(base + '/app.js');
  assert.equal(first.status, 200);
  const etag = first.headers.get('etag');
  assert.match(etag || '', /^W\//);
  assert.match(first.headers.get('cache-control') || '', /must-revalidate/);
  await first.arrayBuffer();
  const cached = await fetch(base + '/app.js', { headers: { 'if-none-match': etag } });
  assert.equal(cached.status, 304);
  const packed = await fetch(base + '/app.js', { headers: { 'accept-encoding': 'gzip' } });
  assert.equal(packed.status, 200);
  assert.equal(packed.headers.get('content-encoding'), 'gzip');
  assert.match(packed.headers.get('vary') || '', /accept-encoding/);
  await packed.arrayBuffer();
});

test('SSE 初次连接与重连均返回可重建的完整团队快照', async t => {
  const watcher = new DemoWatcher();
  const base = await running(t, watcher);
  const read = async () => {
    const controller = new AbortController();
    try {
      const res = await fetch(base + '/events', { signal: controller.signal });
      const reader = res.body.getReader();
      let text = '';
      while (!text.includes('data: ')) text += new TextDecoder().decode((await reader.read()).value);
      const line = text.split('\n').find(x => x.startsWith('data: '));
      return JSON.parse(line.slice(6));
    } finally {
      controller.abort();
    }
  };
  const first = await read();
  watcher.advance();
  const second = await read();
  assert.equal(second.mode, 'demo');
  assert.equal(second.rootId, first.rootId);
  assert.equal(second.agents.length, 3);
  assert.ok(second.events.length >= first.events.length);
});

test('SSE 持续推送新发现的根任务、晚到成员及其真实汇报', async t => {
  const f = fixture(t);
  f.create(IDS.main);
  f.tick();
  f.watcher.select(IDS.main);
  const base = await running(t, f.watcher);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  t.after(() => {
    clearTimeout(timeout);
    controller.abort();
  });
  const res = await fetch(base + '/events?rootId=' + IDS.main, { signal: controller.signal });
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  const next = async predicate => {
    for (;;) {
      const end = pending.indexOf('\n');
      if (end < 0) {
        const { value, done } = await reader.read();
        assert.equal(done, false, '收到目标状态前连接不应关闭');
        pending += decoder.decode(value, { stream: true });
        continue;
      }
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));
        if (predicate(data)) return data;
      }
    }
  };
  assert.equal((await next(() => true)).agents.length, 1);
  f.create(IDS.second);
  f.tick();
  const roots = await next(view => view.roots.some(root => root.id === IDS.second));
  assert.equal(roots.rootId, IDS.main);
  f.create(IDS.child, IDS.main);
  f.tick();
  const members = await next(view => view.agents.some(agent => agent.id === IDS.child));
  assert.equal(members.agents.find(agent => agent.id === IDS.child).status, 'unknown');
  f.write(IDS.child, 'event_msg', { type: 'task_complete', last_agent_message: '真实成员汇报' });
  f.tick();
  const done = await next(view => view.agents.some(agent => agent.id === IDS.child && agent.status === 'done'));
  const child = done.agents.find(agent => agent.id === IDS.child);
  const report = await (await fetch(base + '/api/report?' + new URLSearchParams({ sessionId: child.id, eventId: child.reportEventId }))).json();
  assert.equal(report.text, '真实成员汇报');
});
