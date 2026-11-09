const { test } = require('node:test');
const assert = require('node:assert/strict');
const state = import('../web/live-state.mjs');

const ROOT = '11111111-1111-1111-1111-111111111111';
const CHILD = '22222222-2222-2222-2222-222222222222';
const snapshot = (agents, rootId = ROOT) => ({
  rootId,
  roots: [{ id: rootId, title: '真实协作检查', cwd: 'F:\\Program\\Office' }],
  agents,
  events: [],
  warnings: []
});

test('Harness 来源使用宿主名称和图标，Codex 来源仍沿用原展示', async () => {
  const { LiveViewAdapter } = await state;
  const raw = { rootId: ROOT, agents: [{ id: ROOT, status: 'unknown' }], roots: [], events: [] };
  const harness = new LiveViewAdapter().update({ ...raw, source: 'harness' });
  assert.equal(harness.config.title, 'Harness 会话');
  assert.equal(harness.config.project, 'DeepSeek Harness');
  assert.equal(harness.agents[0].agent, 'dsh');
  const codex = new LiveViewAdapter().update(raw);
  assert.equal(codex.config.title, 'Codex 会话');
  assert.equal(codex.config.project, 'Codex');
  assert.equal(codex.agents[0].agent, 'codex');
});

test('保留真实字段和事件，仅增加展示信息', async () => {
  const { LiveViewAdapter } = await state;
  const reports = [{ id: 'report-current', sessionId: CHILD }];
  const events = [{ id: 'event-1', sessionId: ROOT, targetId: CHILD, type: 'assign', at: 2000 }];
  const raw = snapshot([
    { id: ROOT, parentId: null, status: 'waiting_agents', task: '检查搜索与筛选实现', turnStartedAt: 1000 },
    { id: CHILD, parentId: ROOT, status: 'tool', task: '检查真实接口', taskEventId: 'task-1', taskSessionId: ROOT,
      reportEventId: 'report-current', reports, events, activity: '读取源码', model: 'actual-model' }
  ]);
  raw.events = events;
  const view = new LiveViewAdapter().update(raw, 9000);
  const child = view.agents[1];
  assert.equal(view.mode, 'live');
  assert.equal(view.rootId, ROOT);
  assert.equal(view.scenario, ROOT);
  assert.equal(view.config.title, '检查搜索与筛选实现');
  assert.equal(view.config.project, 'Office');
  assert.equal(child.id, CHILD);
  assert.equal(child.parentId, ROOT);
  assert.equal(child.status, 'tool');
  assert.equal(child.taskEventId, 'task-1');
  assert.equal(child.taskSessionId, ROOT);
  assert.equal(child.reportEventId, 'report-current');
  assert.equal(child.reports, reports);
  assert.equal(child.events, events);
  assert.equal(view.events, events);
  assert.equal(child.file, '读取源码');
  assert.equal(child.report, null);
  assert.equal(child.hasReport, true);
  assert.equal(child.currentHasReport, true);
  assert.equal(child.progress, null);
  assert.equal(view.progress, null);
  assert.equal(view.active, 2);
  assert.equal(view.assigned, 1);
  assert.equal(view.received, 1);
  assert.equal(view.seconds, 8);
  assert.equal(view.elapsedKnown, true);
  assert.equal(raw.agents[1].slot, undefined);
});

test('历史汇报不计入本轮，子 Agent 完成不等于主任务完成', async () => {
  const { LiveViewAdapter } = await state;
  const adapter = new LiveViewAdapter();
  const raw = snapshot([
    { id: ROOT, status: 'thinking', task: '复核结果' },
    { id: CHILD, parentId: ROOT, status: 'done', reports: [{ id: 'old-report' }] }
  ]);
  let view = adapter.update(raw);
  assert.equal(view.received, 0);
  assert.equal(view.agents[1].hasReport, false);
  assert.equal(view.agents[1].progress, 100);
  assert.equal(view.complete, false);
  assert.equal(view.progress, null);
  assert.equal(view.stage, 1);
  raw.agents[1].reportEventId = 'this-turn-report';
  view = adapter.update(raw);
  assert.equal(view.received, 1);
  assert.equal(view.stage, 2);
  assert.equal(view.complete, false);
  raw.agents[0].status = 'done';
  view = adapter.update(raw);
  assert.equal(view.complete, true);
  assert.equal(view.progress, 100);
  assert.equal(view.stage, 3);
});

