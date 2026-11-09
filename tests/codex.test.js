'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { fixture, IDS } = require('./helpers.cjs');

test('从嵌套元数据构建主任务、子 Agent 及后代，保留完成成员', t => {
  const f = fixture(t);
  f.create(IDS.main);
  f.create(IDS.child, IDS.main);
  f.create(IDS.nested, IDS.child);
  f.write(IDS.main, 'event_msg', { type: 'user_message', message: '检查任务' });
  f.write(IDS.child, 'event_msg', { type: 'task_complete', last_agent_message: '检查完成' });
  f.tick();
  f.watcher.select(IDS.main);
  const view = f.watcher.snapshot(IDS.main);
  assert.equal(view.agents.length, 3);
  assert.equal(view.agents.find(x => x.id === IDS.nested).parentId, IDS.child);
  assert.equal(view.agents.find(x => x.id === IDS.child).status, 'done');
  assert.equal(view.roots.length, 1);
});

test('原生分配、追加指令、等待与失败路径不伪造完成', t => {
  const f = fixture(t);
  f.create(IDS.main);
  f.write(IDS.main, 'event_msg', { type: 'task_started', turn_id: 'turn-1' });
  f.write(IDS.main, 'event_msg', { type: 'collab_agent_spawn_end', call_id: 'a', new_thread_id: IDS.child, prompt: '检查接口' });
  f.write(IDS.main, 'event_msg', { type: 'collab_agent_interaction_end', call_id: 'b', receiver_thread_id: IDS.child, prompt: '补查错误响应' });
  f.write(IDS.main, 'event_msg', { type: 'collab_waiting_begin', call_id: 'w' });
  f.tick();
  assert.equal(f.watcher.agent(IDS.main).status, 'waiting_agents');
  assert.equal(f.watcher.agent(IDS.child).parentId, IDS.main);
  f.write(IDS.main, 'event_msg', { type: 'collab_waiting_end', call_id: 'w', statuses: { [IDS.child]: { errored: '检查失败' } } });
  f.write(IDS.main, 'event_msg', { type: 'turn_aborted', reason: '用户中断' });
  f.tick();
  assert.equal(f.watcher.agent(IDS.child).status, 'error');
  assert.equal(f.watcher.agent(IDS.main).status, 'interrupted');
  assert.deepEqual(
    f.watcher
      .snapshot()
      .events.filter(x => ['assign', 'message', 'wait'].includes(x.type))
      .map(x => x.type),
    ['assign', 'message', 'wait'],
  );
});

test('工具形式创建子 Agent，任务正文关联到正确的调用记录', t => {
  const f = fixture(t);
  f.create(IDS.main);
  const task = '只读分析接口\n' + '详细约束。'.repeat(1000);
  f.write(IDS.main, 'response_item', {
    type: 'function_call',
    name: 'collaboration.spawn_agent',
    call_id: 'spawn',
    arguments: JSON.stringify({ message: task }),
  });
  f.write(IDS.main, 'response_item', { type: 'function_call_output', call_id: 'spawn', output: JSON.stringify({ agent_id: IDS.child }) });
  f.tick();
  const child = f.watcher.agent(IDS.child);
  assert.equal(child.parentId, IDS.main);
  assert.equal(child.taskSessionId, IDS.main);
  assert.equal(f.watcher.fullText(IDS.main, child.taskEventId).text, task);
});

test('最终回复和 task_complete 去重，超长中文正文逐字保留', t => {
  const f = fixture(t);
  f.create(IDS.main);
  const report = '# 完整报告\n' + '金额与幂等性检查。\n'.repeat(18000);
  f.write(IDS.main, 'event_msg', { type: 'task_started', turn_id: 'one' });
  f.write(IDS.main, 'response_item', { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ type: 'output_text', text: report }] });
  f.write(IDS.main, 'event_msg', { type: 'task_complete', last_agent_message: report });
  f.tick();
  const view = f.watcher.snapshot();
  assert.equal(view.events.filter(x => x.type === 'report').length, 1);
  assert.equal(f.watcher.fullText(IDS.main, view.agents[0].reportEventId).text, report);
  f.write(IDS.main, 'event_msg', { type: 'task_started', turn_id: 'two' });
  f.write(IDS.main, 'event_msg', { type: 'task_complete', last_agent_message: report });
  f.tick();
  assert.equal(f.watcher.agent(IDS.main).reports.length, 2);
});

