'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { HarnessWatcher } = require('../src/harness-watcher');

function fixture(t) {
  const sessions = new Map(), reads = [], eventReads = [], failures = new Set();
  const query = {
    async listSessions() { return [...sessions.values()].map(log => ({ header: log.session, live: true, persisted: true })).reverse(); },
    async readSession(id) { reads.push(id); if (failures.has(id)) throw new Error('private failure details'); return structuredClone(sessions.get(id)); },
    async readEvent(request) {
      eventReads.push(request);
      return { target: structuredClone(sessions.get(request.sessionId)?.events.find(event => event.seq === request.seq)) };
    }
  };
  const watcher = new HarnessWatcher({ query, interval: 10 });
  t.after(() => watcher.stop());
  function create(id, parentId, origin = 'subagent') {
    const log = { session: { id, createdAt: 100, cwd: 'F:/sample', isSeeded: false,
      ...(parentId ? { parentSession: parentId, ...(origin ? { origin } : {}) } : {}) }, inheritedEventCount: 0, events: [] };
    sessions.set(id, log); return log;
  }
  function add(id, type, data, time) {
    const events = sessions.get(id).events;
    const event = { seq: events.length, time: time ?? 1000 + events.length * 100, type, data };
    events.push(event); return event;
  }
  const user = (id, text, source = { kind: 'user' }) => add(id, 'user/message', { role: 'user', content: [{ type: 'text', text }], source });
  const assistant = (id, text) => add(id, 'assistant/message', { turn: 1, step: 1,
    message: { role: 'assistant', source: { kind: 'model', model: 'deepseek-v4' }, content: [{ type: 'text', text }] } });
  const start = id => add(id, 'turn/start', { turn: 1 });
  const end = (id, kind = 'completed') => add(id, 'turn/end', { turn: 1, reason: { kind } });
  return { query, watcher, sessions, reads, eventReads, failures, create, add, user, assistant, start, end };
}

test('仅读取选中团队，普通 fork 独立，真正子 Agent 支持嵌套', async t => {
  const f = fixture(t);
  f.create('other'); f.create('fork', 'root', null); f.create('root'); f.create('child', 'root'); f.create('nested', 'child');
  f.start('root'); f.user('root', '检查接口与测试');
  f.add('root', 'subagent/catalog', { version: 1, mode: 'continuable', childId: 'child', childCreatedAt: 100, label: '接口检查' });
  f.start('child'); f.add('child', 'subagent/descriptor', { version: 3, mode: 'continuable', provider: 'spawn', label: '接口检查', agentModel: 'actual-child-model' });
  f.user('child', '检查接口'); f.start('nested');
  await f.watcher.refresh();
  const data = f.watcher.snapshot();
  assert.equal(data.source, 'harness');
  assert.equal(data.rootId, 'root');
  assert.equal(data.roots.find(root => root.id === 'root').title, '检查接口与测试');
  assert.deepEqual(new Set(data.roots.map(root => root.id)), new Set(['root', 'fork', 'other']));
  assert.deepEqual(new Set(data.agents.map(agent => agent.id)), new Set(['root', 'child', 'nested']));
  assert.deepEqual(new Set(f.reads), new Set(['root', 'child', 'nested']));
  assert.equal(data.agents.find(agent => agent.id === 'nested').parentId, 'child');
  assert.equal(data.agents.find(agent => agent.id === 'child').name, '接口检查');
  assert.equal(data.agents.find(agent => agent.id === 'child').model, 'actual-child-model');
  assert.equal(data.events.find(event => event.type === 'assign').targetId, 'child');
  assert.equal(f.watcher.select('absent'), false);
  assert.equal(f.watcher.select('fork'), true);
  await f.watcher.refresh();
  assert.deepEqual(f.watcher.snapshot().agents.map(agent => agent.id), ['fork']);
});

