import { TeamOffice } from './team-office.js';

const $ = (id) => document.getElementById(id);
const statusNames = { thinking: '处理中', tool: '执行工具', typing: '输出消息', waiting: '等待用户',
  waiting_agents: '等待子 Agent', done: '已完成', error: '执行出错', interrupted: '已中断', closed: '已关闭', unknown: '等待日志' };
const eventNames = { task: '任务输入', assign: '分配任务', message: '追加指令', wait: '等待汇报', report: '提交汇报',
  complete: '执行完成', progress: '进展消息', tool: '工具活动', approval: '等待用户', error: '执行出错', interrupted: '任务中断', close: '关闭 Agent' };
const eventIcons = { assign: '↗', message: '↔', wait: '◷', report: '↙', complete: '✓', error: '!', interrupted: 'Ⅱ', close: '×', approval: '?' };
const activeStates = new Set(['thinking', 'tool', 'typing']);
const endedStates = new Set(['done', 'error', 'interrupted', 'closed']);
let data = null, selectedId = null, source = null, office = null, officeCapacity = 0;
let seen = new Set(), baseline = true, lastRoot = null, activeTab = 'activity', reportKey = '';
let historyLoading = false, liveSince = Date.now();
let taskSignature = '', treeSignature = '', timelineSignature = '', detailSignature = '';
let disposed = false, bootstrapTimer = null;
const reportCache = new Map();
const preference = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* 无存储权限时仍可使用。 */ } };
const time = (ms) => ms ? new Date(ms).toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
const node = (tag, cls, text) => { const el = document.createElement(tag); if (cls) el.className = cls; if (text != null) el.textContent = text; return el; };
const empty = (text) => node('div', 'empty', text);
const current = () => data?.agents.find((s) => s.id === selectedId);
const dot = (status) => node('span', 'state-dot ' + status);
const agentName = (id) => data?.agents.find((s) => s.id === id)?.name || 'Agent';

function notice(text) { $('notice').textContent = text; $('notice').hidden = !text; }
function connected(value) { $('connection').classList.toggle('connected', value); $('connection').textContent = value ? '实时同步中' : '连接中断，正在重连'; }
function avatar(s, large = false) { return node('span', 'agent-avatar' + (s.id === data.rootId ? ' lead' : ''), s.id === data.rootId ? '◈' : large ? '◇' : String(data.agents.indexOf(s)).padStart(2, '0')); }

function selectAgent(id, focus = false) {
  selectedId = id;
  detailSignature = ''; treeSignature = ''; reportKey = '';
  if (office) { office.selectedId = id; if (focus) office.focus(id); }
  renderTree(); renderDetails();
}

function renderTasks() {
  const signature = JSON.stringify(data.roots);
  if (signature === taskSignature) return;
  taskSignature = signature;
  const select = $('task-select');
  select.replaceChildren();
  for (const root of data.roots) {
    const option = node('option', '', root.title.slice(0, 80));
    option.value = root.id; select.append(option);
  }
  if (!data.roots.length) select.append(node('option', '', '尚未发现 Codex 会话'));
  select.value = data.rootId || '';
}

function renderTree() {
  if (!data) return;
  const signature = JSON.stringify([selectedId, data.agents.map((s) => [s.id, s.name, s.status, s.parentId, s.relationship])]);
  if (treeSignature === signature) return;
  treeSignature = signature;
  const tree = $('team-tree'); tree.replaceChildren();
  $('team-count').textContent = data.agents.length;
  const ordered = [];
  const walk = (id, depth) => {
    const s = data.agents.find((a) => a.id === id);
    if (!s || ordered.some((a) => a.s.id === id)) return;
    ordered.push({ s, depth });
    for (const child of data.agents.filter((a) => a.parentId === id)) walk(child.id, depth + 1);
  };
  walk(data.rootId, 0);
  for (const s of data.agents) if (!ordered.some((a) => a.s.id === s.id)) ordered.push({ s, depth: 0 });
  for (const { s, depth } of ordered) {
    const card = node('button', 'agent-card' + (depth ? ' child' : '') + (s.id === selectedId ? ' selected' : ''));
    card.type = 'button'; card.setAttribute('aria-pressed', s.id === selectedId);
    card.setAttribute('aria-label', s.name + '，' + (statusNames[s.status] || '未知状态'));
    const body = node('div', 'agent-card-body');
    const title = node('div', 'agent-card-name'); title.append(node('span', '', s.name), dot(s.status));
    body.append(title, node('div', 'agent-card-role', (depth > 1 ? '↳ '.repeat(Math.min(3, depth - 1)) : '') + (s.role || (depth ? '子 Agent' : '协调与汇总')) + ' · ' + (statusNames[s.status] || '未知')));
    card.append(avatar(s), body); card.onclick = () => selectAgent(s.id, true);
    tree.append(card);
  }
  if (!ordered.length) tree.append(empty('在 Codex 中开始任务后，团队会出现在这里。'));
}