test('增量读取保留 UTF-8 半字和半行，重复轮询不重复产生事件', t => {
  const f = fixture(t);
  const file = f.create(IDS.main);
  f.tick();
  const raw = Buffer.from(f.line(IDS.main, 'event_msg', { type: 'user_message', message: '新任务中文正文' }));
  const split = raw.indexOf(Buffer.from('中')) + 1;
  fs.appendFileSync(file, raw.subarray(0, split));
  f.tick();
  assert.equal(f.watcher.snapshot().events.length, 0);
  fs.appendFileSync(file, raw.subarray(split));
  f.tick();
  f.tick();
  const event = f.watcher.snapshot().events[0];
  assert.equal(f.watcher.fullText(IDS.main, event.id).text, '新任务中文正文');
  assert.equal(f.watcher.snapshot().events.length, 1);
});

test('从旧日期目录发现最近续聊的主任务；子日志可以晚于创建事件到达', t => {
  const f = fixture(t);
  f.create(IDS.main, null, '2025/01/02');
  f.write(IDS.main, 'event_msg', { type: 'collab_agent_spawn_end', call_id: 'a', new_thread_id: IDS.child, prompt: '检查' });
  f.tick();
  assert.equal(f.watcher.roots()[0].id, IDS.main);
  assert.equal(f.watcher.agent(IDS.child).status, 'unknown');
  f.create(IDS.child, IDS.main);
  f.write(IDS.child, 'event_msg', { type: 'task_complete', last_agent_message: '已完成' });
  f.tick();
  assert.equal(f.watcher.snapshot().agents.find(x => x.id === IDS.child).status, 'done');
});

test('新观察器重建同样的事件 ID，刷新不造成重复记录', t => {
  const f = fixture(t);
  f.create(IDS.main);
  f.write(IDS.main, 'event_msg', { type: 'task_started', turn_id: 't' });
  f.write(IDS.main, 'event_msg', { type: 'task_complete', last_agent_message: '结果' });
  f.tick();
  const { CodexWatcher } = require('../src/codex');
  const other = new CodexWatcher({ codexHome: f.home });
  other.tick();
  assert.deepEqual(
    other.snapshot().events.map(x => x.id),
    f.watcher.snapshot().events.map(x => x.id),
  );
});

test('日志重写后旧报告不能返回新位置的内容，重新载入后可恢复', t => {
  const f = fixture(t);
  const file = f.create(IDS.main);
  f.write(IDS.main, 'event_msg', { type: 'task_complete', last_agent_message: '旧报告正文' });
  f.tick();
  const id = f.watcher.agent(IDS.main).reportEventId;
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('旧报告正文', '新报告正文'));
  assert.throws(() => f.watcher.fullText(IDS.main, id), /改变/);
  f.tick();
  assert.notEqual(f.watcher.agent(IDS.main).reportEventId, id);
  assert.equal(f.watcher.fullText(IDS.main, f.watcher.agent(IDS.main).reportEventId).text, '新报告正文');
});

test('忽略系统指令、私有推理及上下文注入；父关系冲突明确标记', t => {
  const f = fixture(t);
  f.create(IDS.main);
  f.create(IDS.child, IDS.main);
  f.write(IDS.main, 'response_item', { type: 'message', role: 'system', content: [{ text: '不应展示的系统内容' }] });
  f.write(IDS.main, 'response_item', { type: 'reasoning', summary: [{ text: '不应展示的私有推理' }] });
  f.write(IDS.main, 'event_msg', { type: 'user_message', message: '<environment_context>上下文</environment_context>' });
  f.tick();
  assert.equal(f.watcher.snapshot().events.length, 0);
  f.watcher.link(IDS.child, IDS.second, 'spawn');
  assert.equal(f.watcher.agent(IDS.child).relationship, 'conflict');
  assert.equal(f.watcher.agent(IDS.child).parentId, IDS.main);
});

