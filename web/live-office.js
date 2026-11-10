import { DemoScene } from './demo-scene.js';
import { LiveSource } from './live-source.mjs';
import { applyOfficeBrand, officePage } from './base-url.mjs';
import { directoryGroups, directorySessions, sessionLabel } from './session-selection.mjs';
import { enhanceSelect, bindSearchNavigation, closeOfficeControls } from './office-controls.js';
import { createNotificationState } from './notifications.mjs';
import { eventText, locale, mountLangSwitch, onLangChange, statusText, t } from './i18n.mjs';

export function startLiveOffice() {
  const $ = id => document.getElementById(id);
  const node = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const icon = name => {
    const n = node('img');
    n.src = './demo-icons/' + name + '.svg';
    n.alt = '';
    return n;
  };
  const stages = () => [t('demo.stage.analysis'), t('demo.stage.parallel'), t('demo.stage.reports'), t('demo.stage.summary')];
  const notifyTypes = new Set(['assign', 'message', 'report', 'complete', 'approval', 'error', 'interrupted']);
  const notifyEvents = () => data.events.filter(event => notifyTypes.has(event.type));
  const source = new LiveSource(new URLSearchParams(location.search).get('rootId'));
  // 由 Harness 会话视图打开时（embed=1，rootId 已确定）锁定当前会话，不再显示工作目录选择。
  // 仅带 rootId 的普通深链保持原有行为：仍可切换目录与会话。
  const pinned = new URLSearchParams(location.search).get('embed') === '1';
  if (pinned) document.body.dataset.embed = 'true';
  const host = () => (source.kind === 'harness' ? 'DeepSeek Harness' : 'Codex');
  const empty = () => ({
    id: '',
    icon: 'diagram-3-fill',
    name: t('livePage.noAgent'),
    title: t('livePage.logWaiting'),
    code: '—',
    zone: t('common.notRecorded'),
    file: t('common.notRecorded'),
    role: t('common.notRecorded'),
    status: 'unknown',
    progress: null,
  });
  let data = source.snapshot,
    selectedId = null,
    scene = null,
    capacity = 0,
    query = '',
    history = false,
    brandSource = null;
  let seen = new Set(),
    lastRoot = null,
    pinSignature = '',
    queueSignature = '',
    rootSignature = '',
    eventSignature = '';
  let toastTimer,
    recordToken = 0,
    sceneFailed = false;
  const directoryPicker = enhanceSelect($('workspace-directory')),
    scenarioPicker = enhanceSelect($('scenario'));
  const modePicker = enhanceSelect($('mode-select'), { filterable: false });
  const modeSelect = $('mode-select');
  modeSelect.value = 'live';
  modePicker.refresh();
  const notifications = createNotificationState({
    mode: 'live',
    button: $('notifications-button'),
    dot: $('notification-dot'),
    panel: $('notifications'),
    getEvents: notifyEvents,
  });
  let teamDirectoryPicker = null;
  const searchNavigation = bindSearchNavigation({
    input: $('task-search'),
    form: $('search-form'),
    results: $('search-results'),
    list: $('search-result-list'),
    status: $('search-status'),
    clear: $('clear-search'),
    onClear: () => $('clear-search').click(),
    onOpen: search,
  });
  let pendingAnimations = [];
  const agents = () => data.agents.filter(s => history || !s.historical);
  const selected = () => data.agents.find(s => s.id === selectedId) || agents()[0] || empty();
  const visibleRoots = () => (source.kind === 'harness' ? directorySessions(data.roots, source.directoryKey) : data.roots);
  const name = id => data.agents.find(s => s.id === id)?.name || 'Agent ' + (id || '').slice(-8);
  const status = s => statusText(s.status);
  const matches = s => !query || [s.name, s.task, s.role, s.file, s.id, s.zone, s.title].join(' ').toLowerCase().includes(query.toLowerCase());
  const clock = seconds => {
    const value = Math.max(0, Math.floor(seconds));
    return (
      (value >= 3600 ? String(Math.floor(value / 3600)).padStart(2, '0') + ':' : '') +
      String(Math.floor(value / 60) % 60).padStart(2, '0') +
      ':' +
      String(value % 60).padStart(2, '0')
    );
  };
  function toast(text) {
    clearTimeout(toastTimer);
    $('demo-toast').textContent = text;
    $('demo-toast').hidden = false;
    toastTimer = setTimeout(() => {
      $('demo-toast').hidden = true;
    }, 3000);
  }
  function details(open) {
    $('agent-details').hidden = !open;
    $('open-details').hidden = open;
  }
  function select(id, focus = true) {
    selectedId = id;
    recordToken++;
    details(true);
    render();
    scene?.select(id, focus);
  }
  function showText(title, text, image = selected().icon) {
    closeOfficeControls();
    teamDirectoryPicker?.destroy();
    teamDirectoryPicker = null;
    $('dialog-title').textContent = title;
    $('dialog-content').textContent = text;
    $('dialog-icon').src = './demo-icons/' + image + '.svg';
    $('copy-demo-report').textContent = t('demo.copy');
    if (!$('demo-dialog').open) $('demo-dialog').showModal();
  }
  async function record(title, sessionId, eventId) {
    const token = ++recordToken;
    showText(title, t('dialog.loading'));
    try {
      const text = await source.record(sessionId, eventId);
      if (token === recordToken && $('demo-dialog').open) showText(title, text);
    } catch (error) {
      if (token === recordToken && $('demo-dialog').open) showText(title, t('livePage.recordFailed', { message: error.message }));
    }
  }
  function showTask(taskOnly = false) {
    const s = selected();
    if (!taskOnly && (s.hasReport || (s.historical && s.reportEventId)))
      return record(s.name + ' · ' + t(s.historical ? 'livePage.pastReportTitle' : 'livePage.reportTitle'), s.id, s.reportEventId);
    if (s.taskEventId) return record(s.name + ' · ' + t('livePage.taskSourceTitle'), s.taskSessionId || s.id, s.taskEventId);
    showText(s.name + ' · ' + t('livePage.taskDetailsTitle'), s.task || t('livePage.taskNotLogged'));
  }
  function teamPicker() {
    recordToken++;
    showText(t('livePage.chooseTeam'), '', 'people-fill');
    const content = $('dialog-content');
    content.append(node('strong', '', t('livePage.currentTeam')));
    for (const s of data.agents) {
      const button = node('button', 'session-choice', s.name + ' · ' + status(s) + (s.historical ? ' · ' + t('livePage.pastMember') : '') + '\n' + s.title);
      button.onclick = () => {
        if (s.historical) history = true;
        $('demo-dialog').close();
        select(s.id);
      };
      content.append(button);
    }
    if (source.kind === 'harness') {
      const field = node('label', 'session-picker-field'),
        selector = node('select');
      selector.id = 'team-workspace-directory';
      field.htmlFor = selector.id;
      field.append(node('span', '', t('livePage.directory')), selector);
      selector.setAttribute('aria-label', t('livePage.teamDirectoryAria'));
      fillDirectories(selector);
      selector.onchange = event => {
        source.selectDirectory(event.target.value);
        teamPicker();
      };
      content.append(field);
      teamDirectoryPicker = enhanceSelect(selector);
    }
    content.append(node('strong', '', t(source.kind === 'harness' ? 'livePage.harnessSessions' : 'livePage.mainSession')));
    for (const root of visibleRoots()) {
      const button = node('button', 'session-choice', source.kind === 'harness' ? sessionLabel(root) : root.title || root.id);
      button.setAttribute('aria-pressed', root.id === data.rootId);
      button.onclick = () => {
        $('demo-dialog').close();
        query = '';
        $('task-search').value = '';
        search();
        source.select(root.id);
      };
      content.append(button);
    }
  }
  function progress(id, value) {
    $(id).style.width = value == null ? '0%' : value + '%';
    $(id).parentElement.classList.toggle('unrecorded', value == null);
  }
  function renderDetails() {
    const s = selected();
    const hasReport = s.hasReport || (s.historical && s.reportEventId);
    $('detail-icon').src = $('detail-agent-icon').src = './demo-icons/' + s.icon + '.svg';
    $('detail-code').textContent = s.code;
    $('detail-badge').textContent = status(s);
    $('detail-badge').classList.toggle('done', s.status === 'done');
    $('detail-task-title').textContent = s.title;
    $('detail-task-title').title = s.task || s.title;
    $('detail-project').textContent = data.config.project;
    $('detail-role').textContent = s.role;
    $('detail-type').textContent = s.historical ? t('livePage.pastMember') : s.parentId ? t('livePage.subtask') : t('livePage.mainTask');
    $('detail-progress-label').textContent = s.reportPreview || t('livePage.awaitingLog');
    progress('detail-progress-fill', s.progress);
    progress('current-progress-fill', s.progress);
    $('detail-percent').textContent = s.progress == null ? t('livePage.progressUnknown') : s.progress + '%';
    $('detail-zone').textContent = s.zone;
    $('detail-file').textContent = s.file;
    $('detail-file').title = s.source?.activity || s.file;
    $('detail-parent').textContent = s.parentId ? name(s.parentId) + ' → ' + s.name : t('livePage.leadMembers', { count: data.assigned });
    $('detail-name').textContent = s.name;
    $('detail-stage').textContent = data.complete ? t('demo.stageComplete') : stages()[data.stage];
    $('view-report').replaceChildren(document.createTextNode(t(hasReport ? 'demo.viewFullReport' : 'demo.viewReport')), icon('arrow-right'));
    $('view-report').disabled = !s.id;
    $('view-task').hidden = !hasReport;
    $('view-screen').hidden = !scene?.openScreenFor || !s.id;
    $('current-task-code').textContent = s.code;
    $('current-task-agent').textContent = s.name + ' · ' + s.zone.split(' · ')[0];
    $('current-task-description').textContent = s.title;
    $('current-task-icon').src = './demo-icons/' + s.icon + '.svg';
  }
  function renderQueue() {
    const list = agents().filter(s => s.id !== selectedId && matches(s));
    const signature = JSON.stringify([selectedId, query, list.map(s => [s.id, s.name, s.status, s.title])]);
    if (signature === queueSignature) return;
    queueSignature = signature;
    $('queue-heading').textContent = t('demo.queueHeading', { label: t(query ? 'demo.matchingTasks' : 'demo.teamTasks'), count: list.length });
    $('task-queue').replaceChildren(
      ...list.map(s => {
        const button = node('button', 'queue-item');
        button.setAttribute('aria-label', t('demo.ariaViewTask', { name: s.name }));
        button.title = s.name + ' · ' + s.title;
        button.append(
          node('strong', '', s.name),
          node('span', '', s.zone.split(' · ')[0]),
          node('span', 'queue-status ' + (s.status === 'done' ? 'done' : 'running'), status(s)),
        );
        button.onclick = () => select(s.id);
        return button;
      }),
    );
    if (!list.length) $('task-queue').append(node('div', 'queue-empty', t('demo.noMatchingTasks')));
  }
  function clearQuery() {
    query = '';
    $('task-search').value = '';
    renderQueue();
  }
  let lastSearchSignature = '';
  function search() {
    const results = $('search-result-list');
    const needle = query.toLowerCase();
    const sessionHits =
      query && source.kind === 'harness' ? (data.roots || []).filter(root => [root.title, root.cwd, root.id].join(' ').toLowerCase().includes(needle)) : [];
    const agentHits = query ? agents().filter(matches) : [];
    const eventHits = query
      ? (data.events || []).filter(event => [event.type, eventText(event.type), event.preview].join(' ').toLowerCase().includes(needle))
      : [];
    const shown = Math.min(sessionHits.length, 8) + Math.min(agentHits.length, 8) + Math.min(eventHits.length, 5);
    const total = sessionHits.length + agentHits.length + eventHits.length;
    // 快照每秒刷新一次，命中集合没变时不重建列表 —— 否则按钮会在点击途中被替换，
    // 既让浏览器的点击落空，也会打断键盘焦点与屏幕阅读器的当前位置。
    const signature = JSON.stringify([
      query,
      locale(),
      total,
      shown,
      sessionHits.slice(0, 8).map(root => [root.id, root.title, root.cwd, root.createdAt, root.at]),
      agentHits.slice(0, 8).map(s => [s.id, s.name, s.title, s.file, s.role, s.icon]),
      eventHits.slice(0, 5).map(event => [event.id, event.type, event.preview, event.at, event.sessionId]),
    ]);
    if (signature === lastSearchSignature) {
      searchNavigation.refresh();
      return;
    }
    lastSearchSignature = signature;
    results.replaceChildren();
    if (query) {
      if (total > shown) {
        results.append(node('p', 'search-note', t('livePage.searchNote', { total, shown })));
      }
      for (const root of sessionHits.slice(0, 8)) {
        const button = node('button', 'search-result'),
          text = node('span');
        const at = Number.isFinite(root.createdAt) ? root.createdAt : root.at,
          date = new Date(at);
        button.type = 'button';
        button.dataset.value = 'session:' + root.id;
        text.append(
          node('strong', '', root.title?.trim() || t('common.unnamedSession')),
          node(
            'small',
            '',
            t('livePage.sessionLine', {
              path: root.cwd || t('common.noDirectory'),
              time: Number.isNaN(date.getTime())
                ? t('common.timeNotRecorded')
                : date.toLocaleString(locale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }),
              id: String(root.id).slice(-8),
            }),
          ),
        );
        button.append(icon('diagram-3-fill'), text);
        button.onclick = () => {
          clearQuery();
          searchNavigation.close();
          void source.openSession(root.id).then(ok => {
            if (ok === false) toast(t('livePage.cannotOpenSession'));
          });
        };
        results.append(button);
      }
      for (const s of agentHits.slice(0, 8)) {
        const button = node('button', 'search-result'),
          text = node('span');
        button.type = 'button';
        button.dataset.value = 'agent:' + s.id;
        text.append(
          node('strong', '', s.name + ' · ' + s.title),
          node('small', '', t('livePage.agentLine', { detail: s.file || s.role || t('common.notRecorded') })),
        );
        button.append(icon(s.icon), text);
        button.onclick = () => {
          clearQuery();
          select(s.id);
          searchNavigation.close();
        };
        results.append(button);
      }
      for (const event of eventHits.slice(0, 5)) {
        const button = node('button', 'search-result'),
          text = node('span');
        button.type = 'button';
        button.dataset.value = 'event:' + event.id;
        text.append(
          node('strong', '', eventText(event.type) + (event.preview ? ' · ' + event.preview : '')),
          node('small', '', t('livePage.eventLine', { name: name(event.sessionId), time: new Date(event.at).toLocaleTimeString(locale(), { hour12: false }) })),
        );
        button.append(icon('bell'), text);
        button.onclick = () => {
          clearQuery();
          searchNavigation.close();
          const id = ['assign', 'message'].includes(event.type) ? event.targetId || event.sessionId : event.sessionId;
          const agent = data.agents.find(s => s.id === id);
          if (agent) {
            if (agent.historical) history = true;
            select(id);
          }
          if (event.hasText) record(name(event.sessionId) + ' · ' + eventText(event.type), event.sessionId, event.id);
        };
        results.append(button);
      }
    }
    searchNavigation.refresh();
  }
  function renderEvents() {
    const events = notifyEvents().slice(-12).reverse(),
      signature = JSON.stringify(events);
    if (signature === eventSignature) return;
    eventSignature = signature;
    $('notification-list').replaceChildren(
      ...events.map(event => {
        const button = node('button', 'notification-item');
        const type = ['assign', 'message', 'report'].includes(event.type) ? event.type : 'activity';
        const badge = node('span', 'notify-type');
        badge.append(icon(type === 'assign' ? 'diagram-3-fill' : type === 'report' ? 'check-lg' : type === 'message' ? 'chat-left-text-fill' : 'cpu-fill'));
        const copy = node('span', 'notify-copy');
        const title = type === 'activity' ? t('demo.updates') : eventText(event.type);
        const route = name(event.sessionId) + (event.targetId && event.targetId !== event.sessionId ? ' → ' + name(event.targetId) : '');
        copy.append(
          node('strong', 'notify-title', title),
          node('small', 'notify-preview', route + (event.preview ? ' · ' + event.preview : '')),
          node('em', 'notify-time', new Date(event.at).toLocaleTimeString(locale(), { hour12: false })),
        );
        button.append(badge, copy);
        button.onclick = () => {
          const id = ['assign', 'message'].includes(event.type) ? event.targetId || event.sessionId : event.sessionId;
          const agent = data.agents.find(s => s.id === id);
          if (agent) {
            if (agent.historical) history = true;
            select(id);
          }
          notifications.markRead();
          notifications.close();
          if (event.hasText) record(name(event.sessionId) + ' · ' + eventText(event.type), event.sessionId, event.id);
        };
        return button;
      }),
    );
    if (!events.length) $('notification-list').append(node('div', 'empty', t('livePage.waitingEvents')));
    notifications.update();
  }
  function renderRoots() {
    const signature = JSON.stringify([source.kind, source.directoryKey, data.rootId, data.roots]);
    if (signature === rootSignature) return;
    rootSignature = signature;
    const harness = source.kind === 'harness';
    $('directory-field').hidden = !harness || pinned;
    $('directory-field').parentElement.classList.toggle('harness-picker', harness);
    if (harness) {
      fillDirectories($('workspace-directory'));
      if (teamDirectoryPicker) {
        fillDirectories($('team-workspace-directory'));
        teamDirectoryPicker.refresh();
      }
    }
    const roots = visibleRoots();
    $('scenario').replaceChildren(
      ...roots.map(root => {
        const option = node('option', '', harness ? sessionLabel(root) : root.title || root.id);
        option.value = root.id;
        option.dataset.label = root.title?.replace(/\s+/g, ' ').trim() || t('common.unnamedSession');
        option.dataset.description = sessionLabel(root).split(' · ').slice(-2).join(' · ');
        option.dataset.search = [root.title, sessionLabel(root), root.id].join(' ');
        return option;
      }),
    );
    if (!roots.length) {
      const option = node('option', '', t('livePage.noSessions', { host: host() }));
      option.value = '';
      $('scenario').append(option);
    }
    $('scenario').value = data.rootId || '';
    $('scenario').disabled = !roots.length;
    $('scenario').title = $('scenario').selectedOptions[0]?.textContent || '';
    scenarioPicker.refresh();
  }
  function fillDirectories(selector) {
    const groups = directoryGroups(data.roots);
    selector.replaceChildren(
      ...groups.map(group => {
        const option = node('option', '', group.path + ' (' + group.count + ')');
        option.value = group.key;
        option.dataset.label = group.path;
        option.dataset.description = t('livePage.sessionCount', { count: group.count });
        return option;
      }),
    );
    if (!groups.length) {
      const option = node('option', '', t('livePage.noDirectories'));
      option.value = '';
      selector.append(option);
    }
    selector.disabled = !groups.length;
    selector.value = groups.length ? (source.directoryKey ?? '') : '';
    selector.title = groups.find(group => group.key === source.directoryKey)?.path || '';
    if (selector === $('workspace-directory')) directoryPicker.refresh();
  }
  function renderPins() {
    const signature = JSON.stringify(agents().map(s => [s.id, s.name, s.zone]));
    if (signature !== pinSignature) {
      pinSignature = signature;
      $('scene-pins').replaceChildren(
        ...agents().map(s => {
          const button = node('button', 'scene-pin'),
            text = node('span');
          button.dataset.agent = s.id;
          button.setAttribute('aria-label', t('demo.ariaSelectAgent', { name: s.name }));
          text.append(node('strong', '', s.name), node('small', '', s.zone));
          button.append(icon(s.icon), text);
          button.onclick = () => select(s.id);
          return button;
        }),
      );
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
    scene?.destroy();
    scene = null;
    capacity = count;
    try {
      const instance = (scene = new DemoScene($('demo-scene'), {
        count,
        live: true,
        source: source.kind,
        onSelect: select,
        reduced: $('demo-reduced').checked,
        pins: $('scene-pins'),
        pinFloor: () => {
          const stats = document.querySelector('.stats');
          const rect = stats && stats.getBoundingClientRect();
          return rect && rect.height ? Math.round(rect.bottom) + 10 : 70;
        },
      }));
      instance.setTeam(agents(), data.rootId);
      instance.select(selectedId);
      instance.ready.then(ready => {
        if (scene !== instance) return;
        $('scene-loading').hidden = ready;
        document.body.dataset.demoReady = ready ? 'true' : 'fallback';
        if (!ready) {
          $('scene-loading').textContent = t('livePage.sceneUnavailable');
          instance.visible = false;
        }
        // 扩容加载模型期间只暂存新事件；正文和状态已经由快照立即显示。
        if (ready) for (const event of pendingAnimations) instance.animateEvent(event);
        pendingAnimations = [];
      });
    } catch (error) {
      sceneFailed = true;
      $('scene-loading').hidden = false;
      $('scene-loading').textContent = t('livePage.sceneUnavailable');
      document.body.dataset.demoReady = 'fallback';
      console.error('协作场景加载失败', error);
    }
  }
  function initStatic() {
    document.title = source.kind === 'harness' ? t('meta.harnessLive') : t('meta.liveTitle');
    $('task-search').setAttribute('aria-label', t('livePage.searchAria'));
    $('scenario').setAttribute('aria-label', t('livePage.scenarioAria'));
    $('metric-progress-title').textContent = t('livePage.progressTitle');
    $('event-mode').textContent = t('livePage.eventMode');
    $('detail-activity-label').textContent = t('livePage.activityLabel');
    $('dialog-mode').textContent = t('livePage.dialogMode');
    $('dialog-caption').textContent = t('livePage.dialogCaption');
    $('mode-select').setAttribute('aria-label', t('livePage.modeAria'));
    $('restart-demo').title = t('livePage.reconnect');
    $('restart-demo').setAttribute('aria-label', t('livePage.reconnect'));
    $('toggle-play').title = t('livePage.toggleCodex');
    screenButton.textContent = t('livePage.viewScreen');
  }
  function render({ baseline = false } = {}) {
    data = source.snapshot;
    if (brandSource !== source.kind) {
      brandSource = source.kind;
      applyOfficeBrand(source.kind, true);
      initStatic();
      $('toggle-play').title = t(source.kind === 'harness' ? 'livePage.toggleHarness' : 'livePage.toggleCodex');
      $('team-picker').textContent = t(source.kind === 'harness' ? 'livePage.teamLabelHarness' : 'livePage.teamLabelCodex');
    }
    if (data.rootId !== lastRoot) {
      selectedId = data.rootId;
      baseline = true;
      recordToken++;
      $('demo-dialog').close();
    }
    if (!agents().some(s => s.id === selectedId)) selectedId = agents()[0]?.id || null;
    if (baseline) {
      seen = new Set(data.events.map(e => e.id));
      pendingAnimations = [];
    }
    const currentRoot = pinned ? data.roots?.find(root => root.id === data.rootId) : null;
    $('workspace-name').textContent =
      currentRoot != null
        ? currentRoot.title?.replace(/\s+/g, ' ').trim() || t('common.unnamedSession')
        : source.kind === 'harness'
          ? t('livePage.session')
          : data.config.project;
    $('workflow-subtitle').textContent = t('livePage.realSubtitle', { title: data.config.title });
    $('workflow-subtitle').title = data.config.title;
    $('metric-active').textContent = data.active;
    $('metric-assigned').textContent = data.assigned;
    $('metric-reports').textContent = data.received;
    $('metric-progress').textContent = data.progress == null ? '—' : data.progress + '%';
    $('active-hint').textContent = data.complete ? t('demo.hintComplete') : data.active > 1 ? t('demo.hintParallel') : t('demo.hintCoordinating');
    $('assigned-hint').textContent = t('livePage.realSplit');
    $('report-hint').textContent =
      data.received && data.received === data.assigned ? t('demo.reportsReady') : data.received ? t('demo.reportsCollecting') : t('demo.reportsWaiting');
    $('stage-caption').textContent = data.complete ? t('demo.stageComplete') : t('livePage.noPercent');
    $('demo-clock').textContent = data.elapsedKnown ? clock(data.seconds) : '—';
    $('team-count-caption').textContent = t('livePage.memberCaption', { count: data.assigned });
    $('assigned-caption').textContent = t('livePage.nestedCaption');
    const liveOption = modeSelect.querySelector('option[value="live"]');
    liveOption.textContent =
      source.connection === 'connected' ? t('demo.modeLive') : source.connection === 'connecting' ? t('livePage.connecting') : t('livePage.disconnected');
    modeSelect.closest('.mode-field')?.classList.toggle('disconnected', source.connection !== 'connected');
    modePicker.refresh();
    $('profile-caption').textContent = source.error || t(source.kind === 'harness' ? 'livePage.profileHarness' : 'livePage.profileCodex');
    $('profile-caption').title = source.error || t('livePage.profileTitle', { host: host() });
    $('source-status').hidden = !source.error && !data.warnings.length;
    $('source-status').textContent = [source.error, ...data.warnings].filter(Boolean).join(t('common.listSeparator'));
    $('play-label').textContent = source.follow ? t(source.kind === 'harness' ? 'livePage.followHarness' : 'livePage.followNew') : t('livePage.fixedSession');
    $('toggle-play').setAttribute('aria-label', $('play-label').textContent);
    $('history-toggle').textContent = t(history ? 'livePage.historyHide' : 'livePage.historyShow', { count: data.agents.filter(s => s.historical).length });
    $('stage-track-fill').style.width = (data.complete ? 100 : (data.stage / 3) * 100) + '%';
    $('stage-0-description').textContent = t('livePage.subtasks', { count: data.assigned });
    $('stage-1-description').textContent = t('livePage.running', {
      count: agents().filter(s => s.id !== data.rootId && ['tool', 'thinking', 'typing'].includes(s.status)).length,
    });
    $('stage-2-description').textContent = t('livePage.reported', { done: data.received, total: data.assigned });
    $('stage-3-description').textContent = data.complete
      ? t('demo.stageSummaryReady')
      : data.stage === 3
        ? t('demo.stageConcluding')
        : t('livePage.awaitingLead');
    for (const button of document.querySelectorAll('.stage')) {
      const index = Number(button.dataset.stage);
      button.classList.toggle('active', index === data.stage);
      button.classList.toggle('completed', index < data.stage || data.complete);
      button.setAttribute('aria-pressed', index === data.stage);
      button.title = t('demo.previewStage', { stage: stages()[index] });
      button.querySelector('em').textContent = index === data.stage ? t(data.complete ? 'demo.markerDone' : 'demo.markerRunning') : '';
    }
    const c = $('progress-ring').getContext('2d');
    c.clearRect(0, 0, 112, 112);
    c.lineWidth = 15;
    c.lineCap = 'round';
    c.strokeStyle = data.complete ? '#126cfa' : '#e5edfc';
    c.beginPath();
    c.arc(56, 56, 39, 0, Math.PI * 2);
    c.stroke();
    renderRoots();
    renderPins();
    renderDetails();
    renderQueue();
    renderEvents();
    if (query && !$('search-results').hidden) search();
    ensureScene();
    if (scene) {
      scene.setTeam(agents(), data.rootId);
      scene.select(selectedId);
      scene.playing = true;
      if (!baseline)
        for (const event of data.events)
          if (!seen.has(event.id)) {
            if (scene.loaded) scene.animateEvent(event);
            else pendingAnimations.push(event);
          }
    }
    seen = new Set(data.events.map(e => e.id));
    lastRoot = data.rootId;
  }

  document.body.dataset.mode = 'live';
  mountLangSwitch(document);
  const screenButton = document.createElement('button');
  screenButton.id = 'view-screen';
  screenButton.type = 'button';
  screenButton.className = 'text-button';
  screenButton.hidden = true;
  $('view-task').before(screenButton);
  initStatic();
  $('mode-select').onchange = event => {
    if (event.target.value === 'demo') location.href = officePage(false, source.kind);
    else {
      event.target.value = 'live';
      modePicker.refresh();
    }
  };
  $('play-icon').src = './demo-icons/crosshair.svg';
  $('history-toggle').hidden = $('team-picker').hidden = false;
  $('close-details').onclick = () => details(false);
  $('open-details').onclick = () => details(true);
  $('view-report').onclick = () => showTask();
  $('view-task').onclick = () => showTask(true);
  screenButton.onclick = () => {
    const s = selected();
    if (s?.id) scene?.openScreenFor?.(s.id);
  };
  $('current-task-button').onclick = () => {
    details(true);
    showTask();
  };
  $('close-demo-dialog').onclick = () => {
    recordToken++;
    $('demo-dialog').close();
  };
  $('demo-dialog').addEventListener('close', () => {
    if (!$('demo-dialog').open) {
      teamDirectoryPicker?.destroy();
      teamDirectoryPicker = null;
    }
  });
  $('copy-demo-report').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('dialog-content').textContent);
      $('copy-demo-report').textContent = t('common.copied');
    } catch {
      toast(t('common.copyFailedToast'));
    }
  };
  $('toggle-play').onclick = () => {
    source.follow = !source.follow;
    render();
    toast(t(source.follow ? (source.kind === 'harness' ? 'livePage.toastFollowHarness' : 'livePage.toastFollowNew') : 'livePage.toastFixed'));
  };
  $('restart-demo').onclick = () => {
    source.connect();
    toast(t('livePage.toastReconnect'));
  };
  $('reset-demo-camera').onclick = () => scene?.resetCamera();
  $('history-toggle').onclick = () => {
    history = !history;
    render({ baseline: true });
  };
  $('scenario').onchange = event => {
    query = '';
    $('task-search').value = '';
    search();
    source.select(event.target.value);
  };
  $('workspace-directory').onchange = event => {
    query = '';
    $('task-search').value = '';
    search();
    source.selectDirectory(event.target.value);
  };
  $('task-search').oninput = event => {
    query = event.target.value.trim();
    renderQueue();
    search();
  };
  $('task-search').onfocus = search;
  $('clear-search').onclick = () => {
    query = '';
    $('task-search').value = '';
    renderQueue();
    search();
    $('task-search').focus();
  };
  $('notifications-button').onclick = () => notifications.toggle();
  $('mark-read').onclick = () => {
    notifications.markRead();
    renderEvents();
  };
  $('show-team').onclick = $('team-picker').onclick = teamPicker;
  $('dock-toggle').onclick = () => {
    const expanded = $('workflow-dock').classList.toggle('expanded');
    $('dock-toggle').setAttribute('aria-expanded', expanded);
  };
  for (const button of document.querySelectorAll('.stage'))
    button.onclick = () => toast(t('livePage.stageToast', { stage: stages()[data.stage], host: host() }));
  $('demo-reduced').checked = localStorage.getItem('office.demo.reduced') === 'true' || matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.body.dataset.reducedMotion = String($('demo-reduced').checked);
  $('demo-reduced').onchange = event => {
    localStorage.setItem('office.demo.reduced', event.target.checked);
    document.body.dataset.reducedMotion = String(event.target.checked);
    scene?.setReduced(event.target.checked);
  };
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !$('demo-dialog').open) {
      event.preventDefault();
      $('task-search').focus();
    }
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('#notifications') && !event.target.closest('#notifications-button')) notifications.close();
  });
  document.addEventListener('visibilitychange', () => {
    if (scene) scene.visible = !document.hidden && !scene.loadError;
  });
  // 切换语言后重绘静态文案与全部动态文案；3D 招牌与屏幕贴图随语言重建。
  onLangChange(() => {
    pinSignature = queueSignature = rootSignature = eventSignature = '';
    brandSource = null;
    capacity = 0;
    scene?.destroy();
    scene = null;
    initStatic();
    render({ baseline: true });
  });
  details(innerWidth > 1050 && innerHeight > 820);
  render({ baseline: true });
  source.addEventListener('change', event => render(event.detail));
  source.connect();
  const timer = setInterval(() => {
    if (!document.hidden) render();
  }, 1000);
  window.addEventListener('beforeunload', () => {
    clearInterval(timer);
    clearTimeout(toastTimer);
    directoryPicker.destroy();
    scenarioPicker.destroy();
    teamDirectoryPicker?.destroy();
    searchNavigation.destroy();
    source.destroy();
    scene?.destroy();
  });
}