test('忽略继承历史、系统、私有推理、注入与替换副本，不暴露工具参数和输出', async t => {
  const f = fixture(t); f.create('root'); const child = f.create('child', 'root');
  f.user('child', 'inherited-secret'); f.assistant('child', 'inherited-answer'); child.inheritedEventCount = 2;
  f.start('child');
  f.add('child', 'subagent/descriptor', { version: 3, mode: 'one-shot', provider: 'spawn', label: '真实成员' });
  f.user('child', 'actual-task');
  f.user('child', 'injected-secret', { kind: 'plugin', plugin: 'instructions' });
  f.add('child', 'system/message', { message: { content: [{ type: 'text', text: 'system-secret' }] } });
  f.add('child', 'assistant/chunk', { chunk: { type: 'reasoning', text: 'reasoning-secret' } });
  f.add('child', 'assistant/message', { message: { content: [{ type: 'reasoning', text: 'reasoning-secret' }] } });
  f.add('child', 'tool/call', { callId: 'call', name: 'bash', arguments: '{"api_key":"tool-argument-secret"}' });
  f.add('child', 'tool/result', { message: { role: 'tool', source: { kind: 'tool', callId: 'call' }, content: [{ type: 'text', text: 'tool-output-secret' }] } });
  f.assistant('child', 'visible-answer'); const replacement = f.assistant('child', 'replacement-secret'); replacement.surfaceOp = { replace: [0, 1] };
  f.end('child'); await f.watcher.refresh();
  const data = f.watcher.snapshot(), serialized = JSON.stringify(data);
  for (const secret of ['inherited-secret', 'inherited-answer', 'injected-secret', 'system-secret', 'reasoning-secret', 'tool-argument-secret', 'tool-output-secret', 'replacement-secret']) assert.equal(serialized.includes(secret), false, secret);
  const agent = data.agents.find(agent => agent.id === 'child');
  assert.equal(agent.task, 'actual-task'); assert.equal(agent.status, 'done');
  assert.equal((await f.watcher.fullText('child', agent.reportEventId)).text, 'visible-answer');
  assert.equal(await f.watcher.fullText('child', 'dsh:child:0:task'), null);
});

test('结束状态依据 turn/end，子 Agent 完成不使主任务完成', async t => {
  const f = fixture(t); f.create('root'); f.start('root');
  const expected = { completed: 'done', aborted: 'interrupted', interrupted: 'interrupted', error: 'error', 'max-tokens': 'error', blocked: 'waiting', 'future-reason': 'unknown' };
  for (const kind of Object.keys(expected)) { f.create(kind, 'root'); f.start(kind); f.assistant(kind, kind + ' text'); f.end(kind, kind); }
  await f.watcher.refresh(); const data = f.watcher.snapshot();
  assert.equal(data.agents.find(agent => agent.id === 'root').status, 'thinking');
  for (const [kind, status] of Object.entries(expected)) {
    const agent = data.agents.find(agent => agent.id === kind);
    assert.equal(agent.status, status); assert.equal(Boolean(agent.reportEventId), kind === 'completed');
  }
});

test('fork 继承边界后的合成收尾不成为子 Agent 执行或失败', async t => {
  const f = fixture(t); f.create('root'); const child = f.create('child', 'root');
  f.start('child'); f.user('child', '父任务'); child.inheritedEventCount = 2;
  f.add('child', 'session/end-seed', { inherited: true });
  f.add('child', 'tool/result', { message: { isError: true, source: { callId: 'inherited-call' }, content: [] } });
  f.add('child', 'step/end', { turn: 1, step: 1 }); f.end('child', 'forked');
  await f.watcher.refresh(); let agent = f.watcher.snapshot().agents.find(agent => agent.id === 'child');
  assert.equal(agent.status, 'unknown'); assert.deepEqual(agent.events, []); assert.equal(agent.endedAt, null);
  f.start('child'); f.user('child', '真正的新任务'); await f.watcher.refresh();
  agent = f.watcher.snapshot().agents.find(agent => agent.id === 'child');
  assert.equal(agent.status, 'thinking'); assert.equal(agent.task, '真正的新任务');
});