function renderTimeline() {
  const events = data.events.filter((e) => eventIcons[e.type]).slice(-40);
  const signature = JSON.stringify(events);
  if (signature === timelineSignature) return;
  timelineSignature = signature;
  const line = $('timeline'), oldLeft = line.scrollLeft;
  const atEnd = line.scrollWidth - line.clientWidth - oldLeft < 30;
  line.replaceChildren();
  $('event-count').textContent = events.length ? '最近 ' + events.length + ' 条协作记录' : '等待协作事件';
  for (const e of events) {
    const card = node('button', 'event-card ' + e.type);
    const heading = node('div', 'event-card-top');
    const type = node('span', 'event-type'); type.append(node('i', '', eventIcons[e.type]), document.createTextNode(eventNames[e.type]));
    heading.append(type, node('time', '', time(e.at)));
    const description = e.type === 'assign' || e.type === 'message' ? agentName(e.sessionId) + ' → ' + agentName(e.targetId)
      : e.type === 'wait' ? agentName(e.sessionId) + ' 正在等待子 Agent 的结果'
      : e.preview || agentName(e.sessionId) + ' · ' + eventNames[e.type];
    card.append(heading, node('p', '', description)); card.onclick = () => {
      selectAgent(e.sessionId, true);
      if (e.hasText) openEvent(e);
    };
    card.title = description;
    line.append(card);
  }
  if (!events.length) line.append(empty('任务分配、执行结果和总结，将沿着这条时间线留下记录。'));
  line.scrollLeft = atEnd || baseline ? line.scrollWidth : oldLeft;
}

function duration(s) {
  if (!s?.turnStartedAt) return '—';
  const seconds = Math.max(0, Math.floor(((endedStates.has(s.status) ? s.endedAt : Date.now()) - s.turnStartedAt) / 1000));
  return seconds >= 3600 ? Math.floor(seconds / 3600) + '时 ' + Math.floor(seconds % 3600 / 60) + '分' : Math.floor(seconds / 60) + '分 ' + seconds % 60 + '秒';
}

function renderDetails() {
  const s = current();
  if (!s) {
    $('agent-header').replaceChildren(empty('选择 Agent，查看它的工作。'));
    $('agent-metadata').replaceChildren(); $('agent-task').textContent = '暂无任务记录';
    $('agent-activity').replaceChildren(); $('open-task').disabled = true;
    $('report-content').replaceChildren(empty('暂无汇报')); return;
  }
  const signature = JSON.stringify([s.id, s.status, s.model, s.role, s.relationship, s.task, s.events, s.reports, s.reportEventId]);
  if (signature === detailSignature) return;
  detailSignature = signature;
  const title = node('div'); title.append(node('h3', '', s.name), node('p', '', s.role || (s.parentId ? '独立执行分配任务' : '任务分配 · 协调 · 总结')));
  $('agent-header').replaceChildren(avatar(s, true), title);
  const rows = [
    ['当前状态', statusNames[s.status] || '未知'], ['本轮耗时', duration(s)], ['运行模型', s.model || '日志未记录'],
    ['所属关系', s.relationship === 'conflict' ? '关系待确认' : s.parentId ? agentName(s.parentId) : '主任务'],
  ];
  $('agent-metadata').replaceChildren(...rows.map(([key, value]) => {
    const r = node('div', 'metadata-row'); r.append(node('span', '', key), node('span', key === '当前状态' ? 'status-pill' : key === '本轮耗时' ? 'elapsed' : '', value)); return r;
  }));
  $('agent-task').textContent = s.task || '日志尚未记录任务内容';
  $('open-task').disabled = !s.taskEventId;
  const list = $('agent-activity'); list.replaceChildren();
  const recent = s.events.filter((e) => e.type !== 'task').slice(-16).reverse();
  for (const e of recent) {
    const item = node('div', 'activity-item');
    item.append(node('time', '', time(e.at) + ' · ' + (eventNames[e.type] || e.type)), node('p', '', e.preview || eventNames[e.type]));
    if (e.hasText) { const b = node('button', '', '查看记录 ↗'); b.onclick = () => openEvent(e); item.append(b); }
    list.append(item);
  }
  if (!recent.length) list.append(empty('等待新的活动记录'));
  if (activeTab === 'report') renderReports(s);
}

