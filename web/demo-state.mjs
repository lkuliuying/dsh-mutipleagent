import { t } from './i18n.mjs';

export const DURATION = 48;
export const SCENARIO_IDS = ['search', 'review'];
const CODES = { search: 'TASK-07843', review: 'TASK-07844' };

const read = (scenario, field) => [0, 1, 2, 3].map(i => t('demo.scenario.' + scenario + '.' + field + '.' + i));

// 场景文案在调用时按当前语言解析，切换语言后立即反映到演示内容。
export function scenarioConfig(id) {
  const key = SCENARIO_IDS.includes(id) ? id : 'search';
  const config = {
    title: t('demo.scenario.' + key + '.title'),
    project: t('demo.scenario.' + key + '.project'),
    code: CODES[key],
    titles: read(key, 'titles'),
    tasks: read(key, 'tasks'),
    files: read(key, 'files'),
    reports: read(key, 'reports'),
  };
  if (key === 'review') config.roles = read(key, 'roles');
  return config;
}

export function scenarios() {
  const result = {};
  for (const id of SCENARIO_IDS) result[id] = scenarioConfig(id);
  return result;
}

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const ids = ['main', 'api', 'frontend', 'test'];
const starts = [0, 3, 5, 7],
  ends = [48, 23, 31, 37];
const icons = ['diagram-3-fill', 'cpu-fill', 'file-earmark-code-fill', 'shield-check'];

export function demoSnapshot(seconds = 16, scenario = 'search') {
  const at = clamp(Number(seconds) || 0, 0, DURATION);
  const config = scenarioConfig(scenario);
  const names = ids.map(id => t('demo.name.' + id));
  const roles = ids.map(id => t('demo.role.' + id));
  const zones = ids.map(id => t('demo.zone.' + id));
  const stage = at < 7 ? 0 : at < 25 ? 1 : at < 37 ? 2 : 3;
  const agents = ids.map((id, i) => {
    const progress = i === 0 ? Math.round((at / DURATION) * 100) : Math.round(clamp((at - starts[i]) / (ends[i] - starts[i]), 0, 1) * 100);
    const done = at >= ends[i];
    return {
      id,
      key: id,
      parentId: i ? 'main' : null,
      rootId: 'main',
      agent: 'codex',
      subagent: i > 0,
      name: names[i],
      title: config.titles[i],
      role: (config.roles || roles)[i],
      zone: zones[i],
      icon: icons[i],
      task: config.tasks[i],
      file: config.files[i],
      code: config.code.slice(0, -1) + (Number(config.code.slice(-1)) + i),
      progress,
      status: done ? 'done' : at < starts[i] ? 'unknown' : i === 0 && at >= 7 && at < 37 ? 'waiting_agents' : 'tool',
      startedAt: starts[i] * 1000,
      report: done ? config.reports[i] : null,
      reportPreview: done
        ? t('demo.preview.ready')
        : i
          ? progress < 25
            ? t('demo.preview.analyzing')
            : progress < 75
              ? t('demo.preview.running')
              : t('demo.preview.compiling')
          : t('demo.preview.coordinating'),
    };
  });
  const events = [
    ...ids.slice(1).map((id, i) => ({ id: 'assign-' + id, sessionId: 'main', targetId: id, type: 'assign', at: starts[i + 1], preview: config.tasks[i + 1] })),
    ...ids.slice(1).map((id, i) => ({ id: 'report-' + id, sessionId: id, targetId: 'main', type: 'report', at: ends[i + 1], preview: config.reports[i + 1] })),
    { id: 'final-main', sessionId: 'main', type: 'report', at: 48, preview: config.reports[0] },
  ]
    .filter(e => e.at <= at)
    .sort((a, b) => a.at - b.at);
  return {
    mode: 'demo',
    rootId: 'main',
    scenario,
    config,
    seconds: at,
    stage,
    agents,
    events,
    assigned: agents.slice(1).filter(s => at >= starts[ids.indexOf(s.id)]).length,
    received: agents.slice(1).filter(s => s.status === 'done').length,
    active: agents.filter(s => s.status !== 'done' && s.status !== 'unknown').length,
    progress: Math.round((at / DURATION) * 100),
    complete: at >= DURATION,
  };
}

export class DemoPlayer extends EventTarget {
  constructor() {
    super();
    this.seconds = 16;
    this.playing = false;
    this.scenario = 'search';
  }
  get snapshot() {
    return demoSnapshot(this.seconds, this.scenario);
  }
  changed() {
    this.dispatchEvent(new Event('change'));
  }
  play() {
    if (this.seconds >= DURATION) this.seconds = 0;
    this.playing = !this.playing;
    this.changed();
  }
  restart() {
    this.seconds = 0;
    this.playing = true;
    this.changed();
  }
  setScenario(id) {
    if (!SCENARIO_IDS.includes(id)) return;
    this.scenario = id;
    this.seconds = 16;
    this.playing = false;
    this.changed();
  }
  advance(delta) {
    if (!this.playing || !Number.isFinite(delta) || delta <= 0) return;
    this.seconds = clamp(this.seconds + delta, 0, DURATION);
    if (this.seconds === DURATION) this.playing = false;
    this.changed();
  }
}