test('主日志先收到兜底汇报、子日志迟到时，正文只记一份', t => {
  const f = fixture(t);
  f.create(IDS.main);
  f.write(IDS.main, 'event_msg', { type: 'collab_agent_spawn_end', call_id: 's', new_thread_id: IDS.child, prompt: '检查' });
  f.write(IDS.main, 'event_msg', { type: 'collab_waiting_end', call_id: 'w', statuses: { [IDS.child]: { completed: '同一份结果' } } });
  f.tick();
  assert.equal(f.watcher.agent(IDS.child).reports.length, 1);
  f.create(IDS.child, IDS.main);
  f.write(IDS.child, 'event_msg', { type: 'task_started', turn_id: 'own-turn' });
  f.write(IDS.child, 'event_msg', { type: 'task_complete', last_agent_message: '同一份结果' });
  f.tick();
  const child = f.watcher.agent(IDS.child);
  assert.equal(child.reports.length, 1);
  assert.equal(f.watcher.fullText(IDS.child, child.reportEventId).text, '同一份结果');
});

test('跳过 Desktop 子 Agent 继承历史及内部审查，不把它们当成新任务活动', t => {
  const f = fixture(t);
  f.create(IDS.main);
  const childFile = f.create(IDS.child, IDS.main);
  const header = JSON.parse(fs.readFileSync(childFile, 'utf8'));
  header.payload.subagent_history_start_ordinal = 4;
  fs.writeFileSync(
    childFile,
    JSON.stringify(header) +
      '\n' +
      f.line(IDS.child, 'session_meta', { id: IDS.main, source: 'vscode', thread_source: 'user' }) +
      f.line(IDS.child, 'response_item', { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ text: '继承的主任务旧回复' }] }) +
      f.line(IDS.child, 'event_msg', { type: 'task_complete', last_agent_message: '继承的主任务旧回复' }),
  );
  f.write(IDS.child, 'event_msg', { type: 'task_started', turn_id: 'own' });
  f.write(IDS.child, 'event_msg', { type: 'task_complete', last_agent_message: '子 Agent 自己的结果' });
  const internal = f.create(IDS.second, IDS.main);
  const metadata = JSON.parse(fs.readFileSync(internal, 'utf8'));
  metadata.payload.thread_source = 'guardian_review';
  metadata.payload.source = { subagent: { other: 'guardian' } };
  metadata.payload.parent_thread_id = IDS.main;
  fs.writeFileSync(internal, JSON.stringify(metadata) + '\n');
  f.write(IDS.second, 'event_msg', { type: 'task_complete', last_agent_message: '内部审查结果' });
  f.tick();
  f.watcher.select(IDS.main);
  const view = f.watcher.snapshot(IDS.main);
  assert.equal(view.agents.length, 2);
  assert.equal(view.agents.find(s => s.id === IDS.child).reports.length, 1);
  assert.equal(
    view.events.some(e => e.preview.includes('继承') || e.preview.includes('内部审查')),
    false,
  );
});

test('Desktop 任务路径创建结果与稍后到达的子日志关联', t => {
  const f = fixture(t);
  f.create(IDS.main);
  f.write(IDS.main, 'response_item', {
    type: 'function_call',
    name: 'spawn_agent',
    call_id: 's',
    arguments: JSON.stringify({ task_name: 'check', message: '真实分配原文' }),
  });
  f.write(IDS.main, 'response_item', { type: 'function_call_output', call_id: 's', output: JSON.stringify({ task_name: '/root/check' }) });
  f.tick();
  const file = f.create(IDS.child, IDS.main);
  const header = JSON.parse(fs.readFileSync(file, 'utf8'));
  header.payload.source.subagent.thread_spawn.agent_path = '/root/check';
  fs.writeFileSync(file, JSON.stringify(header) + '\n');
  f.tick();
  const event = f.watcher.snapshot().events.find(e => e.type === 'assign');
  assert.equal(event.targetId, IDS.child);
  assert.equal(f.watcher.fullText(IDS.main, event.id).text, '真实分配原文');
});

test('缺类型事件不会丢失同一读取块的后续完整记录', t => {
  const f = fixture(t);
  f.create(IDS.main);
  f.write(IDS.main, 'event_msg', { irrelevant: true });
  f.write(IDS.main, 'event_msg', { type: 'task_complete', last_agent_message: '后续有效结果' });
  f.tick();
  assert.equal(f.watcher.agent(IDS.main).status, 'done');
  assert.equal(f.watcher.fullText(IDS.main, f.watcher.agent(IDS.main).reportEventId).text, '后续有效结果');
  assert.ok(f.watcher.snapshot().warnings.some(s => s.includes('缺少类型')));
});

