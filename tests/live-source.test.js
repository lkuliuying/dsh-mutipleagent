const { test } = require('node:test');
const assert = require('node:assert/strict');

function environment() {
  const previous = {};
  const storage = new Map();
  const streams = [];
  const response = raw => ({ ok: true, status: 200, json: async () => raw });
  const raw = { rootId: 'root', roots: [{ id: 'root' }], agents: [{ id: 'root', status: 'tool' }], events: [], warnings: [] };
  const values = {
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    location: { href: 'http://127.0.0.1/demo.html?mode=live', search: '?mode=live' },
    history: { replaceState() {} },
    fetch: async () => response(raw),
    EventSource: class {
      constructor(url) {
        this.url = url;
        streams.push(this);
      }
      close() {
        this.closed = true;
      }
    },
  };
  for (const [key, value] of Object.entries(values)) {
    previous[key] = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return {
    raw,
    streams,
    response,
    storage,
    restore() {
      for (const key of Object.keys(values)) {
        if (previous[key]) Object.defineProperty(globalThis, key, previous[key]);
        else delete globalThis[key];
      }
    },
  };
}

test('首次加载、重连和日志补齐建立基线，后续真实事件可以播放', async () => {
  const env = environment();
  try {
    const { LiveSource } = await import('../web/live-source.mjs');
    const source = new LiveSource('root'),
      changes = [];
    source.addEventListener('change', event => changes.push(event.detail.baseline));
    await source.connect();
    const stream = env.streams[0];
    stream.onopen();
    stream.onmessage({ data: JSON.stringify(env.raw) });
    assert.equal(changes.at(-1), true);
    stream.onmessage({ data: JSON.stringify({ ...env.raw, events: [{ id: 'new-event' }] }) });
    assert.equal(changes.at(-1), false);
    stream.onerror();
    assert.equal(source.snapshot.events[0].id, 'new-event');
    stream.onopen();
    stream.onmessage({ data: JSON.stringify(env.raw) });
    assert.equal(changes.at(-1), true);
    source.accept({ ...env.raw, agents: [{ id: 'root', loading: true }] });
    source.accept(env.raw);
    assert.equal(changes.at(-1), true);
    source.accept(env.raw);
    assert.equal(changes.at(-1), false);
    assert.throws(() => source.accept({ mode: 'demo' }), /模拟数据/);
    source.destroy();
    assert.equal(stream.closed, true);
  } finally {
    env.restore();
  }
});

test('切换期间旧请求和旧事件不能覆盖新会话', async () => {
  const env = environment();
  try {
    const { LiveSource } = await import('../web/live-source.mjs');
    let finishOld;
    globalThis.fetch = url =>
      url.includes('old')
        ? new Promise(resolve => {
            finishOld = resolve;
          })
        : Promise.resolve(env.response({ ...env.raw, rootId: 'new', agents: [{ id: 'new' }] }));
    const source = new LiveSource('old'),
      pending = source.connect();
    await source.select('new');
    finishOld(env.response({ ...env.raw, rootId: 'old' }));
    await pending;
    assert.equal(source.rootId, 'new');
    assert.equal(source.snapshot.rootId, 'new');
    assert.equal(env.streams.length, 1);
    assert.ok(env.streams[0].url.includes('new'));
    assert.equal(source.follow, false);
    source.destroy();
  } finally {
    env.restore();
  }
});

test('跟随模式仅对新发现主会话切换，固定模式保留当前团队', async () => {
  const env = environment();
  try {
    const { LiveSource } = await import('../web/live-source.mjs');
    const source = new LiveSource();
    source.accept(env.raw);
    const selections = [];
    source.select = (id, follow) => selections.push([id, follow]);
    source.accept({ ...env.raw, roots: [{ id: 'root2' }, { id: 'root' }] });
    assert.deepEqual(selections, [['root2', true]]);
    source.follow = false;
    source.accept({ ...env.raw, roots: [{ id: 'root3' }, { id: 'root2' }, { id: 'root' }] });
    assert.equal(selections.length, 1);
    assert.equal(source.snapshot.rootId, 'root');
    source.destroy();
  } finally {
    env.restore();
  }
});

test('全文按会话与事件缓存，失败保留明确错误', async () => {
  const env = environment();
  try {
    const { LiveSource } = await import('../web/live-source.mjs');
    const source = new LiveSource('root');
    let requests = 0;
    const text = '真实中文汇报'.repeat(2000);
    globalThis.fetch = async () => {
      requests++;
      return env.response({ text });
    };
    assert.equal(await source.record('child', 'report'), text);
    assert.equal(await source.record('child', 'report'), text);
    assert.equal(requests, 1);
    globalThis.fetch = async () => ({ ok: false, json: async () => ({ error: '原始记录不可读' }) });
    await assert.rejects(source.record('child', 'other'), /原始记录不可读/);
    source.destroy();
  } finally {
    env.restore();
  }
});

test('初始请求发现新根自动切换时，不再创建过期事件流', async () => {
  const env = environment();
  try {
    const { LiveSource } = await import('../web/live-source.mjs');
    const source = new LiveSource();
    source.accept(env.raw);
    const pending = [],
      originalSelect = source.select.bind(source);
    source.select = (...args) => {
      const promise = originalSelect(...args);
      pending.push(promise);
      return promise;
    };
    globalThis.fetch = async url => env.response({ ...env.raw, rootId: url.includes('root2') ? 'root2' : 'root', roots: [{ id: 'root2' }, { id: 'root' }] });
    await source.connect('root');
    await Promise.all(pending);
    assert.equal(source.rootId, 'root2');
    assert.equal(env.streams.length, 1);
    assert.ok(env.streams[0].url.includes('root2'));
    source.destroy();
  } finally {
    env.restore();
  }
});

test('Harness 子路径下接口与事件流保持挂载前缀，会话选择与 Codex 存储隔离', async () => {
  const env = environment();
  try {
    location.href = 'dsh-app://app/dsh-mutipleagent/demo.html?mode=live&source=harness';
    location.search = '?mode=live&source=harness';
    env.storage.set('office.live.root', 'codex-root');
    env.storage.set('office.harness.live.root', 'harness-root');
    const requests = [];
    globalThis.fetch = async url => {
      requests.push(url);
      return env.response(
        url.includes('api/report')
          ? { text: 'Harness 汇报全文' }
          : {
              ...env.raw,
              source: 'harness',
              rootId: 'harness-root',
              roots: [{ id: 'harness-root' }],
            },
      );
    };
    const { LiveSource } = await import('../web/live-source.mjs');
    const { officePage, officeUrl } = await import('../web/base-url.mjs');
    const source = new LiveSource();
    assert.equal(source.rootId, 'harness-root');
    await source.connect();
    assert.equal(requests[0], 'dsh-app://app/dsh-mutipleagent/api/sessions?rootId=harness-root');
    assert.equal(env.streams[0].url, 'dsh-app://app/dsh-mutipleagent/events?rootId=harness-root');
    assert.equal(await source.record('child', 'report'), 'Harness 汇报全文');
    assert.equal(requests[1], 'dsh-app://app/dsh-mutipleagent/api/report?sessionId=child&eventId=report');
    assert.equal(officeUrl('assets/agents/dsh.svg'), 'dsh-app://app/dsh-mutipleagent/assets/agents/dsh.svg');
    assert.equal(officePage(), 'dsh-app://app/dsh-mutipleagent/demo.html?source=harness');
    assert.equal(officePage(true), 'dsh-app://app/dsh-mutipleagent/demo.html?mode=live&source=harness');
    assert.equal(source.snapshot.source, 'harness');
    assert.equal(env.storage.get('office.live.root'), 'codex-root');
    assert.equal(env.storage.get('office.harness.live.root'), 'harness-root');
    source.destroy();
    location.href = 'http://127.0.0.1/demo.html?mode=live';
    location.search = '?mode=live';
    const codex = new LiveSource();
    assert.equal(codex.rootId, 'codex-root');
    assert.equal(officePage(true), 'http://127.0.0.1/demo.html?mode=live');
    codex.destroy();
  } finally {
    env.restore();
  }
});

function harnessData(env) {
  location.href = 'http://127.0.0.1/dsh-mutipleagent/demo.html?mode=live&source=harness';
  location.search = '?mode=live&source=harness';
  return {
    ...env.raw,
    source: 'harness',
    rootId: 'root-a',
    roots: [
      { id: 'root-a', cwd: 'F:/Projects/Agent', title: '同名会话', createdAt: 2000 },
      { id: 'root-b', cwd: 'D:/Projects/Agent', title: '同名会话', createdAt: 1000 },
    ],
    agents: [{ id: 'root-a' }],
  };
}

test('Harness 明确会话优先于目录记忆，失效目录回到当前会话目录', async () => {
  const env = environment();
  try {
    const data = harnessData(env),
      { LiveSource } = await import('../web/live-source.mjs');
    env.storage.set('office.harness.live.directory', 'd:/projects/agent');
    const explicit = new LiveSource('root-a');
    explicit.accept(data);
    assert.equal(explicit.directoryKey, 'f:/projects/agent');
    assert.equal(env.storage.get('office.harness.live.directory'), 'f:/projects/agent');
    explicit.destroy();
    env.storage.set('office.harness.live.directory', 'missing-directory');
    const restored = new LiveSource();
    restored.accept(data);
    assert.equal(restored.rootId, 'root-a');
    assert.equal(restored.directoryKey, 'f:/projects/agent');
    restored.destroy();
  } finally {
    env.restore();
  }
});

test('Harness 保存会话失效时恢复该目录内会话，不创建其他目录的过期流', async () => {
  const env = environment();
  try {
    const data = harnessData(env),
      { LiveSource } = await import('../web/live-source.mjs');
    env.storage.set('office.harness.live.root', 'deleted-root');
    env.storage.set('office.harness.live.directory', 'd:/projects/agent');
    globalThis.fetch = async url =>
      url.includes('deleted-root')
        ? { ok: false, status: 404, json: async () => ({ error: '会话已删除' }) }
        : env.response({ ...data, rootId: url.includes('root-b') ? 'root-b' : 'root-a' });
    const source = new LiveSource(),
      pending = [],
      original = source.select.bind(source);
    source.select = (...args) => {
      const result = original(...args);
      pending.push(result);
      return result;
    };
    await source.connect();
    await Promise.all(pending);
    assert.equal(source.rootId, 'root-b');
    assert.equal(source.directoryKey, 'd:/projects/agent');
    assert.equal(env.streams.length, 1);
    assert.match(env.streams[0].url, /root-b/);
    source.destroy();
  } finally {
    env.restore();
  }
});

test('Harness 只跟随所选目录的新会话，跨目录会话选择被拒绝', async () => {
  const env = environment();
  try {
    const data = harnessData(env),
      { LiveSource } = await import('../web/live-source.mjs');
    const source = new LiveSource();
    source.accept(data);
    assert.equal(await source.select('root-b'), false);
    assert.equal(source.rootId, 'root-a');
    const selections = [];
    source.select = (id, follow) => selections.push([id, follow]);
    const other = { id: 'new-b', cwd: 'D:/Projects/Agent' };
    source.accept({ ...data, roots: [other, ...data.roots] });
    assert.deepEqual(selections, []);
    source.accept({ ...data, roots: [other, { id: 'new-a', cwd: 'f:\\projects\\agent\\' }, ...data.roots] });
    assert.deepEqual(selections, [['new-a', true]]);
    source.destroy();
  } finally {
    env.restore();
  }
});

test('Harness 快速切换目录后旧响应不能覆盖当前目录和会话', async () => {
  const env = environment();
  try {
    const data = harnessData(env),
      { LiveSource } = await import('../web/live-source.mjs');
    const source = new LiveSource();
    source.accept(data);
    let finishOld;
    globalThis.fetch = url =>
      url.includes('root-b')
        ? new Promise(resolve => {
            finishOld = resolve;
          })
        : Promise.resolve(env.response(data));
    const pending = source.selectDirectory('d:/projects/agent');
    await source.selectDirectory('f:/projects/agent');
    finishOld(env.response({ ...data, rootId: 'root-b' }));
    await pending;
    assert.equal(source.rootId, 'root-a');
    assert.equal(source.directoryKey, 'f:/projects/agent');
    assert.equal(env.storage.get('office.harness.live.directory'), 'f:/projects/agent');
    assert.equal(env.streams.length, 1);
    assert.match(env.streams[0].url, /root-a/);
    source.destroy();
  } finally {
    env.restore();
  }
});
