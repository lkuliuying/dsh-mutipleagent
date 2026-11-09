import { t } from './i18n.mjs';

const ACTIVE_STATUSES = new Set(['thinking', 'tool', 'typing', 'waiting', 'waiting_agents']);
const TERMINAL_STATUSES = new Set(['done', 'error', 'interrupted', 'closed']);

function short(value, length = 68) {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return text.length > length ? text.slice(0, length) + '…' : text;
}

function basename(value) {
  return typeof value === 'string'
    ? value
        .replace(/[\\/]+$/, '')
        .split(/[\\/]/)
        .pop()
    : '';
}

function code(id, prefix) {
  return id ? prefix + '-' + String(id).slice(-8) : prefix;
}

function reportPreview(agent, hasReport, historical) {
  if (hasReport) return t('live.reportReady');
  if (agent.reportEventId) return historical ? t('live.reportHistorical') : t('live.reportPending');
  switch (agent.status) {
    case 'done':
      return t('live.endedNoReport');
    case 'error':
      return t('live.errored');
    case 'interrupted':
      return t('live.interrupted');
    case 'closed':
      return t('live.agentClosed');
    case 'waiting':
      return short(agent.activity) || t('live.waitingUser');
    case 'waiting_agents':
      return t('live.awaitingSubagents');
    case 'typing':
      return t('live.typingMessage');
    case 'tool':
      return short(agent.activity) || t('live.runningTool');
    case 'thinking':
      return t('live.thinking');
    case 'idle':
      return t('live.idle');
    default:
      return t('live.awaitingLog');
  }
}

function icon(agent, isRoot) {
  if (isRoot) return 'diagram-3-fill';
  const text = [agent.role, agent.task].filter(Boolean).join(' ');
  if (/测试|检查|审查|review|test/i.test(text)) return 'shield-check';
  if (/前端|界面|frontend|\bUI\b/i.test(text)) return 'file-earmark-code-fill';
  return 'cpu-fill';
}

function isHistorical(agent, root, events) {
  if (!Number.isFinite(root?.turnStartedAt) || !TERMINAL_STATUSES.has(agent.status)) return false;
  const times = [agent.lastEventAt, agent.endedAt].filter(Number.isFinite);
  if (!times.length || Math.max(...times) >= root.turnStartedAt) return false;
  const related = events.concat(Array.isArray(agent.events) ? agent.events : []);
  return !related.some(event => event.targetId === agent.id && (event.type === 'assign' || event.type === 'message') && event.at >= root.turnStartedAt);
}

function hasCurrentReport(agent, root, events) {
  if (!agent.reportEventId) return false;
  const related = events.concat(Array.isArray(agent.events) ? agent.events : []);
  const report = related.find(event => event.id === agent.reportEventId && event.type === 'report');
  const instructions = related.filter(
    event => agent.id !== root?.id && event.targetId === agent.id && (event.type === 'assign' || event.type === 'message') && Number.isFinite(event.at),
  );
  const boundaries = [root?.turnStartedAt, agent.turnStartedAt, ...instructions.map(event => event.at)].filter(Number.isFinite);
  // 追加指令可能先到父日志；此时子日志仍保留上轮的终态和报告 ID。
  const reportAt = Number.isFinite(report?.at) ? report.at : Number.isFinite(agent.endedAt) ? agent.endedAt : agent.lastEventAt;
  return !Number.isFinite(reportAt) || !boundaries.length || reportAt >= Math.max(...boundaries);
}

// 仅转换日志已有信息；工位编号独立于快照的排列与任务终态。
export class LiveViewAdapter {
  constructor() {
    this.rootId = null;
    this.slots = new Map();
    this.nextSlot = 1;
  }

  update(rawSnapshot = {}, now = Date.now()) {
    const rootId = rawSnapshot.rootId || null;
    if (rootId !== this.rootId) {
      this.rootId = rootId;
      this.slots.clear();
      this.nextSlot = 1;
    }
    if (rootId) this.slots.set(rootId, 0);

    const roots = Array.isArray(rawSnapshot.roots) ? rawSnapshot.roots : [];
    const rawAgents = Array.isArray(rawSnapshot.agents) ? rawSnapshot.agents : [];
    const events = Array.isArray(rawSnapshot.events) ? rawSnapshot.events : [];
    const root = rawAgents.find(agent => agent.id === rootId);
    const rootEntry = roots.find(entry => entry.id === rootId);
    const agents = rawAgents
      .map(agent => {
        const isRoot = agent.id === rootId;
        if (!this.slots.has(agent.id)) this.slots.set(agent.id, this.nextSlot++);
        const slot = this.slots.get(agent.id);
        const name = agent.name || (isRoot ? t('live.leadName') : t('live.subName', { id: String(agent.id).slice(-8) }));
        const historical = !isRoot && isHistorical(agent, root, events);
        const currentHasReport = hasCurrentReport(agent, root, events);
        return {
          ...agent,
          agent: agent.agent || (rawSnapshot.source === 'harness' ? 'dsh' : 'codex'),
          source: agent,
          slot,
          historical,
          name,
          title: short(agent.task || (isRoot && rootEntry?.title) || agent.role || name),
          role: agent.role || (isRoot ? t('app.roleLead') : t('app.roleSubAgent')),
          zone: isRoot ? t('live.zoneLead') : t('live.zoneSlot', { slot }),
          icon: icon(agent, isRoot),
          file: short(agent.activity || agent.model) || t('common.notRecorded'),
          code: code(agent.id, 'AGENT'),
          progress: agent.status === 'done' ? 100 : null,
          report: null,
          hasReport: currentHasReport,
          currentHasReport,
          reportPreview: reportPreview(agent, currentHasReport, historical),
        };
      })
      .sort((a, b) => a.slot - b.slot);

    const children = agents.filter(agent => agent.id !== rootId && agent.parentId && !agent.historical);
    const received = children.filter(agent => agent.hasReport).length;
    const complete = root?.status === 'done';
    let stage = children.length ? 1 : 0;
    if (received) stage = 2;
    if (
      complete ||
      agents.find(agent => agent.id === rootId)?.hasReport ||
      (root?.status === 'typing' && children.length > 0 && children.every(agent => TERMINAL_STATUSES.has(agent.status)))
    )
      stage = 3;

    const elapsedKnown = Number.isFinite(root?.turnStartedAt);
    let end = now;
    if (TERMINAL_STATUSES.has(root?.status)) {
      end = Number.isFinite(root.endedAt) ? root.endedAt : Number.isFinite(root.lastEventAt) ? root.lastEventAt : now;
    }
    const seconds = elapsedKnown ? Math.max(0, Math.floor((end - root.turnStartedAt) / 1000)) : 0;

    return {
      ...rawSnapshot,
      mode: 'live',
      rootId,
      scenario: rootId,
      config: {
        title: short(root?.task || rootEntry?.title || root?.name) || (rawSnapshot.source === 'harness' ? t('live.harnessSession') : t('live.codexSession')),
        project: basename(root?.cwd || rootEntry?.cwd) || (rawSnapshot.source === 'harness' ? t('live.harnessName') : t('live.codexName')),
        code: code(rootId, 'SESSION'),
      },
      seconds,
      elapsedKnown,
      stage,
      agents,
      events,
      roots,
      warnings: Array.isArray(rawSnapshot.warnings) ? rawSnapshot.warnings : [],
      assigned: children.length,
      received,
      active: agents.filter(agent => ACTIVE_STATUSES.has(agent.status)).length,
      progress: complete ? 100 : null,
      complete,
    };
  }
}
