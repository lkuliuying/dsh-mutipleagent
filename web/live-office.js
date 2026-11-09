import { DemoScene } from './demo-scene.js';
import { LiveSource } from './live-source.mjs';
import { applyOfficeBrand, officePage } from './base-url.mjs';
import { directoryGroups, directorySessions, sessionLabel } from './session-selection.mjs';
import { enhanceSelect, bindSearchNavigation, closeOfficeControls } from './office-controls.js';

export function startLiveOffice() {
  const $ = id => document.getElementById(id);
  const node = (tag, cls, text) => {
    const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n;
  };
  const icon = name => { const n = node('img'); n.src = './demo-icons/' + name + '.svg'; n.alt = ''; return n; };
  const stages = ['分析与分配', '并行执行', '结果汇报', '主 Agent 总结'];
  const labels = { done: '已完成', unknown: '未知', waiting_agents: '等待汇报', waiting: '等待处理', idle: '空闲',
    error: '执行出错', interrupted: '已中断', closed: '已关闭', thinking: '处理中', typing: '输出中', tool: '执行中' };
  const types = { assign: '分配任务', message: '追加消息', wait: '等待汇报', report: '提交汇报', complete: '任务完成',
    tool: '工具活动', progress: '进展消息', task: '任务原文', approval: '等待确认', close: '关闭 Agent',
    error: '执行出错', interrupted: '任务中断', closed: '关闭 Agent' };
  const source = new LiveSource(new URLSearchParams(location.search).get('rootId'));
  const host = () => source.kind === 'harness' ? 'DeepSeek Harness' : 'Codex';
  const empty = { id: '', icon: 'diagram-3-fill', name: '未选择 Agent', title: '等待会话日志', code: '—',
    zone: '未记录', file: '未记录', role: '未记录', status: 'unknown', progress: null };
  let data = source.snapshot, selectedId = null, scene = null, capacity = 0, query = '', history = false, brandSource = null;
  let seen = new Set(), lastRoot = null, pinSignature = '', queueSignature = '', rootSignature = '', eventSignature = '';
  let toastTimer, recordToken = 0, sceneFailed = false;
  const directoryPicker = enhanceSelect($('workspace-directory')), scenarioPicker = enhanceSelect($('scenario'));
  let teamDirectoryPicker = null;
  const searchNavigation = bindSearchNavigation({ input: $('task-search'), form: $('search-form'),
    results: $('search-results'), list: $('search-result-list'), status: $('search-status'), clear: $('clear-search'),
    onClear: () => $('clear-search').click(), onOpen: search });
  let pendingAnimations = [];
  const agents = () => data.agents.filter(s => history || !s.historical);
  const selected = () => data.agents.find(s => s.id === selectedId) || agents()[0] || empty;
  const visibleRoots = () => source.kind === 'harness' ? directorySessions(data.roots, source.directoryKey) : data.roots;
  const name = id => data.agents.find(s => s.id === id)?.name || 'Agent ' + (id || '').slice(-8);
  const status = s => labels[s.status] || '未知';
  const matches = s => !query || [s.name, s.task, s.role, s.file, s.id, s.zone].join(' ').toLowerCase().includes(query.toLowerCase());
  const clock = seconds => {
    const value = Math.max(0, Math.floor(seconds));
    return (value >= 3600 ? String(Math.floor(value / 3600)).padStart(2, '0') + ':' : '') +
      String(Math.floor(value / 60) % 60).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
  };
  function toast(text) {
    clearTimeout(toastTimer); $('demo-toast').textContent = text; $('demo-toast').hidden = false;
    toastTimer = setTimeout(() => { $('demo-toast').hidden = true; }, 3000);
  }
  function details(open) { $('agent-details').hidden = !open; $('open-details').hidden = open; }
  function select(id, focus = true) {
    selectedId = id; recordToken++; details(true); render(); scene?.select(id, focus);
  }
  function showText(title, text, image = selected().icon) {
    closeOfficeControls(); teamDirectoryPicker?.destroy(); teamDirectoryPicker = null;
    $('dialog-title').textContent = title; $('dialog-content').textContent = text;
    $('dialog-icon').src = './demo-icons/' + image + '.svg'; $('copy-demo-report').textContent = '复制内容';
    if (!$('demo-dialog').open) $('demo-dialog').showModal();
  }
  async function record(title, sessionId, eventId) {
    const token = ++recordToken; showText(title, '正在读取原始记录…');
    try {
      const text = await source.record(sessionId, eventId);
      if (token === recordToken && $('demo-dialog').open) showText(title, text);
    } catch (error) {
      if (token === recordToken && $('demo-dialog').open) showText(title, '读取失败：' + error.message);
    }
  }
  function showTask(taskOnly = false) {
    const s = selected();
    if (!taskOnly && (s.hasReport || s.historical && s.reportEventId)) return record(s.name + (s.historical ? ' · 历史汇报全文' : ' · 汇报全文'), s.id, s.reportEventId);
    if (s.taskEventId) return record(s.name + ' · 任务原文', s.taskSessionId || s.id, s.taskEventId);
    showText(s.name + ' · 任务详情', s.task || '日志未记录任务正文');
  }
  function teamPicker() {
    recordToken++; showText('选择团队与会话', '', 'people-fill');
    const content = $('dialog-content');
    content.append(node('strong', '', '当前团队'));
    for (const s of data.agents) {
      const button = node('button', 'session-choice', s.name + ' · ' + status(s) + (s.historical ? ' · 历史成员' : '') + '\n' + s.title);
      button.onclick = () => { if (s.historical) history = true; $('demo-dialog').close(); select(s.id); };
      content.append(button);
    }
    if (source.kind === 'harness') {
      const field = node('label', 'session-picker-field'), selector = node('select');
      selector.id = 'team-workspace-directory'; field.htmlFor = selector.id;
      field.append(node('span', '', '工作目录'), selector);
      selector.setAttribute('aria-label', '团队窗口工作目录');
      fillDirectories(selector);
      selector.onchange = event => { source.selectDirectory(event.target.value); teamPicker(); };
      content.append(field);
      teamDirectoryPicker = enhanceSelect(selector);
    }
    content.append(node('strong', '', source.kind === 'harness' ? '当前目录的会话' : '主会话'));
    for (const root of visibleRoots()) {
      const button = node('button', 'session-choice', source.kind === 'harness' ? sessionLabel(root) : root.title || root.id);
      button.setAttribute('aria-pressed', root.id === data.rootId);
      button.onclick = () => { $('demo-dialog').close(); query = ''; $('task-search').value = ''; search(); source.select(root.id); };
      content.append(button);
    }
  }
  function progress(id, value) {
    $(id).style.width = value == null ? '0%' : value + '%';
    $(id).parentElement.classList.toggle('unrecorded', value == null);
  }
  function renderDetails() {
    const s = selected();
    const hasReport = s.hasReport || s.historical && s.reportEventId;
    $('detail-icon').src = $('detail-agent-icon').src = './demo-icons/' + s.icon + '.svg';
    $('detail-code').textContent = s.code; $('detail-badge').textContent = status(s);
    $('detail-badge').classList.toggle('done', s.status === 'done');
    $('detail-task-title').textContent = s.title; $('detail-task-title').title = s.task || s.title;
    $('detail-project').textContent = data.config.project; $('detail-role').textContent = s.role;
    $('detail-type').textContent = s.historical ? '历史成员' : s.parentId ? '真实子任务' : '主任务';
    $('detail-progress-label').textContent = s.reportPreview || '等待日志';
    progress('detail-progress-fill', s.progress); progress('current-progress-fill', s.progress);
    $('detail-percent').textContent = s.progress == null ? '未记录' : s.progress + '%';
    $('detail-zone').textContent = s.zone; $('detail-file').textContent = s.file;
    $('detail-file').title = s.source?.activity || s.file;
    $('detail-parent').textContent = s.parentId ? name(s.parentId) + ' → ' + s.name : '统筹 ' + data.assigned + ' 位本轮成员';
    $('detail-name').textContent = s.name; $('detail-stage').textContent = data.complete ? '协作已完成' : stages[data.stage];
    $('view-report').replaceChildren(document.createTextNode(hasReport ? '查看汇报全文' : '查看任务详情'), icon('arrow-right'));
    $('view-report').disabled = !s.id; $('view-task').hidden = !hasReport;
    $('current-task-code').textContent = s.code; $('current-task-agent').textContent = s.name + ' · ' + s.zone.split(' · ')[0];
    $('current-task-description').textContent = s.title; $('current-task-icon').src = './demo-icons/' + s.icon + '.svg';
  }
  function renderQueue() {
    const list = agents().filter(s => s.id !== selectedId && matches(s));
    const signature = JSON.stringify([selectedId, query, list.map(s => [s.id, s.name, s.status, s.title])]);
    if (signature === queueSignature) return;
    queueSignature = signature; $('queue-heading').textContent = (query ? '匹配任务' : '团队任务') + ' (' + list.length + ')';
    $('task-queue').replaceChildren(...list.map(s => {
      const button = node('button', 'queue-item'); button.setAttribute('aria-label', '查看' + s.name + '任务');
      button.title = s.name + ' · ' + s.title;
      button.append(node('strong', '', s.name), node('span', '', s.zone.split(' · ')[0]),
        node('span', 'queue-status ' + (s.status === 'done' ? 'done' : 'running'), status(s)));
      button.onclick = () => select(s.id); return button;
    }));
    if (!list.length) $('task-queue').append(node('div', 'queue-empty', '没有匹配的任务'));
  }
  function search() {
    const results = $('search-result-list'); results.replaceChildren();
    for (const s of query ? agents().filter(matches) : []) {
      const button = node('button', 'search-result'), text = node('span');
      button.type = 'button'; button.dataset.value = s.id;
      text.append(node('strong', '', s.name + ' · ' + s.title), node('small', '', s.file)); button.append(icon(s.icon), text);
      button.onclick = () => { select(s.id); $('task-search').focus(); searchNavigation.close(); }; results.append(button);
    }
    searchNavigation.refresh();
  }
  function renderEvents() {
    const events = data.events.slice(-40).reverse(), signature = JSON.stringify(events);
    if (signature === eventSignature) return;
    eventSignature = signature;
    $('notification-list').replaceChildren(...events.map(event => {
      const button = node('button', 'notification-item');
      button.append(node('span', '', name(event.sessionId) + ' · ' + (types[event.type] || event.type)),
        node('span', 'event-preview', event.preview || (event.targetId ? '→ ' + name(event.targetId) : '')),
        node('small', '', new Date(event.at).toLocaleTimeString('zh-CN', { hour12: false })));
      button.onclick = () => {
        const id = ['assign', 'message'].includes(event.type) ? event.targetId || event.sessionId : event.sessionId;
        const agent = data.agents.find(s => s.id === id);
        if (agent) { if (agent.historical) history = true; select(id); }
        if (event.hasText) record(name(event.sessionId) + ' · ' + (types[event.type] || event.type), event.sessionId, event.id);
      }; return button;
    }));
    if (!events.length) $('notification-list').append(node('div', 'empty', '等待真实协作事件。'));
  }
  function renderRoots() {
    const signature = JSON.stringify([source.kind, source.directoryKey, data.rootId, data.roots]);
    if (signature === rootSignature) return;
    rootSignature = signature;
    const harness = source.kind === 'harness';
    $('directory-field').hidden = !harness;
    $('directory-field').parentElement.classList.toggle('harness-picker', harness);
    if (harness) {
      fillDirectories($('workspace-directory'));
      if (teamDirectoryPicker) { fillDirectories($('team-workspace-directory')); teamDirectoryPicker.refresh(); }
    }
    const roots = visibleRoots();
    $('scenario').replaceChildren(...roots.map(root => {
      const option = node('option', '', harness ? sessionLabel(root) : root.title || root.id); option.value = root.id;
      option.dataset.label = root.title?.replace(/\s+/g, ' ').trim() || '未命名会话';
      option.dataset.description = sessionLabel(root).split(' · ').slice(-2).join(' · ');
      option.dataset.search = [root.title, sessionLabel(root), root.id].join(' '); return option;
    }));
    if (!roots.length) {
      const option = node('option', '', '尚未发现 ' + host() + ' 会话'); option.value = ''; $('scenario').append(option);
    }
    $('scenario').value = data.rootId || '';
    $('scenario').disabled = !roots.length;
    $('scenario').title = $('scenario').selectedOptions[0]?.textContent || '';
    scenarioPicker.refresh();
  }
  function fillDirectories(selector) {
    const groups = directoryGroups(data.roots);
    selector.replaceChildren(...groups.map(group => {
      const option = node('option', '', group.path + ' (' + group.count + ')'); option.value = group.key;
      option.dataset.label = group.path; option.dataset.description = group.count + ' 个会话'; return option;
    }));
    if (!groups.length) { const option = node('option', '', '尚未发现工作目录'); option.value = ''; selector.append(option); }
    selector.disabled = !groups.length;
    selector.value = groups.length ? source.directoryKey ?? '' : '';
    selector.title = groups.find(group => group.key === source.directoryKey)?.path || '';
    if (selector === $('workspace-directory')) directoryPicker.refresh();
  }
  function renderPins() {
    const signature = JSON.stringify(agents().map(s => [s.id, s.name, s.zone]));
    if (signature !== pinSignature) {
      pinSignature = signature;
      $('scene-pins').replaceChildren(...agents().map(s => {
        const button = node('button', 'scene-pin'), text = node('span');
        button.dataset.agent = s.id; button.setAttribute('aria-label', '选择' + s.name);
        text.append(node('strong', '', s.name), node('small', '', s.zone)); button.append(icon(s.icon), text);
        button.onclick = () => select(s.id); return button;
      }));
    }
    for (const pin of $('scene-pins').children) {
      pin.classList.toggle('selected', pin.dataset.agent === selectedId);
      pin.classList.toggle('done', data.agents.find(s => s.id === pin.dataset.agent)?.status === 'done');
    }
  }
  function ensureScene() {
    if (sceneFailed) return;
    const count = Math.max(4, ...agents().map(s => s.slot + 1));
    if (scene && count <= capacity) return;
    scene?.destroy(); scene = null; capacity = count;
    try {
      const instance = scene = new DemoScene($('demo-scene'), { count, live: true, source: source.kind, onSelect: select,
        reduced: $('demo-reduced').checked, pins: $('scene-pins') });
      instance.setTeam(agents(), data.rootId); instance.select(selectedId);
      instance.ready.then(ready => {
        if (scene !== instance) return;
        $('scene-loading').hidden = ready; document.body.dataset.demoReady = ready ? 'true' : 'fallback';
        if (!ready) { $('scene-loading').textContent = '3D 暂不可用，任务列表与详情仍可使用。'; instance.visible = false; }
        // 扩容加载模型期间只暂存新事件；正文和状态已经由快照立即显示。
        if (ready) for (const event of pendingAnimations) instance.animateEvent(event);
        pendingAnimations = [];
      });
    } catch (error) {
      sceneFailed = true;
      $('scene-loading').hidden = false; $('scene-loading').textContent = '3D 暂不可用，任务列表与详情仍可使用。';
      document.body.dataset.demoReady = 'fallback'; console.error('协作场景加载失败', error);
    }
  }
  function render({ baseline = false } = {}) {
    data = source.snapshot;
    if (brandSource !== source.kind) {
      brandSource = source.kind;
      applyOfficeBrand(source.kind, true);
      $('detail-disclaimer').textContent = '只读真实记录 · 在 ' + host() + ' 中执行任务';
      $('toggle-play').title = source.kind === 'harness' ? '只跟随当前工作目录的新会话；不控制任务执行' : '是否自动跟随新建主会话；不控制 Codex 执行';
      $('team-picker').textContent = source.kind === 'harness' ? '会话 / 团队' : '团队';
    }
    if (data.rootId !== lastRoot) { selectedId = data.rootId; baseline = true; recordToken++; $('demo-dialog').close(); }
    if (!agents().some(s => s.id === selectedId)) selectedId = agents()[0]?.id || null;
    if (baseline) { seen = new Set(data.events.map(e => e.id)); pendingAnimations = []; }
    $('workspace-name').textContent = source.kind === 'harness' ? '会话' : data.config.project;
    $('workflow-subtitle').textContent = data.config.title + ' · 真实日志'; $('workflow-subtitle').title = data.config.title;
    $('metric-active').textContent = data.active; $('metric-assigned').textContent = data.assigned; $('metric-reports').textContent = data.received;
    $('metric-progress').textContent = data.progress == null ? '—' : data.progress + '%';
    $('active-hint').textContent = data.complete ? '任务完成' : data.active > 1 ? '并行协作' : '协调中';
    $('assigned-hint').textContent = '真实分工';
    $('report-hint').textContent = data.received && data.received === data.assigned ? '汇报已收齐' : data.received ? '正在收集' : '等待结果';
    $('stage-caption').textContent = data.complete ? '协作已完成' : '日志未提供百分比';
    $('demo-clock').textContent = data.elapsedKnown ? clock(data.seconds) : '—';
    $('team-count-caption').textContent = '主 Agent + ' + data.assigned + ' 位本轮成员';
    $('assigned-caption').textContent = '包含嵌套协作任务';
    $('mode-label').textContent = source.connection === 'connected' ? '真实会话' : source.connection === 'connecting' ? '连接中' : '连接中断';
    $('mode-toggle').classList.toggle('disconnected', source.connection !== 'connected');
    $('profile-caption').textContent = source.error || (source.kind === 'harness' ? 'Harness 会话 · 只读观察' : '本机日志 · 只读观察'); $('profile-caption').title = source.error || '约每秒更新，不控制 ' + host() + ' 执行';
    $('source-status').hidden = !source.error && !data.warnings.length; $('source-status').textContent = [source.error, ...data.warnings].filter(Boolean).join('；');
    $('play-label').textContent = source.follow ? source.kind === 'harness' ? '跟随本目录新会话' : '跟随新会话' : '固定当前会话'; $('toggle-play').setAttribute('aria-label', $('play-label').textContent);
    $('history-toggle').textContent = (history ? '隐藏' : '查看') + '历史成员 (' + data.agents.filter(s => s.historical).length + ')';
    $('stage-track-fill').style.width = (data.complete ? 100 : data.stage / 3 * 100) + '%';
    $('stage-0-description').textContent = data.assigned + ' 项真实子任务';
    $('stage-1-description').textContent = agents().filter(s => s.id !== data.rootId && ['tool', 'thinking', 'typing'].includes(s.status)).length + ' 位正在执行';
    $('stage-2-description').textContent = data.received + ' / ' + data.assigned + ' 已汇报';
    $('stage-3-description').textContent = data.complete ? '总结已就绪' : data.stage === 3 ? '正在整理结论' : '等待主 Agent';
    for (const button of document.querySelectorAll('.stage')) {
      const index = Number(button.dataset.stage); button.classList.toggle('active', index === data.stage);
      button.classList.toggle('completed', index < data.stage || data.complete); button.setAttribute('aria-pressed', index === data.stage);
      button.querySelector('em').textContent = index === data.stage ? data.complete ? '已完成' : '进行中' : '';
    }
    const c = $('progress-ring').getContext('2d'); c.clearRect(0, 0, 112, 112); c.lineWidth = 15; c.lineCap = 'round';
    c.strokeStyle = data.complete ? '#126cfa' : '#e5edfc'; c.beginPath(); c.arc(56, 56, 39, 0, Math.PI * 2); c.stroke();
    renderRoots(); renderPins(); renderDetails(); renderQueue(); renderEvents();
    if (query && !$('search-results').hidden) search();
    ensureScene();
    if (scene) {
      scene.setTeam(agents(), data.rootId); scene.select(selectedId); scene.playing = true;
      if (!baseline) for (const event of data.events) if (!seen.has(event.id)) {
        if (scene.loaded) scene.animateEvent(event); else pendingAnimations.push(event);
      }
    }
    seen = new Set(data.events.map(e => e.id)); lastRoot = data.rootId;
  }

  document.body.dataset.mode = 'live'; document.title = 'Codex Office · 实时协作';
  $('task-search').setAttribute('aria-label', '搜索真实团队任务'); $('scenario').setAttribute('aria-label', '选择真实主会话');
  $('metric-progress-title').textContent = '主任务进度'; $('event-mode').textContent = '真实日志';
  $('detail-activity-label').textContent = '活动 / 模型';
  $('detail-disclaimer').textContent = '只读真实日志 · 在 Codex 中执行任务';
  $('dialog-mode').textContent = 'CODEX OFFICE / LIVE'; $('dialog-caption').textContent = '本机日志原文 · 未调用模型生成摘要';
  $('mode-toggle').title = '切换到模拟演示'; $('mode-toggle').setAttribute('aria-label', '真实会话，点击切换到模拟演示');
  $('mode-toggle').onclick = () => { location.href = officePage(false, source.kind); };
  $('restart-demo').title = '重新连接日志流'; $('restart-demo').setAttribute('aria-label', '重新连接日志流');
  $('play-icon').src = './demo-icons/crosshair.svg'; $('toggle-play').title = '是否自动跟随新建主会话；不控制 Codex 执行';
  $('history-toggle').hidden = $('team-picker').hidden = false;
  $('close-details').onclick = () => details(false); $('open-details').onclick = () => details(true);
  $('view-report').onclick = () => showTask(); $('view-task').onclick = () => showTask(true);
  $('current-task-button').onclick = () => { details(true); showTask(); };
  $('close-demo-dialog').onclick = () => { recordToken++; $('demo-dialog').close(); };
  $('demo-dialog').addEventListener('close', () => {
    if (!$('demo-dialog').open) { teamDirectoryPicker?.destroy(); teamDirectoryPicker = null; }
  });
  $('copy-demo-report').onclick = async () => {
    try { await navigator.clipboard.writeText($('dialog-content').textContent); $('copy-demo-report').textContent = '已复制'; }
    catch { toast('复制未完成，请手动选择正文。'); }
  };
  $('toggle-play').onclick = () => { source.follow = !source.follow; render(); toast(source.follow ? source.kind === 'harness' ? '仅跟随当前工作目录的新会话' : '自动跟随新建主会话；当前会话继续实时更新' : '固定观察当前会话；日志继续实时更新'); };
  $('restart-demo').onclick = () => { source.connect(); toast('重新连接只读日志流'); };
  $('reset-demo-camera').onclick = () => scene?.resetCamera();
  $('history-toggle').onclick = () => { history = !history; render({ baseline: true }); };
  $('scenario').onchange = event => { query = ''; $('task-search').value = ''; search(); source.select(event.target.value); };
  $('workspace-directory').onchange = event => { query = ''; $('task-search').value = ''; search(); source.selectDirectory(event.target.value); };
  $('task-search').oninput = event => { query = event.target.value.trim(); renderQueue(); search(); };
  $('task-search').onfocus = search;
  $('clear-search').onclick = () => { query = ''; $('task-search').value = ''; renderQueue(); search(); $('task-search').focus(); };
  $('notifications-button').onclick = () => { const show = $('notifications').hidden; $('notifications').hidden = !show; $('notifications-button').setAttribute('aria-expanded', show); };
  $('show-team').onclick = $('team-picker').onclick = teamPicker;
  $('dock-toggle').onclick = () => { const expanded = $('workflow-dock').classList.toggle('expanded'); $('dock-toggle').setAttribute('aria-expanded', expanded); };
  for (const button of document.querySelectorAll('.stage')) button.onclick = () => toast('当前记录阶段：' + stages[data.stage] + '；任务由 ' + host() + ' 执行');
  $('demo-reduced').checked = localStorage.getItem('office.demo.reduced') === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.body.dataset.reducedMotion = String($('demo-reduced').checked);
  $('demo-reduced').onchange = event => { localStorage.setItem('office.demo.reduced', event.target.checked); document.body.dataset.reducedMotion = String(event.target.checked); scene?.setReduced(event.target.checked); };
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !$('demo-dialog').open) { event.preventDefault(); $('task-search').focus(); }
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('#notifications') && !event.target.closest('#notifications-button')) { $('notifications').hidden = true; $('notifications-button').setAttribute('aria-expanded', 'false'); }
  });
  document.addEventListener('visibilitychange', () => { if (scene) scene.visible = !document.hidden && !scene.loadError; });
  details(innerWidth > 1050 && innerHeight > 820); render({ baseline: true });
  source.addEventListener('change', event => render(event.detail)); source.connect();
  const timer = setInterval(() => { if (!document.hidden) render(); }, 1000);
  window.addEventListener('beforeunload', () => { clearInterval(timer); clearTimeout(toastTimer); directoryPicker.destroy(); scenarioPicker.destroy(); teamDirectoryPicker?.destroy(); searchNavigation.destroy(); source.destroy(); scene?.destroy(); });
}