test('工具失败记录真实事件，其他工具仍执行，本轮可正常结束', async t => {
  const f = fixture(t); f.create('root'); f.start('root');
  f.add('root', 'tool/call', { name: 'read_file', callId: 'one', arguments: '{}' });
  f.add('root', 'tool/call', { name: 'bash', callId: 'two', arguments: '{}' });
  f.add('root', 'tool/result', { message: { source: { kind: 'tool', callId: 'one' }, isError: true, content: [] } });
  await f.watcher.refresh(); let agent = f.watcher.snapshot().agents[0];
  assert.equal(agent.status, 'tool'); assert.equal(agent.activity, 'bash');
  assert.equal(agent.events.filter(event => event.type === 'error').length, 1);
  f.add('root', 'tool/result', { message: { source: { kind: 'tool', callId: 'two' }, content: [] } });
  await f.watcher.refresh(); assert.equal(f.watcher.snapshot().agents[0].status, 'thinking');
  f.assistant('root', '完成汇总'); f.end('root'); await f.watcher.refresh();
  assert.equal(f.watcher.snapshot().agents[0].status, 'done');
});

test('按需读取完整报告，绑定会话和事件，原始内容变化时明确失败', async t => {
  const f = fixture(t); f.create('root'); f.start('root');
  const text = '完整中文汇报\n'.repeat(2000), raw = f.assistant('root', text); f.end('root');
  await f.watcher.refresh(); const data = f.watcher.snapshot(), agent = data.agents[0];
  assert.equal(f.eventReads.length, 0);
  assert.equal((await f.watcher.fullText('root', agent.reportEventId)).text, text);
  assert.deepEqual(f.eventReads[0], { sessionId: 'root', seq: raw.seq, before: 0, after: 0 });
  assert.equal(await f.watcher.fullText('other', agent.reportEventId), null);
  raw.data.message.content[0].text = 'changed';
  await assert.rejects(f.watcher.fullText('root', agent.reportEventId), /原始记录已改变/);
});

test('真实邻接消息与已结束成员汇报可读取，不凭外部消息伪造成员', async t => {
  const f = fixture(t); f.create('root'); f.create('child', 'root'); f.start('child'); f.user('child', '初始任务');
  f.add('child', 'tool/call', { callId: 'send', name: 'send_message', arguments: JSON.stringify({ agent_id: 'root', message: '已验证的结果' }) });
  f.add('child', 'tool/result', { message: { source: { kind: 'tool', callId: 'send' }, content: [] } }); f.end('child');
  f.user('root', 'Agent child sent a message: 已验证的结果', { kind: 'agent-message', senderSessionId: 'child' });
  f.user('root', 'injected-unknown-agent', { kind: 'agent-message', senderSessionId: 'stranger' });
  await f.watcher.refresh(); const data = f.watcher.snapshot(), child = data.agents.find(agent => agent.id === 'child');
  assert.equal((await f.watcher.fullText('child', child.reportEventId)).text, '已验证的结果');
  const received = data.events.find(event => event.type === 'message' && event.targetId === 'root' && event.preview.startsWith('Agent'));
  assert.equal((await f.watcher.fullText('child', received.id)).text, 'Agent child sent a message: 已验证的结果');
  assert.equal(JSON.stringify(data).includes('injected-unknown-agent'), false);
});

test('成员读取失败隔离，列表失败保留快照，恢复后清除提示', async t => {
  const f = fixture(t); f.create('root'); f.create('child', 'root'); f.start('root'); f.start('child');
  f.failures.add('child'); await f.watcher.refresh();
  assert.equal(f.watcher.snapshot().agents.find(agent => agent.id === 'root').status, 'thinking');
  assert.equal(f.watcher.snapshot().agents.find(agent => agent.id === 'child').status, 'unknown');
  assert.match(f.watcher.snapshot().warnings.join(), /成员会话暂时无法读取/);
  assert.equal(JSON.stringify(f.watcher.snapshot()).includes('private failure details'), false);
  f.failures.clear(); await f.watcher.refresh(); assert.deepEqual(f.watcher.snapshot().warnings, []);
  const list = f.query.listSessions; f.query.listSessions = async () => { throw new Error('credential-secret'); };
  await f.watcher.refresh(); assert.equal(f.watcher.snapshot().agents.length, 2);
  assert.match(f.watcher.snapshot().warnings.join(), /会话读取暂时受阻/);
  assert.equal(JSON.stringify(f.watcher.snapshot()).includes('credential-secret'), false);
  f.query.listSessions = list; await f.watcher.refresh(); assert.deepEqual(f.watcher.snapshot().warnings, []);
});