test('某个成员日志读取失败，其他成员仍然更新', t => {
  const f = fixture(t);
  f.create(IDS.main);
  f.create(IDS.child, IDS.main);
  f.write(IDS.child, 'event_msg', { type: 'task_complete', last_agent_message: '独立成员结果' });
  const load = f.watcher.load.bind(f.watcher);
  f.watcher.load = id => {
    if (id === IDS.main) throw Object.assign(new Error('无读取权限'), { code: 'EACCES' });
    load(id);
  };
  f.tick();
  assert.equal(f.watcher.agent(IDS.child).status, 'done');
  assert.ok(f.watcher.snapshot().warnings.some(s => s.includes('EACCES')));
});

test('Desktop 相对与完整任务路径关联追加指令及嵌套成员', t => {
  const f = fixture(t);
  f.create(IDS.main);
  for (const [id, parent, agentPath] of [
    [IDS.child, IDS.main, '/root/check'],
    [IDS.nested, IDS.child, '/root/check/detail'],
  ]) {
    const file = f.create(id, parent);
    const header = JSON.parse(fs.readFileSync(file, 'utf8'));
    header.payload.agent_path = agentPath;
    fs.writeFileSync(file, JSON.stringify(header) + '\n');
  }
  f.write(IDS.main, 'response_item', {
    type: 'function_call',
    name: 'collaboration.followup_task',
    call_id: 'follow',
    arguments: JSON.stringify({ target: 'check', message: '补查接口边界' }),
  });
  f.write(IDS.child, 'response_item', {
    type: 'function_call',
    name: 'send_message',
    call_id: 'nested',
    arguments: JSON.stringify({ target: 'detail', message: '核对嵌套结果' }),
  });
  f.write(IDS.nested, 'response_item', {
    type: 'function_call',
    name: 'send_message',
    call_id: 'canonical',
    arguments: JSON.stringify({ target: '/root/check', message: '返回核对进展' }),
  });
  f.tick();
  const messages = f.watcher.snapshot(IDS.main).events.filter(e => e.type === 'message');
  assert.deepEqual(
    messages.map(e => e.targetId),
    [IDS.child, IDS.nested, IDS.child],
  );
  for (const e of messages) assert.equal(f.watcher.fullText(e.sessionId, e.id).text, e.preview);
});

test('追加指令先到时保留原文，子元数据迟到后补关联且刷新不改变事件 ID', t => {
  const f = fixture(t);
  f.create(IDS.main);
  f.write(IDS.main, 'response_item', {
    type: 'function_call',
    name: 'followup_task',
    call_id: 'late',
    arguments: JSON.stringify({ target: '/root/check', message: '稍后关联的追加任务' }),
  });
  f.tick();
  const first = f.watcher.snapshot(IDS.main).events.find(e => e.type === 'message');
  assert.equal(first.targetId, null);
  assert.equal(f.watcher.fullText(IDS.main, first.id).text, '稍后关联的追加任务');
  const file = f.create(IDS.child, IDS.main);
  const header = JSON.parse(fs.readFileSync(file, 'utf8'));
  header.payload.agent_path = '/root/check';
  fs.writeFileSync(file, JSON.stringify(header) + '\n');
  f.tick();
  assert.equal(f.watcher.snapshot(IDS.main).events.find(e => e.id === first.id).targetId, IDS.child);
  const { CodexWatcher } = require('../src/codex');
  const restored = new CodexWatcher({ codexHome: f.home });
  restored.tick();
  const message = restored.snapshot(IDS.main).events.find(e => e.type === 'message');
  assert.equal(message.id, first.id);
  assert.equal(message.targetId, IDS.child);
});