test('保留等待、未知和异常状态，不推算执行进度', async () => {
  const { LiveViewAdapter } = await state;
  const statuses = ['waiting', 'waiting_agents', 'unknown', 'error', 'interrupted', 'closed', 'idle'];
  const view = new LiveViewAdapter().update(snapshot([
    { id: ROOT, status: 'thinking' },
    ...statuses.map((status, index) => ({ id: 'child-' + index, parentId: ROOT, status }))
  ]));
  assert.deepEqual(view.agents.slice(1).map(agent => agent.status), statuses);
  assert.ok(view.agents.every(agent => agent.progress === null));
  assert.equal(view.active, 3);
  assert.equal(view.received, 0);
  assert.equal(view.complete, false);
});

test('工位跨重排保持稳定，支持四人以上及嵌套团队', async () => {
  const { LiveViewAdapter } = await state;
  const adapter = new LiveViewAdapter();
  const root = { id: ROOT, status: 'thinking' };
  const children = Array.from({ length: 6 }, (_, index) => ({
    id: 'child-' + index, parentId: index === 5 ? 'child-1' : ROOT, status: 'tool'
  }));
  const first = adapter.update(snapshot([root, ...children.slice(0, 3)]));
  const slots = new Map(first.agents.map(agent => [agent.id, agent.slot]));
  const second = adapter.update(snapshot([children[2], ...children.slice(3), root, children[0]]));
  for (const agent of second.agents) {
    if (slots.has(agent.id)) assert.equal(agent.slot, slots.get(agent.id));
  }
  const third = adapter.update(snapshot([root, ...children].reverse()));
  assert.equal(third.agents.length, 7);
  assert.equal(third.assigned, 6);
  assert.equal(third.agents.find(agent => agent.id === 'child-1').slot, slots.get('child-1'));
  assert.equal(third.agents.find(agent => agent.id === 'child-5').parentId, 'child-1');
  assert.equal(new Set(third.agents.map(agent => agent.slot)).size, 7);
  assert.equal(third.agents[0].id, ROOT);
  assert.equal(third.agents[0].slot, 0);
});

test('切换主会话后重新分配工位', async () => {
  const { LiveViewAdapter } = await state;
  const adapter = new LiveViewAdapter();
  adapter.update(snapshot([{ id: ROOT, status: 'thinking' }, { id: CHILD, parentId: ROOT, status: 'tool' }]));
  const nextRoot = 'new-root';
  const view = adapter.update(snapshot([
    { id: 'new-child', parentId: nextRoot, status: 'tool' },
    { id: nextRoot, status: 'thinking' }
  ], nextRoot));
  assert.equal(view.agents[0].id, nextRoot);
  assert.equal(view.agents[0].slot, 0);
  assert.equal(view.agents[1].slot, 1);
  assert.equal(view.scenario, nextRoot);
});

test('耗时来自本轮起点，终态停止计时，缺失起点时明确未知', async () => {
  const { LiveViewAdapter } = await state;
  const adapter = new LiveViewAdapter();
  const root = { id: ROOT, status: 'tool', startedAt: 100, turnStartedAt: 5000 };
  assert.equal(adapter.update(snapshot([root]), 10000).seconds, 5);
  root.status = 'interrupted';
  root.endedAt = 12000;
  assert.equal(adapter.update(snapshot([root]), 30000).seconds, 7);
  delete root.turnStartedAt;
  const unknown = adapter.update(snapshot([root]), 30000);
  assert.equal(unknown.seconds, 0);
  assert.equal(unknown.elapsedKnown, false);
});

test('阶段依据真实协作信息推进，空快照不虚构人员', async () => {
  const { LiveViewAdapter } = await state;
  const adapter = new LiveViewAdapter();
  const root = { id: ROOT, status: 'thinking' };
  assert.equal(adapter.update(snapshot([root])).stage, 0);
  const child = { id: CHILD, parentId: ROOT, status: 'tool' };
  assert.equal(adapter.update(snapshot([root, child])).stage, 1);
  child.reportEventId = 'report-1';
  assert.equal(adapter.update(snapshot([root, child])).stage, 2);
  child.status = 'done';
  root.status = 'typing';
  const closing = adapter.update(snapshot([root, child]));
  assert.equal(closing.stage, 3);
  assert.equal(closing.complete, false);
  const empty = adapter.update({});
  assert.deepEqual(empty.agents, []);
  assert.deepEqual(empty.events, []);
  assert.equal(empty.rootId, null);
  assert.equal(empty.complete, false);
  assert.equal(empty.config.project, 'Codex');
  assert.equal(empty.progress, null);
});