test('失败的消息投递和工具前的旧进展不能作为最终汇报', async t => {
  const f = fixture(t); f.create('root'); f.create('child', 'root'); f.start('child');
  f.assistant('child', '准备检查');
  f.add('child', 'assistant/message', { message: { content: [{ type: 'tool-call', name: 'send_message' }] } });
  f.add('child', 'tool/call', { callId: 'send', name: 'send_message', arguments: JSON.stringify({ agent_id: 'root', message: '未送达的结果' }) });
  f.add('child', 'tool/result', { message: { source: { kind: 'tool', callId: 'send' }, isError: true, content: [] } });
  f.end('child'); await f.watcher.refresh();
  const child = f.watcher.snapshot().agents.find(agent => agent.id === 'child');
  assert.equal(child.status, 'done'); assert.equal(child.reportEventId, null);
  assert.equal(child.events.filter(event => event.type === 'message').length, 0);
});

test('没有返回结果的消息请求不能作为最终汇报', async t => {
  const f = fixture(t); f.create('root'); f.create('child', 'root'); f.start('child');
  f.add('child', 'tool/call', { callId: 'pending-send', name: 'send_message', arguments: JSON.stringify({ agent_id: 'root', message: '尚未确认的结果' }) });
  f.end('child'); await f.watcher.refresh();
  const child = f.watcher.snapshot().agents.find(agent => agent.id === 'child');
  assert.equal(child.status, 'done'); assert.equal(child.reportEventId, null);
  assert.equal(child.events.filter(event => event.type === 'message').length, 0);
});

test('重复刷新不重复事件和 revision，轮次历史报告不会变成本轮报告', async t => {
  const f = fixture(t); f.create('root'); f.start('root'); f.user('root', 'first'); f.assistant('root', 'first report'); f.end('root');
  await f.watcher.refresh(); const before = f.watcher.snapshot();
  await f.watcher.refresh(); const after = f.watcher.snapshot();
  assert.equal(after.revision, before.revision); assert.deepEqual(after.events, before.events);
  assert.equal(new Set(after.events.map(event => event.id)).size, after.events.length);
  f.start('root'); f.user('root', 'second'); await f.watcher.refresh();
  const agent = f.watcher.snapshot().agents[0];
  assert.equal(agent.status, 'thinking'); assert.equal(agent.reportEventId, before.agents[0].reportEventId);
  assert.ok(agent.turnStartedAt > before.agents[0].endedAt);
});

test('stop 释放轮询并阻止进行中读取回写，手动刷新也不会更新', async t => {
  const f = fixture(t); f.create('root'); f.start('root'); await f.watcher.start();
  const before = f.watcher.snapshot();
  let release;
  f.query.readSession = () => new Promise(resolve => { release = resolve; });
  const pending = f.watcher.refresh();
  await new Promise(resolve => setImmediate(resolve));
  f.watcher.stop(); f.assistant('root', 'late answer'); f.end('root'); release(f.sessions.get('root')); await pending;
  await new Promise(resolve => setTimeout(resolve, 30)); await f.watcher.refresh();
  assert.equal(f.watcher.snapshot().revision, before.revision);
  assert.deepEqual(f.watcher.snapshot().events, before.events);
  assert.equal(f.watcher.running, false);
});