test('Desktop 等待真实结束后恢复主状态，中断请求不伪造子 Agent 中断', t => {
  const f = fixture(t);
  f.create(IDS.main);
  f.create(IDS.child, IDS.main);
  f.write(IDS.child, 'event_msg', { type: 'task_complete', last_agent_message: '已完成的真实结果' });
  f.write(IDS.main, 'response_item', { type: 'function_call', name: 'wait_agent', call_id: 'wait', arguments: '{"timeout_ms":10000}' });
  f.tick();
  assert.equal(f.watcher.agent(IDS.main).status, 'waiting_agents');
  const wait = f.watcher.snapshot(IDS.main).events.find(e => e.type === 'wait');
  assert.equal(wait.hasText, false);
  f.write(IDS.main, 'response_item', { type: 'function_call_output', call_id: 'wait', output: 'Mailbox updated' });
  f.tick();
  assert.equal(f.watcher.agent(IDS.main).status, 'thinking');
  f.write(IDS.main, 'response_item', {
    type: 'function_call',
    name: 'interrupt_agent',
    call_id: 'interrupt',
    arguments: JSON.stringify({ target: IDS.child }),
  });
  f.tick();
  const view = f.watcher.snapshot(IDS.main);
  assert.equal(f.watcher.agent(IDS.child).status, 'done');
  assert.equal(
    view.events.some(e => e.type === 'interrupted'),
    false,
  );
  assert.ok(view.events.some(e => e.type === 'tool' && e.preview.startsWith('请求中断')));
  assert.equal(view.events.filter(e => e.type === 'report').length, 1);
});

test('内部审查即使没有父 ID，也不进入可选主任务列表', t => {
  const f = fixture(t);
  f.create(IDS.main);
  const file = f.create(IDS.second);
  const header = JSON.parse(fs.readFileSync(file, 'utf8'));
  header.payload.source = { internal: 'guardian' };
  fs.writeFileSync(file, JSON.stringify(header) + '\n');
  f.tick();
  assert.deepEqual(
    f.watcher.roots().map(s => s.id),
    [IDS.main],
  );
});

test('独立 AGENTS 指令及环境注入不覆盖真实用户任务', t => {
  const f = fixture(t);
  f.create(IDS.main);
  f.write(IDS.main, 'event_msg', { type: 'user_message', message: '运行真实协作检查' });
  const instructions = '# AGENTS.md instructions\n\n<INSTRUCTIONS>仅为工具注入的协作规则</INSTRUCTIONS>';
  const environment = '<environment_context>仅为环境信息</environment_context>';
  f.write(IDS.main, 'response_item', { type: 'message', role: 'user', content: [{ text: instructions }, { text: environment }] });
  f.write(IDS.main, 'event_msg', { type: 'user_message', message: instructions });
  f.write(IDS.main, 'event_msg', { type: 'user_message', message: environment });
  f.write(IDS.main, 'response_item', {
    type: 'message',
    role: 'user',
    content: [{ text: '<external_codex_apps_instructions>工具上下文</external_codex_apps_instructions>' }],
  });
  f.tick();
  const view = f.watcher.snapshot(IDS.main);
  assert.equal(view.agents[0].task, '运行真实协作检查');
  assert.equal(view.roots[0].title, '运行真实协作检查');
  assert.equal(view.events.filter(e => e.type === 'task').length, 1);
  assert.equal(f.watcher.fullText(IDS.main, view.agents[0].taskEventId).text, '运行真实协作检查');
});

test('正常请求中的 AGENTS 示例和代码块不被误过滤', t => {
  const f = fixture(t);
  f.create(IDS.main);
  const requests = [
    '请检查这个代码块：\n```markdown\n# AGENTS.md instructions\n<INSTRUCTIONS>示例内容</INSTRUCTIONS>\n```',
    '# AGENTS.md instructions\n请解释这个文件标题的含义',
    '# AGENTS.md instructions\n<INSTRUCTIONS>示例内容</INSTRUCTIONS>\n请检查上述示例是否正确',
    '<environment_context>示例环境</environment_context>\n请解释这个示例',
  ];
  for (const [i, message] of requests.entries()) {
    if (i % 2) f.write(IDS.main, 'event_msg', { type: 'user_message', message });
    else f.write(IDS.main, 'response_item', { type: 'message', role: 'user', content: [{ text: message }] });
    f.tick();
    const agent = f.watcher.agent(IDS.main);
    assert.equal(f.watcher.fullText(IDS.main, agent.taskEventId).text, message);
  }
  assert.equal(f.watcher.snapshot(IDS.main).events.filter(e => e.type === 'task').length, requests.length);
});

