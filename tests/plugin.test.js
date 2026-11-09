'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const vm = require('node:vm');
const { createOfficeServer } = require('../src/server');
const { DemoWatcher } = require('../src/demo');

test('宿主子路径支持同源嵌入、异步全文和相对静态资源，保留只读边界', async t => {
  const watcher = new DemoWatcher();
  watcher.fullText = async () => ({ text: '完整汇报\n'.repeat(1000) });
  const server = createOfficeServer({
    watcher,
    basePath: '/dsh-mutipleagent',
    defaultDocument: 'demo.html',
    authorize: req => (req.headers.cookie === 'test-owner=1' ? undefined : 401),
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.closeOffice());
  const base = 'http://127.0.0.1:' + server.address().port;
  const get = (url, options = {}) => fetch(base + url, { ...options, headers: { cookie: 'test-owner=1', ...options.headers } });
  assert.equal((await fetch(base + '/dsh-mutipleagent/api/sessions')).status, 401);
  const page = await get('/dsh-mutipleagent/?mode=live&source=harness');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.match(await page.text(), /src="(?:\.\/)?demo.js"/);
  for (const resource of ['demo.js', 'demo.css', 'demo-icons/people-fill.svg', 'assets/kenney/characters/character-male-a.glb']) {
    assert.equal((await get('/dsh-mutipleagent/' + resource)).status, 200, resource);
  }
  assert.equal((await get('/api/sessions')).status, 404);
  assert.equal((await get('/dsh-mutipleagent/src/server.js')).status, 404);
  assert.equal((await get('/dsh-mutipleagent/api/sessions', { method: 'POST' })).status, 405);
  const report = await (await get('/dsh-mutipleagent/api/report?sessionId=demo-main&eventId=report')).json();
  assert.equal(report.text.length, 5000);
});

test('插件路由拒绝未登录和非 owner，卸载后撤销路由及轮询', async t => {
  const plugin = require('../harness.cjs');
  const cleanups = [];
  let route,
    removed = false;
  const query = {
    listSessions: async () => [],
    readSession: async () => {
      throw Error('未找到会话');
    },
    readEvent: async () => {
      throw Error('未找到事件');
    },
  };
  plugin.apply({
    sessionQuery: query,
    connection: {
      admit: req =>
        req.headers.cookie === 'owner=1'
          ? { peer: { principal: { kind: 'owner' } } }
          : req.headers.cookie === 'guest=1'
            ? { peer: { principal: { kind: 'guest' } } }
            : { rejection: 401 },
    },
    webServer: {
      register: value => {
        route = value;
        return () => {
          removed = true;
        };
      },
    },
    effect: callback => {
      cleanups.push(callback());
    },
  });
  const server = http.createServer((req, res) => route.handler(req, res));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    cleanups.reverse().forEach(dispose => dispose());
    server.close();
  });
  const url = 'http://127.0.0.1:' + server.address().port + '/dsh-mutipleagent/api/health';
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { cookie: 'guest=1' } })).status, 403);
  assert.equal((await fetch(url, { headers: { cookie: 'owner=1' } })).status, 200);
  for (const dispose of cleanups.splice(0)) dispose();
  assert.equal(removed, true);
});

test('客户端通过同名原生侧栏与主面板注册，卸载释放注册和样式', () => {
  let module;
  const styles = [];
  const registrations = [];
  const cleanups = [];
  const document = {
    createElement: () => ({
      remove() {
        styles.splice(styles.indexOf(this), 1);
      },
    }),
    head: { appendChild: node => styles.push(node) },
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../client.js'), 'utf8'), {
    window: {
      __ModuleLoader__: {
        load: value => {
          module = value;
        },
      },
    },
    document,
  });
  assert.equal(module.id, 'dsh-mutipleagent');
  const plugin = module.factory(name => {
    assert.equal(name, 'react');
    return { createElement() {} };
  });
  plugin.apply({
    effect: callback => {
      cleanups.push(callback());
    },
    slots: {
      inject: (_name, callback) => callback(),
      register: (options, component) => {
        const value = { options, component };
        registrations.push(value);
        return () => registrations.splice(registrations.indexOf(value), 1);
      },
    },
  });
  assert.equal(registrations.find(row => row.options.name === 'main').options.key, 'dsh-mutipleagent');
  assert.equal(registrations.find(row => row.options.name === 'sidebar.panellist').options.id, 'dsh-mutipleagent');
  cleanups.reverse().forEach(dispose => dispose());
  assert.equal(registrations.length, 0);
  assert.equal(styles.length, 0);
});