test('主任务列表按创建时间倒序，不读取其他主任务正文', async t => {
  const f = fixture(t); for (let index = 0; index < 70; index++) f.create('root-' + index);
  f.sessions.get('root-69').session.createdAt = 1000;
  f.sessions.get('root-0').session.createdAt = 900;
  delete f.sessions.get('root-1').session.createdAt;
  await f.watcher.refresh();
  const roots = f.watcher.snapshot().roots;
  assert.equal(roots.length, 70);
  assert.deepEqual(roots.slice(0, 2).map(root => root.id), ['root-69', 'root-0']);
  assert.equal(roots.at(-1).id, 'root-1');
  assert.deepEqual(f.reads, ['root-69']);
});

test('主任务超过 500 条时只保留最近 500 条并提示总数', async t => {
  const f = fixture(t); for (let index = 0; index < 501; index++) f.create('root-' + index);
  f.sessions.get('root-500').session.createdAt = 1000;
  await f.watcher.refresh();
  const data = f.watcher.snapshot();
  assert.equal(data.roots.length, 500);
  assert.equal(data.roots[0].id, 'root-500');
  assert.ok(data.warnings.some(text => text.includes('500') && text.includes('501')));
  assert.deepEqual(f.reads, ['root-500']);
});

test('两个 SSE 客户端分别观察不同根任务，活跃团队独立刷新，断开后释放读取', async t => {
  const f = fixture(t); f.create('first'); f.create('first-child', 'first'); f.create('second');
  f.start('first'); f.start('first-child'); f.start('second');
  await f.watcher.refresh();
  const releaseFirst = f.watcher.subscribe('first'), releaseSecond = f.watcher.subscribe('second');
  await f.watcher.refresh();
  assert.equal(f.watcher.snapshot('first').agents.some(agent => agent.loading), false);
  assert.deepEqual(f.watcher.snapshot('first').agents.map(agent => agent.id).sort(), ['first', 'first-child']);
  assert.deepEqual(f.watcher.snapshot('second').agents.map(agent => agent.id), ['second']);
  f.assistant('first-child', '第一组结果'); f.end('first-child');
  f.assistant('second', '第二组结果'); f.end('second', 'aborted');
  await f.watcher.refresh();
  const firstChild = f.watcher.snapshot('first').agents.find(agent => agent.id === 'first-child');
  assert.equal(firstChild.status, 'done');
  assert.equal((await f.watcher.fullText('first-child', firstChild.reportEventId)).text, '第一组结果');
  assert.equal(f.watcher.snapshot('second').agents[0].status, 'interrupted');
  f.reads.length = 0; releaseFirst(); releaseFirst(); await f.watcher.refresh();
  assert.deepEqual(new Set(f.reads), new Set(['second']));
  releaseSecond(); f.watcher.stop(); assert.equal(f.watcher.subscriptions.size, 0);
});

test('根会话提供宿主标题与创建时间，不用工作目录名称冒充会话标题', async t => {
  const f = fixture(t), titles = new Map(), batches = [];
  f.create('untitled'); f.create('named'); f.create('root'); f.create('child', 'root');
  f.sessions.get('named').session.cwd = 'F:/projects/shared';
  f.sessions.get('named').session.createdAt = 1700000000000;
  f.sessions.get('root').session.createdAt = 1800000000000;
  f.start('root'); f.user('root', '真实任务摘要');
  f.add('root', 'session/title', { title: '当前会话的宿主标题' });
  titles.set('named', '检查支付接口');
  f.query.readTitleSnapshots = async ids => {
    batches.push(ids);
    return ids.map(id => ({ sessionId: id, status: 'fulfilled', value: {
      session: f.sessions.get(id).session, ...(titles.has(id) ? { title: { title: titles.get(id), eventSeq: 1 } } : {}),
    } }));
  };
  await f.watcher.refresh();
  const roots = f.watcher.snapshot().roots;
  assert.equal(roots.find(root => root.id === 'root').title, '当前会话的宿主标题');
  assert.equal(roots.find(root => root.id === 'named').title, '检查支付接口');
  assert.equal(roots.find(root => root.id === 'named').createdAt, 1700000000000);
  assert.equal(roots.find(root => root.id === 'named').cwd, 'F:/projects/shared');
  assert.equal(roots.find(root => root.id === 'untitled').title, '');
  assert.deepEqual(new Set(batches[0]), new Set(['named', 'untitled']));
  assert.deepEqual(new Set(f.reads), new Set(['root', 'child']));
});

