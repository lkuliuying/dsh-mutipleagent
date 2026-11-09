import { TeamOffice } from './team-office.js';
import { eventText, locale, mountLangSwitch, onLangChange, statusText, t } from './i18n.mjs';

const $ = id => document.getElementById(id);
const eventIcons = { assign: '↗', message: '↔', wait: '◷', report: '↙', complete: '✓', error: '!', interrupted: 'Ⅱ', close: '×', approval: '?' };
const activeStates = new Set(['thinking', 'tool', 'typing']);
const endedStates = new Set(['done', 'error', 'interrupted', 'closed']);
let data = null,
  selectedId = null,
  source = null,
  office = null,
  officeCapacity = 0;
let seen = new Set(),
  baseline = true,
  lastRoot = null,
  activeTab = 'activity',
  reportKey = '';
let historyLoading = false,
  liveSince = Date.now();
let taskSignature = '',
  treeSignature = '',
  timelineSignature = '',
  detailSignature = '';
let disposed = false,
  bootstrapTimer = null;
const reportCache = new Map();
const preference = key => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const save = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 无存储权限时仍可使用。 */
  }
};
const time = ms => (ms ? new Date(ms).toLocaleTimeString(locale(), { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
const node = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
const empty = text => node('div', 'empty', text);
const current = () => data?.agents.find(s => s.id === selectedId);
const dot = status => node('span', 'state-dot ' + status);
const agentName = id => data?.agents.find(s => s.id === id)?.name || t('common.agent');

function notice(text) {
  $('notice').textContent = text;
  $('notice').hidden = !text;
}
function connected(value) {
  $('connection').classList.toggle('connected', value);
  $('connection').textContent = value ? t('topbar.connected') : t('topbar.reconnecting');
}
function avatar(s, large = false) {
  return node(
    'span',
    'agent-avatar' + (s.id === data.rootId ? ' lead' : ''),
    s.id === data.rootId ? '◈' : large ? '◇' : String(data.agents.indexOf(s)).padStart(2, '0'),
  );
}

function selectAgent(id, focus = false) {
  selectedId = id;
  detailSignature = '';
  treeSignature = '';
  reportKey = '';
  if (office) {
    office.selectedId = id;
    if (focus) office.focus(id);
  }
  renderTree();
  renderDetails();
}

function renderTasks() {
  const signature = JSON.stringify(data.roots);
  if (signature === taskSignature) return;
  taskSignature = signature;
  const select = $('task-select');
  select.replaceChildren();
  for (const root of data.roots) {
    const option = node('option', '', root.title.slice(0, 80));
    option.value = root.id;
    select.append(option);
  }
  if (!data.roots.length) select.append(node('option', '', t('sidebar.noSessions')));
  select.value = data.rootId || '';
}

function renderTree() {
  if (!data) return;
  const signature = JSON.stringify([selectedId, data.agents.map(s => [s.id, s.name, s.status, s.parentId, s.relationship])]);
  if (treeSignature === signature) return;
  treeSignature = signature;
  const tree = $('team-tree');
  tree.replaceChildren();
  $('team-count').textContent = data.agents.length;
  const ordered = [];
  const walk = (id, depth) => {
    const s = data.agents.find(a => a.id === id);
    if (!s || ordered.some(a => a.s.id === id)) return;
    ordered.push({ s, depth });
    for (const child of data.agents.filter(a => a.parentId === id)) walk(child.id, depth + 1);
  };
  walk(data.rootId, 0);
  for (const s of data.agents) if (!ordered.some(a => a.s.id === s.id)) ordered.push({ s, depth: 0 });
  for (const { s, depth } of ordered) {
    const card = node('button', 'agent-card' + (depth ? ' child' : '') + (s.id === selectedId ? ' selected' : ''));
    card.type = 'button';
    card.setAttribute('aria-pressed', s.id === selectedId);
    card.setAttribute('aria-label', t('app.ariaAgentStatus', { name: s.name, status: statusText(s.status) }));
    const body = node('div', 'agent-card-body');
    const title = node('div', 'agent-card-name');
    title.append(node('span', '', s.name), dot(s.status));
    body.append(
      title,
      node(
        'div',
        'agent-card-role',
        (depth > 1 ? '↳ '.repeat(Math.min(3, depth - 1)) : '') + (s.role || (depth ? t('app.roleSubAgent') : t('app.roleLead'))) + ' · ' + statusText(s.status),
      ),
    );
    card.append(avatar(s), body);
    card.onclick = () => selectAgent(s.id, true);
    tree.append(card);
  }
  if (!ordered.length) tree.append(empty(t('app.teamEmpty')));
}

function renderTimeline() {
  const events = data.events.filter(e => eventIcons[e.type]).slice(-40);
  const signature = JSON.stringify(events);
  if (signature === timelineSignature) return;
  timelineSignature = signature;
  const line = $('timeline'),
    oldLeft = line.scrollLeft;
  const atEnd = line.scrollWidth - line.clientWidth - oldLeft < 30;
  line.replaceChildren();
  $('event-count').textContent = events.length ? t('main.recentEvents', { count: events.length }) : t('main.noEvents');
  for (const e of events) {
    const card = node('button', 'event-card ' + e.type);
    const heading = node('div', 'event-card-top');
    const type = node('span', 'event-type');
    type.append(node('i', '', eventIcons[e.type]), document.createTextNode(eventText(e.type)));
    heading.append(type, node('time', '', time(e.at)));
    const description =
      e.type === 'assign' || e.type === 'message'
        ? agentName(e.sessionId) + ' → ' + agentName(e.targetId)
        : e.type === 'wait'
          ? t('app.waitingResult', { name: agentName(e.sessionId) })
          : e.preview || agentName(e.sessionId) + ' · ' + eventText(e.type);
    card.append(heading, node('p', '', description));
    card.onclick = () => {
      selectAgent(e.sessionId, true);
      if (e.hasText) openEvent(e);
    };
    card.title = description;
    line.append(card);
  }
  if (!events.length) line.append(empty(t('main.timelineEmpty')));
  line.scrollLeft = atEnd || baseline ? line.scrollWidth : oldLeft;
}

function duration(s) {
  if (!s?.turnStartedAt) return '—';
  const seconds = Math.max(0, Math.floor(((endedStates.has(s.status) ? s.endedAt : Date.now()) - s.turnStartedAt) / 1000));
  return seconds >= 3600
    ? t('app.durationHours', { hours: Math.floor(seconds / 3600), minutes: Math.floor((seconds % 3600) / 60) })
    : t('app.durationMinutes', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 });
}

function renderDetails() {
  const s = current();
  if (!s) {
    $('agent-header').replaceChildren(empty(t('details.selectAgent')));
    $('agent-metadata').replaceChildren();
    $('agent-task').textContent = t('details.noTask');
    $('agent-activity').replaceChildren();
    $('open-task').disabled = true;
    $('report-content').replaceChildren(empty(t('details.noReport')));
    return;
  }
  const signature = JSON.stringify([s.id, s.status, s.model, s.role, s.relationship, s.task, s.events, s.reports, s.reportEventId]);
  if (signature === detailSignature) return;
  detailSignature = signature;
  const title = node('div');
  title.append(node('h3', '', s.name), node('p', '', s.role || (s.parentId ? t('app.roleSplit') : t('app.roleLeadTask'))));
  $('agent-header').replaceChildren(avatar(s, true), title);
  const rows = [
    ['status-pill', t('app.metadataStatus'), statusText(s.status)],
    ['elapsed', t('app.metadataElapsed'), duration(s)],
    ['', t('app.metadataModel'), s.model || t('common.notRecorded')],
    ['', t('app.metadataRelation'), s.relationship === 'conflict' ? t('app.relationConflict') : s.parentId ? agentName(s.parentId) : t('app.relationMain')],
  ];
  $('agent-metadata').replaceChildren(
    ...rows.map(([cls, key, value]) => {
      const r = node('div', 'metadata-row');
      r.append(node('span', '', key), node('span', cls, value));
      return r;
    }),
  );
  $('agent-task').textContent = s.task || t('app.noTaskLogged');
  $('open-task').disabled = !s.taskEventId;
  const list = $('agent-activity');
  list.replaceChildren();
  const recent = s.events
    .filter(e => e.type !== 'task')
    .slice(-16)
    .reverse();
  for (const e of recent) {
    const item = node('div', 'activity-item');
    item.append(node('time', '', time(e.at) + ' · ' + eventText(e.type)), node('p', '', e.preview || eventText(e.type)));
    if (e.hasText) {
      const b = node('button', '', t('details.viewRecord'));
      b.onclick = () => openEvent(e);
      item.append(b);
    }
    list.append(item);
  }
  if (!recent.length) list.append(empty(t('details.noActivity')));
  if (activeTab === 'report') renderReports(s);
}

async function getText(sessionId, eventId) {
  const key = sessionId + ':' + eventId;
  if (reportCache.has(key)) return reportCache.get(key);
  const res = await fetch('./api/report?' + new URLSearchParams({ sessionId, eventId }));
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || t('app.readFailed'));
  reportCache.set(key, body.text);
  return body.text;
}

async function openEvent(e) {
  $('dialog-title').textContent = (eventIcons[e.type] ? eventText(e.type) : t('dialog.title')) + ' · ' + agentName(e.sessionId);
  $('dialog-body').textContent = t('dialog.loading');
  $('copy-text').textContent = t('dialog.copy');
  if (!$('text-dialog').open) $('text-dialog').showModal();
  const token = e.id;
  $('text-dialog').dataset.eventId = token;
  try {
    const text = await getText(e.sessionId, e.id);
    if ($('text-dialog').dataset.eventId === token) $('dialog-body').textContent = text || t('dialog.emptyBody');
  } catch (e) {
    if ($('text-dialog').dataset.eventId === token) $('dialog-body').textContent = e.message;
  }
}

async function renderReports(s) {
  const ids = s.reports || [];
  const key = s.id + ':' + ids.join(',');
  if (key === reportKey) return;
  reportKey = key;
  const container = $('report-content');
  container.replaceChildren();
  if (!ids.length) {
    container.append(empty(t('app.reportEmpty')));
    return;
  }
  container.append(empty(t('app.reportLoading')));
  const results = await Promise.all(
    ids
      .slice(-8)
      .reverse()
      .map(async id => {
        try {
          return { id, text: await getText(s.id, id) };
        } catch (e) {
          return { id, error: e.message };
        }
      }),
  );
  if (current()?.id !== s.id || key !== reportKey) return;
  container.replaceChildren();
  for (const r of results) {
    const section = node('section', 'report-block');
    const e = s.events.find(v => v.id === r.id);
    const header = node('header');
    header.append(
      node('span', '', (r.id === s.reportEventId ? t('app.reportCurrent') : t('app.reportHistory')) + (s.parentId ? t('app.reportSub') : t('app.reportLead'))),
      node('time', '', time(e?.at)),
    );
    section.append(header, node('pre', r.error ? 'error-text' : '', r.error || r.text));
    const button = node('button', 'report-open', t('app.reportOpen'));
    button.onclick = () => openEvent({ id: r.id, sessionId: s.id, type: 'report' });
    section.append(button);
    container.append(section);
  }
  if (ids.length > 8) container.append(node('p', 'muted', t('app.reportLimit')));
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
      const instance = new TeamOffice($('scene'), { count: officeCapacity, reduced: $('reduced-motion').checked, onSelect: id => selectAgent(id) });
      office = instance;
      instance.setTeam(data.agents, data.rootId);
      instance.selectedId = selectedId;
      const ready = await instance.ready;
      if (office !== instance) return;
      $('scene-status').hidden = !!ready;
      if (!ready) {
        $('scene-status').textContent = t('main.sceneUnavailable');
        instance.visible = false;
      }
    } catch {
      $('scene-status').hidden = false;
      $('scene-status').textContent = t('main.sceneFailed');
    }
  } else {
    office.setTeam(data.agents, data.rootId);
    office.selectedId = selectedId;
  }
}