test('旧轮次已结束成员保留在团队内，但不参与本轮指标或阶段', async () => {
  const { LiveViewAdapter } = await state;
  const adapter = new LiveViewAdapter();
  const root = { id: ROOT, status: 'thinking', turnStartedAt: 10000 };
  const old = { id: CHILD, parentId: ROOT, status: 'done', lastEventAt: 6000,
    endedAt: 5000, reportEventId: 'old-report' };
  const raw = snapshot([root, old]);
  let view = adapter.update(raw, 15000);
  assert.equal(view.agents.length, 2);
  assert.equal(view.agents[1].source, old);
  assert.equal(view.agents[1].historical, true);
  assert.equal(view.agents[1].hasReport, false);
  assert.equal(view.assigned, 0);
  assert.equal(view.received, 0);
  assert.equal(view.stage, 0);
  raw.events = [{ id: 'follow-up', type: 'message', targetId: CHILD, sessionId: ROOT, at: 11000 }];
  view = adapter.update(raw, 15000);
  assert.equal(view.agents[1].historical, false);
  assert.equal(view.assigned, 1);
  assert.equal(view.received, 0);
  delete root.turnStartedAt;
  raw.events = [];
  view = adapter.update(raw, 15000);
  assert.equal(view.agents[1].historical, false);
});

test('追加任务先到父日志时，不把子 Agent 上一轮报告当作新结果', async () => {
  const { LiveViewAdapter } = await state;
  const adapter = new LiveViewAdapter();
  const root = { id: ROOT, status: 'thinking', turnStartedAt: 10000 };
  const child = { id: CHILD, parentId: ROOT, status: 'done', turnStartedAt: 1000,
    endedAt: 5000, lastEventAt: 6000, reportEventId: 'old-report', reports: ['old-report'] };
  const oldReport = { id: 'old-report', sessionId: CHILD, type: 'report', at: 5000 };
  const followup = { id: 'followup', sessionId: ROOT, targetId: CHILD, type: 'message', at: 11000 };
  const raw = snapshot([root, child]);
  raw.events = [oldReport, followup];
  let view = adapter.update(raw, 12000);
  const member = view.agents[1];
  assert.equal(member.historical, false);
  assert.equal(member.reportEventId, 'old-report');
  assert.equal(member.source, child);
  assert.deepEqual(member.reports, ['old-report']);
  assert.equal(member.hasReport, false);
  assert.equal(member.currentHasReport, false);
  assert.match(member.reportPreview, /等待本轮汇报/);
  assert.equal(view.assigned, 1);
  assert.equal(view.received, 0);
  assert.equal(view.stage, 1);
  child.reportEventId = 'new-report';
  child.endedAt = child.lastEventAt = 15000;
  raw.events.push({ id: 'new-report', sessionId: CHILD, type: 'report', at: 15000 });
  view = adapter.update(raw, 16000);
  assert.equal(view.agents[1].currentHasReport, true);
  assert.equal(view.received, 1);
  assert.equal(view.stage, 2);
});

test('优先报告事件时间，重复追加指令后等待下一次汇报', async () => {
  const { LiveViewAdapter } = await state;
  const raw = snapshot([
    { id: ROOT, status: 'thinking', turnStartedAt: 10000 },
    { id: CHILD, parentId: ROOT, status: 'done', reportEventId: 'current-report', endedAt: 18000, lastEventAt: 20000 }
  ]);
  const report = { id: 'current-report', sessionId: CHILD, type: 'report', at: 14000 };
  raw.agents[1].events = [report];
  raw.events = [{ id: 'next-task', sessionId: ROOT, targetId: CHILD, type: 'assign', at: 16000 }];
  const view = new LiveViewAdapter().update(raw, 21000);
  assert.equal(view.agents[1].hasReport, false);
  assert.equal(view.received, 0);
  assert.equal(view.stage, 1);
});

test('子 Agent 发给主 Agent 的后续消息不会使主任务总结失效', async () => {
  const { LiveViewAdapter } = await state;
  const raw = snapshot([
    { id: ROOT, status: 'done', turnStartedAt: 10000, reportEventId: 'main-report', endedAt: 15000 },
    { id: CHILD, parentId: ROOT, status: 'done', endedAt: 14000 }
  ]);
  raw.events = [
    { id: 'main-report', sessionId: ROOT, type: 'report', at: 15000 },
    { id: 'late-note', sessionId: CHILD, targetId: ROOT, type: 'message', at: 16000 }
  ];
  const view = new LiveViewAdapter().update(raw, 17000);
  assert.equal(view.agents[0].hasReport, true);
  assert.equal(view.complete, true);
  assert.equal(view.stage, 3);
});