test('当前会话重命名即时更新，未选中会话标题定期刷新且不每秒扫描', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1700000000000 });
  const f = fixture(t), batches = [];
  f.create('other'); f.create('root'); f.start('root');
  f.add('root', 'session/title', { title: '旧名称' });
  let title = '后台旧名称';
  f.query.readTitleSnapshots = async ids => {
    batches.push(ids);
    return ids.map(id => ({ sessionId: id, status: 'fulfilled', value: { session: f.sessions.get(id).session, title: { title } } }));
  };
  await f.watcher.refresh();
  f.add('root', 'session/title', { title: '当前会话新名称' }); title = '后台新名称';
  for (let index = 0; index < 3; index++) { t.mock.timers.tick(1000); await f.watcher.refresh(); }
  assert.equal(batches.length, 1);
  assert.equal(f.watcher.snapshot().roots.find(root => root.id === 'root').title, '当前会话新名称');
  assert.equal(f.watcher.snapshot().roots.find(root => root.id === 'other').title, '后台旧名称');
  t.mock.timers.tick(30000); await f.watcher.refresh();
  assert.equal(batches.length, 2);
  assert.equal(f.watcher.snapshot().roots.find(root => root.id === 'other').title, '后台新名称');
  assert.deepEqual(new Set(f.reads), new Set(['root']));
});

test('标题单项与批量读取失败均隔离，保留已知标题并在下一周期恢复', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1700000000000 });
  const f = fixture(t); f.create('failed'); f.create('named'); f.create('root'); f.start('root');
  let failure = false;
  f.query.readTitleSnapshots = async ids => ids.map(id => id === 'failed' && failure
    ? { sessionId: id, status: 'rejected', reason: new Error('private details') }
    : { sessionId: id, status: 'fulfilled', value: { session: f.sessions.get(id).session, title: { title: '名称 ' + id } } });
  await f.watcher.refresh(); failure = true;
  t.mock.timers.tick(30000); await f.watcher.refresh();
  let data = f.watcher.snapshot();
  assert.equal(data.roots.find(root => root.id === 'failed').title, '名称 failed');
  assert.equal(data.roots.find(root => root.id === 'named').title, '名称 named');
  assert.equal(data.agents[0].status, 'thinking');
  assert.match(data.warnings.join(), /部分会话标题暂时无法读取/);
  assert.equal(JSON.stringify(data).includes('private details'), false);
  const readTitles = f.query.readTitleSnapshots;
  f.query.readTitleSnapshots = async () => { throw new Error('private batch details'); };
  t.mock.timers.tick(30000); await f.watcher.refresh();
  assert.equal(f.watcher.snapshot().roots.find(root => root.id === 'named').title, '名称 named');
  failure = false; f.query.readTitleSnapshots = readTitles;
  t.mock.timers.tick(30000); await f.watcher.refresh(); data = f.watcher.snapshot();
  assert.deepEqual(data.warnings, []);
});

test('停止后进行中的标题读取不再回写根会话列表', async t => {
  const f = fixture(t); f.create('other'); f.create('root'); f.start('root');
  await f.watcher.refresh(); const before = f.watcher.snapshot();
  let release;
  f.query.readTitleSnapshots = () => new Promise(resolve => { release = resolve; });
  const pending = f.watcher.refresh();
  await new Promise(resolve => setImmediate(resolve));
  f.watcher.stop();
  release([{ sessionId: 'other', status: 'fulfilled', value: { session: f.sessions.get('other').session, title: { title: '迟到的名称' } } }]);
  await pending;
  assert.deepEqual(f.watcher.snapshot().roots, before.roots);
  assert.equal(f.watcher.snapshot().revision, before.revision);
});