function receive(next) {
  const changedRoot = next.rootId !== lastRoot;
  data = next;
  if (changedRoot) {
    lastRoot = data.rootId;
    selectedId = data.rootId;
    baseline = true;
    treeSignature = '';
    timelineSignature = '';
    detailSignature = '';
    reportKey = '';
  }
  if (!data.agents.some(s => s.id === selectedId)) selectedId = data.rootId;
  $('mode').textContent = data.mode === 'demo' ? t('app.demoMode') : t('topbar.readonly');
  $('mode').classList.toggle('demo', data.mode === 'demo');
  const root = data.agents.find(s => s.id === data.rootId);
  $('project-path').textContent = root?.cwd || '';
  $('project-path').title = root?.cwd || '';
  $('task-title').textContent = root?.task || t('main.subtitle');
  $('task-title').title = root?.task || '';
  $('working-count').textContent = data.agents.filter(s => activeStates.has(s.status)).length;
  $('done-count').textContent = data.agents.filter(s => s.status === 'done').length;
  $('waiting-count').textContent = data.agents.filter(s => s.status === 'waiting' || s.status === 'waiting_agents').length;
  notice(data.mode === 'demo' ? t('app.demoNotice') : data.warnings.join(t('common.listSeparator')) || (!data.rootId ? t('app.noRecentSessions') : ''));
  renderTasks();
  renderTree();
  renderTimeline();
  renderDetails();
  syncOffice();
  const hydrating = data.agents.some(s => s.loading);
  if (!baseline && !historyLoading && !hydrating && office) for (const e of data.events) if (!seen.has(e.id) && e.at >= liveSince) office.animateEvent(e);
  historyLoading = hydrating;
  seen = new Set(data.events.map(e => e.id));
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
  events.onopen = () => {
    baseline = true;
    connected(true);
  };
  events.onmessage = event => {
    if (source === events) {
      connected(true);
      receive(JSON.parse(event.data));
    }
  };
  events.onerror = () => {
    if (source === events) connected(false);
  };
}

