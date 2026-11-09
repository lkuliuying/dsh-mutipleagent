import { DemoScene } from './demo-scene.js';
import { DemoPlayer, DURATION } from './demo-state.mjs';
import { startLiveOffice } from './live-office.js';
import { applyOfficeBrand, officePage, officeSource } from './base-url.mjs';
import { enhanceSelect, bindSearchNavigation, closeOfficeControls } from './office-controls.js';

if (new URLSearchParams(location.search).get('mode') === 'live') startLiveOffice();
else startDemo();

function startDemo() {
const sourceKind = officeSource();
applyOfficeBrand(sourceKind);

const $ = (id) => document.getElementById(id);
const element = (tag, cls, text) => {
  const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n;
};
const icon = (name) => { const img = element('img'); img.src = './demo-icons/' + name + '.svg'; img.alt = ''; return img; };
const STAGES = ['分析与分配', '并行执行', '结果汇报', '主 Agent 总结'];
const TYPES = { main: '协作编排', api: '接口开发', frontend: '界面开发', test: '测试与审阅' };
const player = new DemoPlayer();
const viewSnapshot = () => {
  const value = player.snapshot;
  return sourceKind === 'harness' ? { ...value,
    config: { ...value.config, project: value.config.project.replace('Codex', 'Harness') },
    agents: value.agents.map(agent => ({ ...agent, agent: 'dsh' }))
  } : value;
};
let snapshot = viewSnapshot(), selectedId = 'frontend', scene = null, query = '', toastTimer = null;
let seen = new Set(snapshot.events.map((e) => e.id)), detailsOpen = innerWidth > 1050 && innerHeight > 820;
let lastSeconds = snapshot.seconds, lastScenario = snapshot.scenario, lastTime = performance.now();
let dialogSignature = '', queueSignature = '';
const scenarioPicker = enhanceSelect($('scenario'));
const searchNavigation = bindSearchNavigation({ input: $('task-search'), form: $('search-form'),
  results: $('search-results'), list: $('search-result-list'), status: $('search-status'), clear: $('clear-search'),
  onClear: () => $('clear-search').click(), onOpen: renderSearch });
const names = { main: '主 Agent', api: '接口 Agent', frontend: '前端 Agent', test: '测试 Agent' };
const selected = () => snapshot.agents.find((s) => s.id === selectedId) || snapshot.agents[0];
const statusLabel = (s) => s.status === 'done' ? '已完成' : s.status === 'unknown' ? '待分配' : s.status === 'waiting_agents' ? '协调中' : '执行中';
const clock = (seconds) => '00:' + String(Math.floor(seconds)).padStart(2, '0');

function toast(text) {
  clearTimeout(toastTimer); $('demo-toast').textContent = text; $('demo-toast').hidden = false;
  toastTimer = setTimeout(() => { $('demo-toast').hidden = true; }, 2300);
}

function openDetails(value) {
  detailsOpen = value;
  $('agent-details').hidden = !value;
  $('open-details').hidden = value;
}

function selectAgent(id, focus = true) {
  selectedId = id;
  openDetails(true);
  scene?.select(id, focus);
  queueSignature = '';
  render();
}

function drawRing(progress) {
  const c = $('progress-ring').getContext('2d');
  c.clearRect(0, 0, 112, 112);
  c.lineWidth = 15; c.lineCap = 'round';
  c.strokeStyle = '#e5edfc'; c.beginPath(); c.arc(56, 56, 39, 0, Math.PI * 2); c.stroke();
  c.strokeStyle = '#126cfa'; c.beginPath(); c.arc(56, 56, 39, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress / 100); c.stroke();
}

function buildPins() {
  const pins = $('scene-pins');
  pins.replaceChildren(...snapshot.agents.map((s) => {
    const button = element('button', 'scene-pin');
    button.dataset.agent = s.id;
    button.setAttribute('aria-label', '选择' + s.name);
    const text = element('span');
    text.append(element('strong', '', s.name), element('small', '', s.zone));
    button.append(icon(s.icon), text);
    button.onclick = () => selectAgent(s.id);
    return button;
  }));
}

function renderDetails() {
  const s = selected();
  $('detail-icon').src = './demo-icons/' + s.icon + '.svg';
  $('detail-agent-icon').src = './demo-icons/' + s.icon + '.svg';
  $('detail-code').textContent = '任务 ' + s.code;
  $('detail-badge').textContent = statusLabel(s);
  $('detail-badge').classList.toggle('done', s.status === 'done');
  $('detail-task-title').textContent = s.title;
  $('detail-project').textContent = snapshot.scenario === 'search' ? 'Task Board' : 'API Workspace';
  $('detail-role').textContent = s.role;
  $('detail-type').textContent = snapshot.scenario === 'review' && s.parentId ? '只读审阅' : TYPES[s.id];
  $('detail-progress-label').textContent = s.report ? '任务已完成，汇报已就绪' : s.reportPreview;
  $('detail-progress-fill').style.width = s.progress + '%';
  $('detail-percent').textContent = s.progress + '%';
  $('detail-zone').textContent = s.zone;
  $('detail-file').textContent = s.file;
  $('detail-parent').textContent = s.parentId ? '主 Agent → 子 Agent' : '统筹 3 位子 Agent';
  $('detail-name').textContent = s.name;
  $('detail-stage').textContent = snapshot.complete ? '协作已完成' : STAGES[snapshot.stage];
  $('view-report').replaceChildren(document.createTextNode(s.report ? '查看汇报全文' : '查看任务详情'), icon('arrow-right'));
  $('current-task-code').textContent = s.code;
  $('current-task-agent').textContent = s.name + ' · ' + s.zone.split(' · ')[0];
  $('current-task-description').textContent = s.title;
  $('current-task-icon').src = './demo-icons/' + s.icon + '.svg';
  $('current-progress-fill').style.width = s.progress + '%';
}

function matches(s) {
  return !query || [s.name, s.role, s.zone, s.task, s.file, s.code, s.title].join(' ').toLowerCase().includes(query.toLowerCase());
}

function renderQueue() {
  const filtered = snapshot.agents.filter((s) => s.id !== selectedId && matches(s));
  const signature = JSON.stringify([snapshot.scenario, selectedId, query, filtered.map((s) => [s.id, s.status, s.progress])]);
  if (signature === queueSignature) return;
  queueSignature = signature;
  $('queue-heading').textContent = (query ? '匹配任务' : '团队任务') + ' (' + filtered.length + ')';
  const queue = $('task-queue'); queue.replaceChildren();
  for (const s of filtered) {
    const button = element('button', 'queue-item');
    button.setAttribute('aria-label', '查看' + s.name + '任务');
    button.append(element('strong', '', s.code), element('span', '', s.zone.split(' · ')[0]),
      element('span', 'queue-status ' + (s.status === 'done' ? 'done' : s.status === 'unknown' ? '' : 'running'), statusLabel(s)));
    button.onclick = () => selectAgent(s.id);
    queue.append(button);
  }
  if (!filtered.length) queue.append(element('div', 'queue-empty', '没有匹配的任务'));
}

function renderSearch() {
  const results = $('search-result-list'); results.replaceChildren();
  const filtered = query ? snapshot.agents.filter(matches) : [];
  for (const s of filtered) {
    const button = element('button', 'search-result');
    button.type = 'button'; button.dataset.value = s.id;
    const text = element('span');
    text.append(element('strong', '', s.name + ' · ' + s.title), element('small', '', s.file));
    button.append(icon(s.icon), text);
    button.onclick = () => { selectAgent(s.id); $('task-search').focus(); searchNavigation.close(); };
    results.append(button);
  }
  searchNavigation.refresh();
}

function renderNotifications() {
  const list = $('notification-list'); list.replaceChildren();
  const events = snapshot.events.slice(-5).reverse();
  for (const e of events) {
    const item = element('div', 'notification-item',
      e.type === 'assign' ? '主 Agent 分配任务给 ' + names[e.targetId] : names[e.sessionId] + ' 提交了' + (e.sessionId === 'main' ? '最终总结' : '任务汇报'));
    item.append(element('small', '', '演示时间 ' + clock(e.at)));
    list.append(item);
  }
  if (!events.length) list.append(element('div', 'empty', '演示开始后，协作事件将在这里出现。'));
}

function showText(title, text, iconName = selected().icon) {
  closeOfficeControls();
  $('dialog-title').textContent = title;
  $('dialog-content').textContent = text;
  $('dialog-icon').src = './demo-icons/' + iconName + '.svg';
  $('copy-demo-report').textContent = '复制内容';
  if (!$('demo-dialog').open) $('demo-dialog').showModal();
}

function showSelectedTask() {
  const s = selected();
  if (s.report) showText(s.name + ' · ' + (s.id === 'main' ? '最终总结' : '任务汇报'), s.report);
  else showText(s.name + ' · 任务详情', [
    '任务：' + s.title, '任务编号：' + s.code, '工作区域：' + s.zone, '相关文件：' + s.file,
    '', s.task, '', '当前状态：' + statusLabel(s) + ' · ' + s.progress + '%',
    '', '完成后将在这里显示完整汇报。', '', '这是独立演示内容，没有读取或执行你的真实任务。',
  ].join('\n'));
  dialogSignature = s.id + ':' + !!s.report + ':' + snapshot.scenario;
}

function render() {
  snapshot = viewSnapshot();
  const reset = snapshot.seconds < lastSeconds || snapshot.scenario !== lastScenario;
  if (reset) {
    seen = new Set(snapshot.events.map((e) => e.id));
    $('demo-dialog').close(); dialogSignature = '';
    if (scene) for (const p of scene.people.values()) {
      p.path = []; p.mode = 'work'; p.reportUntil = null; p.x = p.desk.seat.x; p.y = p.desk.seat.y;
    }
  }
  $('workspace-name').textContent = snapshot.config.project;
  $('workflow-subtitle').textContent = snapshot.config.title + ' · 模拟协作流程';
  $('metric-active').textContent = snapshot.active;
  $('metric-assigned').textContent = snapshot.assigned;
  $('metric-reports').textContent = snapshot.received;
  $('metric-progress').textContent = snapshot.progress + '%';
  $('active-hint').textContent = snapshot.complete ? '任务完成' : snapshot.active > 1 ? '并行协作' : '协调中';
  $('assigned-hint').textContent = snapshot.assigned === 3 ? '分工已就绪' : '正在拆分';
  $('report-hint').textContent = snapshot.received === 3 ? '汇报已收齐' : snapshot.received ? '正在收集' : '等待结果';
  $('stage-caption').textContent = snapshot.complete ? '协作演示已完成' : '正在' + STAGES[snapshot.stage];
  $('demo-clock').textContent = clock(snapshot.seconds);
  $('play-label').textContent = player.playing ? '暂停演示' : snapshot.complete ? '重新播放' : '播放演示';
  $('toggle-play').setAttribute('aria-label', player.playing ? '暂停演示' : '播放演示');
  $('toggle-play').title = $('play-label').textContent;
  $('play-icon').src = './demo-icons/' + (player.playing ? 'pause-fill' : 'play-fill') + '.svg';
  $('stage-track-fill').style.width = Math.min(100, snapshot.seconds / DURATION * 100) + '%';
  $('stage-0-description').textContent = snapshot.assigned + ' / 3 已分配';
  $('stage-1-description').textContent = snapshot.agents.slice(1).filter((s) => s.status === 'tool').length + ' 位正在执行';
  $('stage-2-description').textContent = snapshot.received + ' / 3 已汇报';
  $('stage-3-description').textContent = snapshot.complete ? '总结已就绪' : snapshot.stage === 3 ? '正在整理结论' : '等待汇报收齐';
  for (const button of document.querySelectorAll('.stage')) {
    const index = Number(button.dataset.stage);
    button.classList.toggle('active', index === snapshot.stage);
    button.classList.toggle('completed', index < snapshot.stage || snapshot.complete);
    button.setAttribute('aria-pressed', index === snapshot.stage);
    button.title = '预览' + STAGES[index] + '阶段';
    button.querySelector('em').textContent = index === snapshot.stage ? snapshot.complete ? '已完成' : player.playing ? '进行中' : '演示已暂停' : '';
  }
  drawRing(snapshot.progress);
  renderDetails(); renderQueue(); renderNotifications();
  for (const pin of $('scene-pins').children) {
    pin.classList.toggle('selected', pin.dataset.agent === selectedId);
    pin.classList.toggle('done', snapshot.agents.find((s) => s.id === pin.dataset.agent)?.status === 'done');
  }
  if (scene) {
    scene.setTeam(snapshot.agents, 'main');
    scene.select(selectedId);
    scene.playing = player.playing;
    if (!reset) for (const event of snapshot.events) if (!seen.has(event.id)) scene.animateEvent(event);
  }
  seen = new Set(snapshot.events.map((e) => e.id));
  lastSeconds = snapshot.seconds; lastScenario = snapshot.scenario;
  if ($('demo-dialog').open && dialogSignature) {
    const s = selected();
    const signature = s.id + ':' + !!s.report + ':' + snapshot.scenario;
    if (signature !== dialogSignature) showSelectedTask();
  }
}

$('close-details').onclick = () => openDetails(false);
$('open-details').onclick = () => openDetails(true);
$('view-report').onclick = showSelectedTask;
$('current-task-button').onclick = () => { openDetails(true); showSelectedTask(); };
$('close-demo-dialog').onclick = () => $('demo-dialog').close();
$('copy-demo-report').onclick = async () => {
  try { await navigator.clipboard.writeText($('dialog-content').textContent); $('copy-demo-report').textContent = '已复制'; }
  catch { toast('复制未完成，请手动选择正文。'); }
};
$('toggle-play').onclick = () => player.play();
$('mode-toggle').onclick = () => { location.href = officePage(true, sourceKind); };
$('restart-demo').onclick = () => { player.restart(); toast('演示已从任务分配重新开始'); };
$('reset-demo-camera').onclick = () => scene?.resetCamera();
$('scenario').onchange = (e) => {
  query = ''; $('task-search').value = ''; renderSearch(); player.setScenario(e.target.value);
};
$('task-search').oninput = (e) => { query = e.target.value.trim(); queueSignature = ''; renderQueue(); renderSearch(); };
$('task-search').onfocus = () => renderSearch();
$('clear-search').onclick = () => { query = ''; $('task-search').value = ''; renderQueue(); renderSearch(); $('task-search').focus(); };
$('notifications-button').onclick = () => {
  const show = $('notifications').hidden;
  $('notifications').hidden = !show;
  $('notifications-button').setAttribute('aria-expanded', show);
};
$('show-team').onclick = () => {
  dialogSignature = '';
  showText('团队任务 · ' + snapshot.config.title, snapshot.agents.map((s) => s.name + '  /  ' + s.zone + '\n' + s.task + '\n状态：' + statusLabel(s) + ' · ' + s.progress + '%').join('\n\n'), 'people-fill');
};
$('dock-toggle').onclick = () => {
  const expanded = $('workflow-dock').classList.toggle('expanded');
  $('dock-toggle').setAttribute('aria-expanded', expanded);
};
for (const button of document.querySelectorAll('.stage')) button.onclick = () => {
  player.seconds = [2, 16, 32, 42][Number(button.dataset.stage)];
  player.playing = false; player.changed();
  toast('正在预览：' + STAGES[Number(button.dataset.stage)]);
};
$('demo-reduced').checked = matchMedia('(prefers-reduced-motion: reduce)').matches;
document.body.dataset.reducedMotion = String($('demo-reduced').checked);
$('demo-reduced').onchange = (e) => { document.body.dataset.reducedMotion = String(e.target.checked); scene?.setReduced(e.target.checked); };
document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !$('demo-dialog').open) {
    e.preventDefault(); $('task-search').focus();
  }
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('#notifications') && !e.target.closest('#notifications-button')) {
    $('notifications').hidden = true; $('notifications-button').setAttribute('aria-expanded', 'false');
  }
});
document.addEventListener('visibilitychange', () => { lastTime = performance.now(); if (scene) scene.visible = !document.hidden && !scene.loadError; });

buildPins(); openDetails(detailsOpen); render();
try {
  scene = new DemoScene($('demo-scene'), { source: sourceKind, onSelect: (id) => selectAgent(id), reduced: $('demo-reduced').checked, pins: $('scene-pins') });
  scene.setTeam(snapshot.agents, 'main'); scene.select(selectedId);
  scene.ready.then((ready) => {
    $('scene-loading').hidden = ready;
    document.body.dataset.demoReady = ready ? 'true' : 'fallback';
    if (!ready) { $('scene-loading').textContent = '3D 暂不可用，任务详情与流程演示仍可使用。'; scene.visible = false; }
  });
} catch {
  $('scene-loading').textContent = '3D 暂不可用，任务详情与流程演示仍可使用。';
  document.body.dataset.demoReady = 'fallback';
}
player.addEventListener('change', render);
const timer = setInterval(() => {
  const now = performance.now(), delta = Math.min(.5, (now - lastTime) / 1000);
  lastTime = now;
  if (!document.hidden) player.advance(delta);
}, 250);
window.addEventListener('beforeunload', () => { clearInterval(timer); clearTimeout(toastTimer); scenarioPicker.destroy(); searchNavigation.destroy(); scene?.destroy(); });
}