async function getText(sessionId, eventId) {
  const key = sessionId + ':' + eventId;
  if (reportCache.has(key)) return reportCache.get(key);
  const res = await fetch('./api/report?' + new URLSearchParams({ sessionId, eventId }));
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || '读取失败');
  reportCache.set(key, body.text);
  return body.text;
}

async function openEvent(e) {
  $('dialog-title').textContent = (eventNames[e.type] || '原始记录') + ' · ' + agentName(e.sessionId);
  $('dialog-body').textContent = '正在读取原始记录…';
  $('copy-text').textContent = '复制全文';
  if (!$('text-dialog').open) $('text-dialog').showModal();
  const token = e.id;
  $('text-dialog').dataset.eventId = token;
  try {
    const text = await getText(e.sessionId, e.id);
    if ($('text-dialog').dataset.eventId === token) $('dialog-body').textContent = text || '日志未记录正文';
  } catch (e) {
    if ($('text-dialog').dataset.eventId === token) $('dialog-body').textContent = e.message;
  }
}

async function renderReports(s) {
  const ids = s.reports || [];
  const key = s.id + ':' + ids.join(',');
  if (key === reportKey) return;
  reportKey = key;
  const container = $('report-content'); container.replaceChildren();
  if (!ids.length) { container.append(empty('尚未收到汇报。\n子 Agent 的最终回复或主 Agent 的总结写入后，会在这里完整显示。')); return; }
  container.append(empty('正在读取汇报全文…'));
  const results = await Promise.all(ids.slice(-8).reverse().map(async (id) => {
    try { return { id, text: await getText(s.id, id) }; } catch (e) { return { id, error: e.message }; }
  }));
  if (current()?.id !== s.id || key !== reportKey) return;
  container.replaceChildren();
  for (const r of results) {
    const section = node('section', 'report-block');
    const e = s.events.find((v) => v.id === r.id);
    const header = node('header'); header.append(node('span', '', (r.id === s.reportEventId ? '本轮 · ' : '历史 · ') + (s.parentId ? '子 Agent 汇报' : '主 Agent 总结')), node('time', '', time(e?.at)));
    section.append(header, node('pre', r.error ? 'error-text' : '', r.error || r.text));
    const button = node('button', 'report-open', '展开阅读 / 复制全文 ↗');
    button.onclick = () => openEvent({ id: r.id, sessionId: s.id, type: 'report' });
    section.append(button); container.append(section);
  }
  if (ids.length > 8) container.append(node('p', 'muted', '显示最近 8 份汇报；更早的记录可在 Codex 中查看。'));
}

function setTab(tab) {
  activeTab = tab;
  for (const name of ['activity', 'report']) {
    const active = tab === name;
    $(name + '-tab').classList.toggle('active', active);
    $(name + '-tab').setAttribute('aria-selected', active);
    $(name + '-panel').hidden = !active;
  }
  if (tab === 'report' && current()) renderReports(current());
}

async function syncOffice() {
  if (!office || data.agents.length > officeCapacity) {
    office?.destroy();
    officeCapacity = Math.max(7, Math.ceil(data.agents.length / 2) * 2 + 1);
    $('scene-status').hidden = false;
    try {
      const instance = new TeamOffice($('scene'), { count: officeCapacity, reduced: $('reduced-motion').checked,
        onSelect: (id) => selectAgent(id) });
      office = instance;
      instance.setTeam(data.agents, data.rootId); instance.selectedId = selectedId;
      const ready = await instance.ready;
      if (office !== instance) return;
      $('scene-status').hidden = !!ready;
      if (!ready) {
        $('scene-status').textContent = '3D 暂不可用，仍可通过团队列表查看活动和汇报。';
        instance.visible = false;
      }
    } catch {
      $('scene-status').hidden = false;
      $('scene-status').textContent = '浏览器未能启动 3D，团队列表与报告仍可使用。';
    }
  } else { office.setTeam(data.agents, data.rootId); office.selectedId = selectedId; }
}