test('不可读载荷不成为任务、进展、报告或工具正文，分配关系仍保留', t => {
  const f = fixture(t);
  f.create(IDS.main);
  const childFile = f.create(IDS.child, IDS.main);
  const header = JSON.parse(fs.readFileSync(childFile, 'utf8'));
  delete header.payload.source.subagent.thread_spawn.agent_nickname;
  header.payload.agent_path = '/root/visible-label';
  fs.writeFileSync(childFile, JSON.stringify(header) + '\n');
  const opaque = 'gAAAAAB' + 'A'.repeat(120) + '==';
  f.write(IDS.main, 'response_item', { type: 'function_call', name: 'spawn_agent', call_id: 'opaque-spawn', arguments: JSON.stringify({ message: opaque }) });
  f.write(IDS.main, 'response_item', { type: 'function_call_output', call_id: 'opaque-spawn', output: JSON.stringify({ agent_id: IDS.child }) });
  f.write(IDS.main, 'response_item', {
    type: 'function_call',
    name: 'followup_task',
    call_id: 'opaque-follow',
    arguments: JSON.stringify({ target: IDS.child, message: opaque }),
  });
  f.write(IDS.child, 'event_msg', { type: 'user_message', message: opaque });
  f.write(IDS.child, 'response_item', { type: 'message', role: 'user', content: [{ text: opaque }] });
  f.write(IDS.child, 'event_msg', { type: 'agent_message', message: opaque });
  f.write(IDS.child, 'response_item', { type: 'message', role: 'assistant', phase: 'final_answer', content: [{ text: opaque }] });
  f.write(IDS.child, 'response_item', { type: 'function_call', name: 'exec_command', call_id: 'opaque-command', arguments: JSON.stringify({ cmd: opaque }) });
  f.write(IDS.child, 'response_item', { type: 'local_shell_call', id: 'visible-command', action: { command: ['node', '--version'] } });
  f.write(IDS.child, 'event_msg', { type: 'task_complete', last_agent_message: opaque });
  f.tick();
  const view = f.watcher.snapshot(IDS.main);
  const child = view.agents.find(s => s.id === IDS.child);
  assert.equal(child.name, 'visible-label');
  assert.equal(child.task, '任务正文未记录为可见明文');
  assert.equal(child.status, 'done');
  assert.equal(child.reports.length, 0);
  assert.equal(child.reportEventId, null);
  assert.equal(JSON.stringify(view).includes(opaque), false);
  const assignment = view.events.find(e => e.type === 'assign');
  assert.equal(assignment.targetId, IDS.child);
  assert.equal(assignment.hasText, false);
  assert.equal(f.watcher.fullText(IDS.main, assignment.id).text, '任务正文未记录为可见明文');
  assert.equal(view.events.find(e => e.type === 'message').targetId, IDS.child);
  assert.ok(view.events.some(e => e.type === 'tool' && e.preview === 'node,--version'));
  for (const event of view.events) assert.equal(f.watcher.fullText(event.sessionId, event.id).text.includes(opaque), false);
  f.write(IDS.child, 'event_msg', { type: 'task_complete', last_agent_message: '这是真实可见的检查结果' });
  f.tick();
  assert.equal(f.watcher.agent(IDS.child).reports.length, 1);
  assert.equal(f.watcher.fullText(IDS.child, f.watcher.agent(IDS.child).reportEventId).text, '这是真实可见的检查结果');
});

test('用户载荷不可读时保留原先实际可见的分配正文', t => {
  const f = fixture(t);
  f.create(IDS.main);
  f.create(IDS.child, IDS.main);
  f.write(IDS.main, 'event_msg', { type: 'collab_agent_spawn_end', call_id: 'visible', new_thread_id: IDS.child, prompt: '真实可见的接口检查任务' });
  f.write(IDS.child, 'event_msg', { type: 'user_message', message: 'gAAAAAB' + 'B'.repeat(120) + '==' });
  f.tick();
  const child = f.watcher.agent(IDS.child);
  assert.equal(child.task, '真实可见的接口检查任务');
  assert.equal(child.taskSessionId, IDS.main);
  assert.equal(f.watcher.fullText(IDS.main, child.taskEventId).text, '真实可见的接口检查任务');
});
