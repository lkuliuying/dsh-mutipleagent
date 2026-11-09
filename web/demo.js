import { DemoScene } from './demo-scene.js';
import { DemoPlayer, DURATION } from './demo-state.mjs';
import { startLiveOffice } from './live-office.js';
import { applyOfficeBrand, officePage, officeSource } from './base-url.mjs';
import { enhanceSelect, bindSearchNavigation, closeOfficeControls } from './office-controls.js';
import { createNotificationState } from './notifications.mjs';
import { mountLangSwitch, onLangChange, t } from './i18n.mjs';

if (new URLSearchParams(location.search).get('mode') === 'live') startLiveOffice();
else startDemo();

function startDemo() {
  const sourceKind = officeSource();
  applyOfficeBrand(sourceKind);
  mountLangSwitch(document);

  const $ = id => document.getElementById(id);
  const element = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const icon = name => {
    const img = element('img');
    img.src = './demo-icons/' + name + '.svg';
    img.alt = '';
    return img;
  };
  const stages = () => [t('demo.stage.analysis'), t('demo.stage.parallel'), t('demo.stage.reports'), t('demo.stage.summary')];
  const types = () => ({ main: t('demo.type.main'), api: t('demo.type.api'), frontend: t('demo.type.frontend'), test: t('demo.type.test') });
  const player = new DemoPlayer();
  const viewSnapshot = () => {
    const value = player.snapshot;
    return sourceKind === 'harness'
      ? {
          ...value,
          config: { ...value.config, project: value.config.project.replace('Codex', 'Harness') },
          agents: value.agents.map(agent => ({ ...agent, agent: 'dsh' })),
        }
      : value;
  };
  let snapshot = viewSnapshot(),
    selectedId = 'frontend',
    scene = null,
    query = '',
    toastTimer = null;
  let seen = new Set(snapshot.events.map(e => e.id)),
    detailsOpen = innerWidth > 1050 && innerHeight > 820;
  let lastSeconds = snapshot.seconds,
    lastScenario = snapshot.scenario,
    lastTime = performance.now();
  let dialogSignature = '',
    queueSignature = '';
  const scenarioPicker = enhanceSelect($('scenario'));
  const modePicker = enhanceSelect($('mode-select'), { filterable: false });
  const modeSelect = $('mode-select');
  modeSelect.value = 'demo';
  modePicker.refresh();
  const notifications = createNotificationState({
    mode: 'demo',
    button: $('notifications-button'),
    dot: $('notification-dot'),
    panel: $('notifications'),
    getEvents: () => snapshot.events,
  });
  const searchNavigation = bindSearchNavigation({
    input: $('task-search'),
    form: $('search-form'),
    results: $('search-results'),
    list: $('search-result-list'),
    status: $('search-status'),
    clear: $('clear-search'),
    onClear: () => $('clear-search').click(),
    onOpen: renderSearch,
  });
  const nameOf = id => snapshot.agents.find(s => s.id === id)?.name || t('common.agent');
  const selected = () => snapshot.agents.find(s => s.id === selectedId) || snapshot.agents[0];
  const statusLabel = s =>
    s.status === 'done'
      ? t('status.done')
      : s.status === 'unknown'
        ? t('status.pending')
        : s.status === 'waiting_agents'
          ? t('status.coordinating')
          : t('status.running');
  const clock = seconds => '00:' + String(Math.floor(seconds)).padStart(2, '0');
  // 语言变化后同步下拉选项的显示文案（增强下拉缓存了 label）。
  const syncOptions = () => {
    for (const option of $('scenario').options) option.dataset.label = t(option.value === 'review' ? 'demo.scenarioReview' : 'demo.scenarioSearch');
    scenarioPicker.refresh();
    modePicker.refresh();
  };

  function toast(text) {
    clearTimeout(toastTimer);
    $('demo-toast').textContent = text;
    $('demo-toast').hidden = false;
    toastTimer = setTimeout(() => {
      $('demo-toast').hidden = true;
    }, 2300);
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
    c.lineWidth = 15;
    c.lineCap = 'round';
    c.strokeStyle = '#e5edfc';
    c.beginPath();
    c.arc(56, 56, 39, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = '#126cfa';
    c.beginPath();
    c.arc(56, 56, 39, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * progress) / 100);
    c.stroke();
  }

  function buildPins() {
    const pins = $('scene-pins');
    pins.replaceChildren(
      ...snapshot.agents.map(s => {
        const button = element('button', 'scene-pin');
        button.dataset.agent = s.id;
        button.setAttribute('aria-label', t('demo.ariaSelectAgent', { name: s.name }));
        const text = element('span');
        text.append(element('strong', '', s.name), element('small', '', s.zone));
        button.append(icon(s.icon), text);
        button.onclick = () => selectAgent(s.id);
        return button;
      }),
    );
  }

  function renderDetails() {
    const s = selected();
    $('detail-icon').src = './demo-icons/' + s.icon + '.svg';
    $('detail-agent-icon').src = './demo-icons/' + s.icon + '.svg';
    $('detail-code').textContent = t('demo.detailCode', { code: s.code });
    $('detail-badge').textContent = statusLabel(s);
    $('detail-badge').classList.toggle('done', s.status === 'done');
    $('detail-task-title').textContent = s.title;
    $('detail-project').textContent = snapshot.scenario === 'search' ? t('demo.projectTaskBoard') : t('demo.projectApi');
    $('detail-role').textContent = s.role;
    $('detail-type').textContent = snapshot.scenario === 'review' && s.parentId ? t('demo.type.reviewOnly') : types()[s.id];
    $('detail-progress-label').textContent = s.report ? t('demo.detailProgressDone') : s.reportPreview;
    $('detail-progress-fill').style.width = s.progress + '%';
    $('detail-percent').textContent = s.progress + '%';
    $('detail-zone').textContent = s.zone;
    $('detail-file').textContent = s.file;
    $('detail-parent').textContent = s.parentId ? t('demo.parentMain') : t('demo.parentLead', { count: 3 });
    $('detail-name').textContent = s.name;
    $('detail-stage').textContent = snapshot.complete ? t('demo.stageComplete') : stages()[snapshot.stage];
    $('view-report').replaceChildren(document.createTextNode(s.report ? t('demo.viewFullReport') : t('demo.viewReport')), icon('arrow-right'));
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
    const filtered = snapshot.agents.filter(s => s.id !== selectedId && matches(s));
    const signature = JSON.stringify([snapshot.scenario, selectedId, query, filtered.map(s => [s.id, s.status, s.progress])]);
    if (signature === queueSignature) return;
    queueSignature = signature;
    $('queue-heading').textContent = t('demo.queueHeading', { label: query ? t('demo.matchingTasks') : t('demo.teamTasks'), count: filtered.length });
    const queue = $('task-queue');
    queue.replaceChildren();
    for (const s of filtered) {
      const button = element('button', 'queue-item');
      button.setAttribute('aria-label', t('demo.ariaViewTask', { name: s.name }));
      button.append(
        element('strong', '', s.code),
        element('span', '', s.zone.split(' · ')[0]),
        element('span', 'queue-status ' + (s.status === 'done' ? 'done' : s.status === 'unknown' ? '' : 'running'), statusLabel(s)),
      );
      button.onclick = () => selectAgent(s.id);
      queue.append(button);
    }
    if (!filtered.length) queue.append(element('div', 'queue-empty', t('demo.noMatchingTasks')));
  }

  function renderSearch() {
    const results = $('search-result-list');
    results.replaceChildren();
    const filtered = query ? snapshot.agents.filter(matches) : [];
    for (const s of filtered) {
      const button = element('button', 'search-result');
      button.type = 'button';
      button.dataset.value = s.id;
      const text = element('span');
      text.append(element('strong', '', s.name + ' · ' + s.title), element('small', '', s.file));
      button.append(icon(s.icon), text);
      button.onclick = () => {
        selectAgent(s.id);
        $('task-search').focus();
        searchNavigation.close();
      };
      results.append(button);
    }
    searchNavigation.refresh();
  }

  function renderNotifications() {
    const list = $('notification-list');
    list.replaceChildren();
    const events = snapshot.events.slice(-6).reverse();
    for (const e of events) {
      const agent = snapshot.agents.find(s => s.id === (e.targetId || e.sessionId));
      const item = element('button', 'notification-item');
      item.type = 'button';
      const badge = element('span', 'notify-type');
      badge.append(icon(e.type === 'assign' ? 'diagram-3-fill' : e.type === 'report' ? 'check-lg' : 'chat-left-text-fill'));
      const copy = element('span', 'notify-copy');
      const title = e.type === 'assign' ? t('demo.notifyAssign') : e.type === 'report' ? t('demo.notifyReport') : t('demo.notifyMessage');
      const who = e.type === 'assign' ? t('demo.notifyRouteLead') : nameOf(e.sessionId) + ' · ';
      const what =
        e.type === 'assign' ? agent?.title || nameOf(e.targetId) : e.type === 'report' ? t('demo.notifySummary') : e.preview || t('demo.notifyProgress');
      copy.append(
        element('strong', 'notify-title', title),
        element('small', 'notify-preview', who + what),
        element('em', 'notify-time', t('demo.notifyTime', { time: clock(e.at) })),
      );
      item.append(badge, copy);
      item.onclick = () => {
        if (agent) selectAgent(agent.id);
        notifications.markRead();
        notifications.close();
      };
      list.append(item);
    }
    if (!events.length) list.append(element('div', 'empty', t('demo.notifyEmpty')));
    notifications.update();
  }

  function showText(title, text, iconName = selected().icon) {
    closeOfficeControls();
    $('dialog-title').textContent = title;
    $('dialog-content').textContent = text;
    $('dialog-icon').src = './demo-icons/' + iconName + '.svg';
    $('copy-demo-report').textContent = t('demo.copy');
    if (!$('demo-dialog').open) $('demo-dialog').showModal();
  }

  function showSelectedTask() {
    const s = selected();
    if (s.report) showText(t(s.id === 'main' ? 'demo.dialogFinalTitle' : 'demo.dialogReportTitle', { name: s.name }), s.report);
    else
      showText(
        t('demo.dialogTaskTitle', { name: s.name }),
        [
          t('demo.fieldTask', { value: s.title }),
          t('demo.fieldCode', { value: s.code }),
          t('demo.fieldZone', { value: s.zone }),
          t('demo.fieldFile', { value: s.file }),
          '',
          s.task,
          '',
          t('demo.fieldStatus', { value: statusLabel(s), percent: s.progress }),
          '',
          t('demo.doneHint'),
          '',
          t('demo.demoOnlyHint'),
        ].join('\n'),
      );
    dialogSignature = s.id + ':' + !!s.report + ':' + snapshot.scenario;
  }

  function render() {
    snapshot = viewSnapshot();
    const reset = snapshot.seconds < lastSeconds || snapshot.scenario !== lastScenario;
    if (reset) {
      seen = new Set(snapshot.events.map(e => e.id));
      $('demo-dialog').close();
      dialogSignature = '';
      if (scene)
        for (const p of scene.people.values()) {
          p.path = [];
          p.mode = 'work';
          p.reportUntil = null;
          p.x = p.desk.seat.x;
          p.y = p.desk.seat.y;
        }
    }
    $('workspace-name').textContent = snapshot.config.project;
    $('workflow-subtitle').textContent = t('demo.subtitleSim', { title: snapshot.config.title });
    $('metric-active').textContent = snapshot.active;
    $('metric-assigned').textContent = snapshot.assigned;
    $('metric-reports').textContent = snapshot.received;
    $('metric-progress').textContent = snapshot.progress + '%';
    $('active-hint').textContent = snapshot.complete ? t('demo.hintComplete') : snapshot.active > 1 ? t('demo.hintParallel') : t('demo.hintCoordinating');
    $('assigned-hint').textContent = snapshot.assigned === 3 ? t('demo.assignedReady') : t('demo.assignedSplitting');
    $('report-hint').textContent =
      snapshot.received === 3 ? t('demo.reportsReady') : snapshot.received ? t('demo.reportsCollecting') : t('demo.reportsWaiting');
    $('stage-caption').textContent = snapshot.complete ? t('demo.demoComplete') : t('demo.runningStage', { stage: stages()[snapshot.stage] });
    $('demo-clock').textContent = clock(snapshot.seconds);
    $('play-label').textContent = player.playing ? t('demo.pause') : snapshot.complete ? t('demo.replay') : t('demo.play');
    $('toggle-play').setAttribute('aria-label', player.playing ? t('demo.pause') : t('demo.play'));
    $('toggle-play').title = $('play-label').textContent;
    $('play-icon').src = './demo-icons/' + (player.playing ? 'pause-fill' : 'play-fill') + '.svg';
    $('stage-track-fill').style.width = Math.min(100, (snapshot.seconds / DURATION) * 100) + '%';
    $('stage-0-description').textContent = t('demo.stageAssigned', { done: snapshot.assigned, total: 3 });
    $('stage-1-description').textContent = t('demo.stageRunning', { count: snapshot.agents.slice(1).filter(s => s.status === 'tool').length });
    $('stage-2-description').textContent = t('demo.stageReported', { done: snapshot.received, total: 3 });
    $('stage-3-description').textContent = snapshot.complete
      ? t('demo.stageSummaryReady')
      : snapshot.stage === 3
        ? t('demo.stageConcluding')
        : t('demo.stageAwaitReports');
    for (const button of document.querySelectorAll('.stage')) {
      const index = Number(button.dataset.stage);
      button.classList.toggle('active', index === snapshot.stage);
      button.classList.toggle('completed', index < snapshot.stage || snapshot.complete);
      button.setAttribute('aria-pressed', index === snapshot.stage);
      button.title = t('demo.previewStage', { stage: stages()[index] });
      button.querySelector('em').textContent =
        index === snapshot.stage ? (snapshot.complete ? t('demo.markerDone') : player.playing ? t('demo.markerRunning') : t('demo.markerPaused')) : '';
    }
    drawRing(snapshot.progress);
    renderDetails();
    renderQueue();
    renderNotifications();
    for (const pin of $('scene-pins').children) {
      pin.classList.toggle('selected', pin.dataset.agent === selectedId);
      pin.classList.toggle('done', snapshot.agents.find(s => s.id === pin.dataset.agent)?.status === 'done');
    }
    if (scene) {
      scene.setTeam(snapshot.agents, 'main');
      scene.select(selectedId);
      scene.playing = player.playing;
      if (!reset) for (const event of snapshot.events) if (!seen.has(event.id)) scene.animateEvent(event);
    }
    seen = new Set(snapshot.events.map(e => e.id));
    lastSeconds = snapshot.seconds;
    lastScenario = snapshot.scenario;
    if ($('demo-dialog').open && dialogSignature) {
      const s = selected();
      const signature = s.id + ':' + !!s.report + ':' + snapshot.scenario;
      if (signature !== dialogSignature) showSelectedTask();
    }
  }

  $('close-details').onclick = () => openDetails(false);
  $('open-details').onclick = () => openDetails(true);
  $('view-report').onclick = showSelectedTask;
  $('current-task-button').onclick = () => {
    openDetails(true);
    showSelectedTask();
  };
  $('close-demo-dialog').onclick = () => $('demo-dialog').close();
  $('copy-demo-report').onclick = async () => {
    try {
      await navigator.clipboard.writeText($('dialog-content').textContent);
      $('copy-demo-report').textContent = t('common.copied');
    } catch {
      toast(t('common.copyFailedToast'));
    }
  };
  $('toggle-play').onclick = () => player.play();
  $('mode-select').onchange = e => {
    if (e.target.value === 'live') location.href = officePage(true, sourceKind);
    else {
      e.target.value = 'demo';
      modePicker.refresh();
    }
  };
  $('restart-demo').onclick = () => {
    player.restart();
    toast(t('demo.toastRestart'));
  };
  $('reset-demo-camera').onclick = () => scene?.resetCamera();
  $('scenario').onchange = e => {
    query = '';
    $('task-search').value = '';
    renderSearch();
    player.setScenario(e.target.value);
  };
  $('task-search').oninput = e => {
    query = e.target.value.trim();
    queueSignature = '';
    renderQueue();
    renderSearch();
  };
  $('task-search').onfocus = () => renderSearch();
  $('clear-search').onclick = () => {
    query = '';
    $('task-search').value = '';
    renderQueue();
    renderSearch();
    $('task-search').focus();
  };
  $('notifications-button').onclick = () => notifications.toggle();
  $('mark-read').onclick = () => {
    notifications.markRead();
    renderNotifications();
  };
  $('show-team').onclick = () => {
    dialogSignature = '';
    showText(
      t('demo.dialogTeamTitle', { title: snapshot.config.title }),
      snapshot.agents
        .map(s => t('demo.teamMemberLine', { name: s.name, zone: s.zone, task: s.task, status: statusLabel(s), percent: s.progress }))
        .join('\n\n'),
      'people-fill',
    );
  };
  $('dock-toggle').onclick = () => {
    const expanded = $('workflow-dock').classList.toggle('expanded');
    $('dock-toggle').setAttribute('aria-expanded', expanded);
  };
  for (const button of document.querySelectorAll('.stage'))
    button.onclick = () => {
      player.seconds = [2, 16, 32, 42][Number(button.dataset.stage)];
      player.playing = false;
      player.changed();
      toast(t('demo.toastPreview', { stage: stages()[Number(button.dataset.stage)] }));
    };
  $('demo-reduced').checked = matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.body.dataset.reducedMotion = String($('demo-reduced').checked);
  $('demo-reduced').onchange = e => {
    document.body.dataset.reducedMotion = String(e.target.checked);
    scene?.setReduced(e.target.checked);
  };
  document.addEventListener('keydown', e => {
    if (
      e.key === '/' &&
      !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) &&
      !$('demo-dialog').open &&
      !document.querySelector('.screen-modal')
    ) {
      e.preventDefault();
      $('task-search').focus();
    }
  });
  document.addEventListener('click', e => {
    if (!e.target.closest('#notifications') && !e.target.closest('#notifications-button')) notifications.close();
  });
  document.addEventListener('visibilitychange', () => {
    lastTime = performance.now();
    if (scene) scene.visible = !document.hidden && !scene.loadError;
  });
  // 切换语言后重绘动态文案；3D 场景里的招牌与屏幕贴图也随语言重建。
  onLangChange(() => {
    syncOptions();
    queueSignature = '';
    dialogSignature = '';
    render();
    buildPins();
    renderSearch();
    if ($('demo-dialog').open) showSelectedTask();
    scene?.destroy();
    scene = null;
    mountScene();
  });

  buildPins();
  openDetails(detailsOpen);
  render();
  mountScene();
  function mountScene() {
    try {
      const next = new DemoScene($('demo-scene'), {
        source: sourceKind,
        onSelect: id => selectAgent(id),
        reduced: $('demo-reduced').checked,
        pins: $('scene-pins'),
      });
      scene = next;
      next.setTeam(snapshot.agents, 'main');
      next.select(selectedId);
      next.ready.then(ready => {
        $('scene-loading').hidden = ready;
        document.body.dataset.demoReady = ready ? 'true' : 'fallback';
        if (!ready) {
          $('scene-loading').textContent = t('demo.failed3d');
          next.visible = false;
        }
      });
    } catch {
      $('scene-loading').textContent = t('demo.failed3d');
      document.body.dataset.demoReady = 'fallback';
    }
  }
  player.addEventListener('change', render);
  const timer = setInterval(() => {
    const now = performance.now(),
      delta = Math.min(0.5, (now - lastTime) / 1000);
    lastTime = now;
    if (!document.hidden) player.advance(delta);
  }, 250);
  window.addEventListener('beforeunload', () => {
    clearInterval(timer);
    clearTimeout(toastTimer);
    scenarioPicker.destroy();
    searchNavigation.destroy();
    scene?.destroy();
  });
}