function receive(next) {
  const changedRoot = next.rootId !== lastRoot;
  data = next;
  if (changedRoot) {
    lastRoot = data.rootId; selectedId = data.rootId; baseline = true;
    treeSignature = ''; timelineSignature = ''; detailSignature = ''; reportKey = '';
  }
  if (!data.agents.some((s) => s.id === selectedId)) selectedId = data.rootId;
  $('mode').textContent = data.mode === 'demo' ? '演示数据 · 未执行任务' : '只读观察';
  $('mode').classList.toggle('demo', data.mode === 'demo');
  const root = data.agents.find((s) => s.id === data.rootId);
  $('project-path').textContent = root?.cwd || '';
  $('project-path').title = root?.cwd || '';
  $('task-title').textContent = root?.task || '从任务分配，到每一份汇报。';
  $('task-title').title = root?.task || '';
  $('working-count').textContent = data.agents.filter((s) => activeStates.has(s.status)).length;
  $('done-count').textContent = data.agents.filter((s) => s.status === 'done').length;
  $('waiting-count').textContent = data.agents.filter((s) => s.status === 'waiting' || s.status === 'waiting_agents').length;
  notice(data.mode === 'demo' ? '这是独立的演示团队，消息和任务均为模拟内容，没有读取或执行你的 Codex 会话。'
    : data.warnings.join('；') || (!data.rootId ? '尚未发现最近 24 小时内活跃的 Codex 会话。请在 Codex 中开始任务，或检查 CODEX_HOME。' : ''));
  renderTasks(); renderTree(); renderTimeline(); renderDetails();
  syncOffice();
  const hydrating = data.agents.some((s) => s.loading);
  if (!baseline && !historyLoading && !hydrating && office)
    for (const e of data.events) if (!seen.has(e.id) && e.at >= liveSince) office.animateEvent(e);
  historyLoading = hydrating;
  seen = new Set(data.events.map((e) => e.id));
  baseline = false;
  save('codex-office-root', data.rootId || '');
}

function connect(rootId) {
  source?.close();
  baseline = true;
  historyLoading = true;
  liveSince = Date.now();
  const events = new EventSource('./events' + (rootId ? '?' + new URLSearchParams({ rootId }) : ''));
  source = events;
  events.onopen = () => { baseline = true; connected(true); };
  events.onmessage = (event) => { if (source === events) { connected(true); receive(JSON.parse(event.data)); } };
  events.onerror = () => { if (source === events) connected(false); };
}

async function bootstrap() {
  try {
    const res = await fetch('./api/sessions');
    if (!res.ok) throw new Error('无法读取办公室服务');
    const first = await res.json();
    const saved = preference('codex-office-root');
    const wanted = first.roots.find((s) => s.id === saved)?.id || first.rootId;
    connect(wanted);
  } catch (e) {
    connected(false); notice(e.message + '，正在重试。');
    if (!disposed) bootstrapTimer = setTimeout(bootstrap, 2500);
  }
}

$('task-select').onchange = (e) => { taskSignature = ''; connect(e.target.value); };
$('reset-camera').onclick = () => office?.resetCamera();
$('activity-tab').onclick = () => setTab('activity');
$('report-tab').onclick = () => setTab('report');
$('open-task').onclick = () => {
  const s = current();
  if (s?.taskEventId) openEvent({ id: s.taskEventId, sessionId: s.taskSessionId || s.id, type: 'task' });
};
$('close-dialog').onclick = () => $('text-dialog').close();
$('copy-text').onclick = async () => {
  try { await navigator.clipboard.writeText($('dialog-body').textContent); $('copy-text').textContent = '已复制'; }
  catch { $('copy-text').textContent = '复制失败，请手动选择正文'; }
};
const reducedPref = preference('codex-office-reduced');
$('reduced-motion').checked = reducedPref == null ? matchMedia('(prefers-reduced-motion: reduce)').matches : reducedPref === 'true';
$('reduced-motion').onchange = (e) => { save('codex-office-reduced', e.target.checked); office?.setReduced(e.target.checked); };
const clockTimer = setInterval(() => {
  $('clock').textContent = time(Date.now());
  const elapsed = document.querySelector('.elapsed');
  if (elapsed && current()) elapsed.textContent = duration(current());
}, 1000);
document.addEventListener('visibilitychange', () => { if (office) office.visible = !document.hidden && !office.loadError; });
window.addEventListener('beforeunload', () => {
  disposed = true; clearInterval(clockTimer); clearTimeout(bootstrapTimer); source?.close(); office?.destroy();
});
bootstrap();