async function bootstrap() {
  try {
    const res = await fetch('./api/sessions');
    if (!res.ok) throw new Error(t('app.editFailed'));
    const first = await res.json();
    const saved = preference('codex-office-root');
    const wanted = first.roots.find(s => s.id === saved)?.id || first.rootId;
    connect(wanted);
  } catch (e) {
    connected(false);
    notice(t('app.retrying', { message: e.message }));
    if (!disposed) bootstrapTimer = setTimeout(bootstrap, 2500);
  }
}

$('task-select').onchange = e => {
  taskSignature = '';
  connect(e.target.value);
};
$('reset-camera').onclick = () => office?.resetCamera();
$('activity-tab').onclick = () => setTab('activity');
$('report-tab').onclick = () => setTab('report');
$('open-task').onclick = () => {
  const s = current();
  if (s?.taskEventId) openEvent({ id: s.taskEventId, sessionId: s.taskSessionId || s.id, type: 'task' });
};
$('close-dialog').onclick = () => $('text-dialog').close();
$('copy-text').onclick = async () => {
  try {
    await navigator.clipboard.writeText($('dialog-body').textContent);
    $('copy-text').textContent = t('common.copied');
  } catch {
    $('copy-text').textContent = t('common.copyFailed');
  }
};
const reducedPref = preference('codex-office-reduced');
$('reduced-motion').checked = reducedPref == null ? matchMedia('(prefers-reduced-motion: reduce)').matches : reducedPref === 'true';
$('reduced-motion').onchange = e => {
  save('codex-office-reduced', e.target.checked);
  office?.setReduced(e.target.checked);
};
const clockTimer = setInterval(() => {
  $('clock').textContent = time(Date.now());
  const elapsed = document.querySelector('.elapsed');
  if (elapsed && current()) elapsed.textContent = duration(current());
}, 1000);
document.addEventListener('visibilitychange', () => {
  if (office) office.visible = !document.hidden && !office.loadError;
});
// 切换语言后重绘全部动态文案。
onLangChange(() => {
  taskSignature = '';
  treeSignature = '';
  timelineSignature = '';
  detailSignature = '';
  reportKey = '';
  if (data) receive(data);
});
mountLangSwitch(document);
window.addEventListener('beforeunload', () => {
  disposed = true;
  clearInterval(clockTimer);
  clearTimeout(bootstrapTimer);
  source?.close();
  office?.destroy();
});
bootstrap();
