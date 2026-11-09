'use strict';

const { EventEmitter } = require('node:events');
const { createHash } = require('node:crypto');
const ROOT_LIMIT = 500;
const TEAM_LIMIT = 128;
const TITLE_REFRESH_INTERVAL = 30000;
const terminal = new Set(['done', 'error', 'interrupted', 'closed']);
const textOf = content =>
  Array.isArray(content)
    ? content
        .filter(block => block?.type === 'text' && typeof block.text === 'string')
        .map(block => block.text)
        .join('\n')
    : '';
const short = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 180) : '');
const digest = value => createHash('sha256').update(value).digest('hex');
const eventId = (sessionId, seq, type) => 'dsh:' + encodeURIComponent(sessionId) + ':' + seq + ':' + type;
// 日志指纹用于跳过未变化会话的重复折叠；DSH 只提供全量快照，这里不改变读取语义。
const logStamp = log => {
  const events = Array.isArray(log?.events) ? log.events : [];
  const last = events[events.length - 1];
  return [log?.session?.id || '', log?.inheritedEventCount ?? 0, events.length, last?.seq ?? -1, last?.time ?? 0].join(':');
};

function messageArguments(event) {
  if (event.type !== 'tool/call' || event.data?.name !== 'send_message') return null;
  try {
    const args = JSON.parse(event.data.arguments);
    return typeof args.agent_id === 'string' && typeof args.message === 'string' ? args : null;
  } catch {
    return null;
  }
}

function visibleText(event, kind) {
  if (kind === 'user') return event.type === 'user/message' && event.data?.source?.kind === 'user' ? textOf(event.data.content) : '';
  if (kind === 'assistant') return event.type === 'assistant/message' ? textOf(event.data?.message?.content) : '';
  if (kind === 'message')
    return event.type === 'user/message' && ['agent-message', 'subagent-settled'].includes(event.data?.source?.kind) ? textOf(event.data.content) : '';
  if (kind === 'sent') return messageArguments(event)?.message || '';
  if (kind === 'tool') return event.type === 'tool/call' && typeof event.data?.name === 'string' ? event.data.name : '';
  return '';
}

function createdAtValue(value) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}
function newestRoots(records) {
  return [...records]
    .filter(record => record.header.origin !== 'subagent')
    .sort((a, b) => createdAtValue(b.header.createdAt) - createdAtValue(a.header.createdAt));
}

function newAgent(header) {
  const parentId = header.origin === 'subagent' ? header.parentSession || null : null;
  return {
    id: header.id,
    key: header.id,
    agent: 'dsh',
    parentId,
    rootId: null,
    name: parentId ? '子 Agent ' + header.id.slice(-6) : '主 Agent',
    role: parentId ? '子 Agent' : '协调与汇总',
    cwd: typeof header.cwd === 'string' ? header.cwd : '',
    model: '',
    status: 'unknown',
    activity: '',
    task: '',
    taskEventId: null,
    taskSessionId: null,
    reportEventId: null,
    reports: [],
    startedAt: header.createdAt || null,
    turnStartedAt: null,
    lastEventAt: null,
    endedAt: null,
    relationship: parentId ? 'confirmed' : 'root',
    subagent: Boolean(parentId),
    loading: true,
  };
}

function rootOf(id, records) {
  const seen = new Set();
  while (records.has(id)) {
    if (seen.has(id)) return null;
    seen.add(id);
    const header = records.get(id).header;
    // 普通 fork 也有 parentSession，只有明确的 subagent origin 才建立团队关系。
    if (header.origin !== 'subagent') return id;
    if (!header.parentSession) return null;
    id = header.parentSession;
  }
  return null;
}

function fold(log, records) {
  const agent = newAgent(log.session);
  agent.loading = false;
  const events = [],
    refs = new Map(),
    calls = new Map();
  let lastAssistant = null,
    lastSent = null,
    descriptorSeen = false,
    ownTurn = false;
  const add = (raw, type, text = '', extra = {}, kind) => {
    const id = eventId(log.session.id, raw.seq, type);
    const result = { id, sessionId: agent.id, targetId: null, type, at: raw.time, preview: short(text), hasText: Boolean(kind && text), ...extra };
    events.push(result);
    if (kind && text) refs.set(id, { owner: log.session.id, seq: raw.seq, kind, hash: digest(text), sessionId: result.sessionId, type });
    return result;
  };
  const inherited = Number.isSafeInteger(log.inheritedEventCount) ? log.inheritedEventCount : 0;
  for (const raw of log.events.slice(inherited)) {
    const data = raw.data || {};
    // fork cut 后的合成收尾属于父轮次，不能当成子 Agent 已执行或失败。
    if (inherited && !ownTurn && ['tool/result', 'step/end', 'turn/end'].includes(raw.type)) continue;
    agent.lastEventAt = raw.time;
    // 替换用的模型上下文副本不属于用户已见的原始对话。
    if (raw.surfaceOp && raw.surfaceOp !== 'append') continue;
    if (raw.type === 'turn/start') {
      ownTurn = true;
      agent.turnStartedAt = raw.time;
      agent.endedAt = null;
      agent.status = 'thinking';
      agent.activity = '';
      lastAssistant = lastSent = null;
      calls.clear();
    } else if (raw.type === 'user/message') {
      if (data.source?.kind === 'user') {
        const text = visibleText(raw, 'user');
        if (!text) continue;
        const item = add(raw, 'task', text, {}, 'user');
        agent.task = short(text);
        agent.taskEventId = item.id;
        agent.taskSessionId = agent.id;
      } else if (['agent-message', 'subagent-settled'].includes(data.source?.kind)) {
        const sender = data.source.senderSessionId;
        const senderHeader = records.get(sender)?.header;
        const related = agent.parentId === sender || (senderHeader?.origin === 'subagent' && senderHeader.parentSession === agent.id);
        if (related) add(raw, 'message', visibleText(raw, 'message'), { sessionId: sender, targetId: agent.id }, 'message');
      }
    } else if (raw.type === 'assistant/message') {
      const text = visibleText(raw, 'assistant');
      lastAssistant = text ? { raw, text, kind: 'assistant' } : null;
      if (text) {
        add(raw, 'progress', text, {}, 'assistant');
        if (!terminal.has(agent.status)) agent.status = 'typing';
      }
      if (typeof data.message?.source?.model === 'string') agent.model = data.message.source.model;
    } else if (raw.type === 'tool/call') {
      const name = typeof data.name === 'string' ? data.name : '';
      calls.set(data.callId, { name, raw });
      agent.status = name === 'wait' || name === 'wait_agent' ? 'waiting_agents' : name === 'ask_user' ? 'waiting' : 'tool';
      agent.activity = name;
      add(raw, agent.status === 'waiting_agents' ? 'wait' : agent.status === 'waiting' ? 'approval' : 'tool', name, {}, 'tool');
    } else if (raw.type === 'tool/result') {
      const callId = data.message?.source?.callId || data.message?.toolCallId;
      const call = calls.get(callId),
        name = call?.name;
      calls.delete(callId);
      if (data.message?.isError || data.error) add(raw, 'error', name ? name + ' 执行失败' : '工具执行失败');
      else if (call) {
        const sent = messageArguments(call.raw);
        if (
          sent &&
          (sent.agent_id === agent.parentId ||
            (records.get(sent.agent_id)?.header.parentSession === agent.id && records.get(sent.agent_id)?.header.origin === 'subagent'))
        ) {
          // 调用结果成功后才表示消息已接收；单有工具请求不能证明投递成功。
          add(call.raw, 'message', sent.message, { targetId: sent.agent_id, at: raw.time }, 'sent');
          if (sent.agent_id === agent.parentId) lastSent = { raw: call.raw, text: sent.message, kind: 'sent' };
        }
      }
      if (!terminal.has(agent.status)) {
        agent.status = calls.size ? 'tool' : 'thinking';
        agent.activity = calls.size ? [...calls.values()].at(-1).name : '';
      }
    } else if (raw.type === 'request/context') {
      if (typeof data.model === 'string') agent.model = data.model;
    } else if (raw.type === 'subagent/descriptor' && !descriptorSeen) {
      descriptorSeen = true;
      if (data.version === 3 && ['one-shot', 'continuable'].includes(data.mode)) {
        if (typeof data.label === 'string') agent.name = data.label;
        if (typeof data.agentModel === 'string') agent.model = data.agentModel;
      }
    } else if (raw.type === 'subagent/catalog') {
      const child = records.get(data.childId)?.header;
      if ([0, 1].includes(data.version) && child?.origin === 'subagent' && child.parentSession === agent.id) {
        add(raw, 'assign', typeof data.label === 'string' ? data.label : '分配子 Agent', { targetId: child.id });
      }
    } else if (raw.type === 'turn/end') {
      const reason = data.reason?.kind;
      agent.status =
        reason === 'completed'
          ? 'done'
          : ['aborted', 'interrupted', 'forked'].includes(reason)
            ? 'interrupted'
            : ['error', 'max-tokens', 'refusal'].includes(reason)
              ? 'error'
              : reason === 'blocked'
                ? 'waiting'
                : 'unknown';
      agent.activity = reason === 'max-tokens' ? '输出达到上限' : reason === 'blocked' ? '本轮被阻止' : '';
      agent.endedAt = raw.time;
      if (agent.status === 'done') {
        const report = !lastAssistant || lastSent?.raw.seq > lastAssistant.raw.seq ? lastSent : lastAssistant;
        if (report) {
          const item = add(report.raw, 'report', report.text, {}, report.kind);
          agent.reportEventId = item.id;
          agent.reports.push(item.id);
        }
      }
      add(
        raw,
        agent.status === 'done' ? 'complete' : agent.status === 'error' ? 'error' : agent.status === 'interrupted' ? 'interrupted' : 'progress',
        agent.activity,
      );
      calls.clear();
    }
  }
  // 长会话只向页面保留近期活动；任务和最近报告的引用仍支持按需全文读取。
  const recent = events.sort((a, b) => a.at - b.at).slice(-160);
  agent.reports = agent.reports.slice(-8);
  const keep = new Set([agent.taskEventId, ...agent.reports, ...recent.map(event => event.id)]);
  const title = short(log.events.findLast(event => event.type === 'session/title')?.data?.title);
  return { agent, title, events: recent, refs: new Map([...refs].filter(([id]) => keep.has(id))) };
}

class HarnessWatcher extends EventEmitter {
  constructor({ query, interval = 1000 } = {}) {
    super();
    if (!query || typeof query.listSessions !== 'function' || typeof query.readSession !== 'function' || typeof query.readEvent !== 'function') {
      throw new TypeError('HarnessWatcher 需要公开的 sessionQuery 服务');
    }
    this.query = query;
    this.interval = interval;
    this.records = new Map();
    this.cache = new Map();
    this.titles = new Map();
    this.warnings = [];
    this.subscriptions = new Map();
    this.selectedId = null;
    this.revision = 0;
    this.epoch = 0;
    this.stopped = false;
    this.running = false;
    this.pending = null;
    this.queued = false;
    this.signature = '';
    // 需求驱动：没有 SSE 客户端且没有订阅时不扫描宿主会话，页面打开后再立即刷新。
    this.clients = 0;
    this.lastReadAt = 0;
    this.lastReadMs = 0;
    this.memberCount = 0;
  }

  async start() {
    if (this.running) return this;
    this.running = true;
    this.stopped = false;
    const epoch = this.epoch;
    await this.refresh();
    if (this.running && !this.stopped && epoch === this.epoch) {
      this.timer = setInterval(() => {
        if (this.wanted()) void this.refresh();
      }, this.interval);
      this.timer.unref?.();
    }
    return this;
  }

  /** 有客户端订阅、或被页面打开时才需要轮询。 */
  wanted() {
    return this.clients > 0 || this.subscriptions.size > 0;
  }

  /** 由服务端在 SSE 连接增减时调用。 */
  setClients(count) {
    this.clients = Math.max(0, Number(count) || 0);
    if (this.clients > 0) void this.refresh();
  }

  /** 供 /api/health 读取的运行时指标（不要叫 status：基类已有同名的 Agent 状态写法）。 */
  metrics() {
    return {
      sessions: this.records.size,
      members: this.memberCount,
      clients: this.clients,
      subscriptions: this.subscriptions.size,
      lastReadAt: this.lastReadAt || null,
      lastReadMs: this.lastReadMs,
      revision: this.revision,
      interval: this.interval,
      polling: this.wanted(),
    };
  }

  stop() {
    this.running = false;
    this.stopped = true;
    this.epoch++;
    clearInterval(this.timer);
    this.subscriptions.clear();
  }

  subscribe(id) {
    const rootId = id && rootOf(id, this.records);
    if (this.stopped || !rootId || !this.roots().some(root => root.id === rootId)) return () => {};
    this.subscriptions.set(rootId, (this.subscriptions.get(rootId) || 0) + 1);
    void this.refresh();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = this.subscriptions.get(rootId) || 0;
      if (count > 1) this.subscriptions.set(rootId, count - 1);
      else this.subscriptions.delete(rootId);
      if (!this.stopped) void this.refresh();
    };
  }

  select(id) {
    if (this.stopped) return false;
    const rootId = rootOf(id, this.records);
    if (!rootId || !this.roots().some(root => root.id === rootId)) return false;
    if (this.selectedId !== rootId) {
      this.selectedId = rootId;
      void this.refresh();
    }
    return true;
  }

  refresh() {
    if (this.stopped) return Promise.resolve(this);
    if (this.pending) {
      this.queued = true;
      return this.pending;
    }
    const epoch = this.epoch;
    this.pending = (async () => {
      do {
        this.queued = false;
        try {
          await this.read(epoch);
        } catch {
          if (!this.stopped && epoch === this.epoch) {
            this.warnings = ['DSH 会话读取暂时受阻，保留上次状态'];
            this.publish();
          }
        }
      } while (this.queued && !this.stopped && epoch === this.epoch);
      return this;
    })().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  async read(epoch) {
    const startedAt = Date.now();
    const listed = await this.query.listSessions();
    if (this.stopped || epoch !== this.epoch) return;
    const records = new Map(listed.map(record => [record.header.id, record]));
    // 语料签名：会话集合变化会影响父子归属，此时所有折叠结果都要重算。
    const corpus = [...records.keys()].sort().join(',') + '|' + records.size;
    const allRoots = newestRoots(records.values());
    const roots = allRoots.slice(0, ROOT_LIMIT);
    const selectedId = roots.some(record => record.header.id === this.selectedId) ? this.selectedId : roots[0]?.header.id || null;
    const activeRoots = new Set([selectedId, ...this.subscriptions.keys()].filter(id => roots.some(record => record.header.id === id)));
    const limited = [],
      warnings = [];
    if (allRoots.length > ROOT_LIMIT) warnings.push('会话较多，仅显示最近 ' + ROOT_LIMIT + ' 个（共 ' + allRoots.length + ' 个）');
    for (const rootId of activeRoots) {
      const team = [...records.values()].filter(record => rootOf(record.header.id, records) === rootId);
      limited.push(...team.sort((a, b) => (a.header.id === rootId ? -1 : b.header.id === rootId ? 1 : 0)).slice(0, TEAM_LIMIT));
      if (team.length > TEAM_LIMIT) warnings.push('团队超过 128 位成员，仅同步前 128 位');
    }
    const cache = new Map();
    // 小批次限制同时读取的完整会话数量，单个成员不可读不阻断其他成员。
    for (let offset = 0; offset < limited.length; offset += 4) {
      const batch = limited.slice(offset, offset + 4);
      const results = await Promise.allSettled(batch.map(record => this.query.readSession(record.header.id)));
      if (this.stopped || epoch !== this.epoch) return;
      for (let index = 0; index < batch.length; index++) {
        const record = batch[index],
          result = results[index];
        try {
          if (result.status === 'rejected') throw result.reason;
          const stamp = corpus + '#' + logStamp(result.value);
          const previous = this.cache.get(record.header.id);
          if (previous?.stamp === stamp) {
            cache.set(record.header.id, previous);
            continue;
          }
          cache.set(record.header.id, { ...fold(result.value, records), stamp });
        } catch {
          // 读取失败时沿用上一轮内容，但不携带指纹，恢复后一定重算。
          const previous = this.cache.get(record.header.id);
          cache.set(
            record.header.id,
            previous
              ? { agent: previous.agent, events: previous.events, refs: previous.refs }
              : { agent: { ...newAgent(record.header), loading: false }, events: [], refs: new Map() },
          );
          warnings.push('有成员会话暂时无法读取，其他成员继续同步');
        }
      }
    }
    const titles = await this.readTitles(roots, cache);
    if (this.stopped || epoch !== this.epoch) return;
    if ([...titles.values()].some(entry => entry.failed)) warnings.push('部分会话标题暂时无法读取，仍可按时间和会话标识选择');
    if (this.selectedId && this.selectedId !== selectedId && roots.some(record => record.header.id === this.selectedId)) {
      this.queued = true;
      return;
    }
    this.records = records;
    this.cache = cache;
    this.titles = titles;
    this.selectedId = selectedId;
    this.warnings = [...new Set(warnings)];
    this.memberCount = limited.length;
    this.lastReadAt = Date.now();
    this.lastReadMs = this.lastReadAt - startedAt;
    this.publish();
  }

  async readTitles(roots, cache) {
    const now = Date.now(),
      titles = new Map(),
      pending = [];
    for (const { header } of roots) {
      const previous = this.titles.get(header.id);
      const entry = previous?.createdAt === header.createdAt ? previous : null;
      const loaded = cache.get(header.id);
      if (loaded && Object.hasOwn(loaded, 'title')) {
        // 团队正文已经读取，直接复用标题事件，保证当前会话重命名及时显示。
        titles.set(header.id, { title: loaded.title, checkedAt: now, createdAt: header.createdAt });
      } else {
        if (entry) titles.set(header.id, entry);
        if ((!entry || now - entry.checkedAt >= TITLE_REFRESH_INTERVAL) && typeof this.query.readTitleSnapshots === 'function') pending.push(header);
      }
    }
    if (!pending.length) return titles;
    // 宿主标题投影会读取冷会话；只定期批量查询，避免每秒扫描全部会话正文。
    let results;
    try {
      results = await this.query.readTitleSnapshots(pending.map(header => header.id));
    } catch {
      results = [];
    }
    for (const header of pending) {
      const result = results.find(item => item.sessionId === header.id);
      const fulfilled = result?.status === 'fulfilled';
      titles.set(header.id, {
        title: fulfilled ? short(result.value.title?.title) : titles.get(header.id)?.title || '',
        createdAt: header.createdAt,
        checkedAt: now,
        failed: !fulfilled,
      });
    }
    return titles;
  }

  roots() {
    return newestRoots(this.records.values())
      .slice(0, ROOT_LIMIT)
      .map(({ header }) => {
        const agent = this.cache.get(header.id)?.agent;
        return {
          id: header.id,
          title: this.titles.get(header.id)?.title || agent?.task || '',
          cwd: header.cwd || '',
          createdAt: header.createdAt,
          status: agent?.status || 'unknown',
          at: agent?.lastEventAt || header.createdAt,
        };
      });
  }

  snapshot(rootId) {
    const selected = rootId ? rootOf(rootId, this.records) : this.selectedId;
    const members = selected
      ? [...this.records.values()]
          .filter(record => rootOf(record.header.id, this.records) === selected)
          .sort((a, b) => (a.header.id === selected ? -1 : b.header.id === selected ? 1 : 0))
          .slice(0, TEAM_LIMIT)
      : [];
    const entries = members.map(record => this.cache.get(record.header.id) || { agent: newAgent(record.header), events: [] });
    const events = entries.flatMap(entry => entry.events).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    return {
      mode: 'live',
      source: 'harness',
      provider: 'dsh',
      revision: this.revision,
      rootId: selected || null,
      roots: this.roots(),
      agents: entries.map(({ agent }) => ({
        ...agent,
        rootId: selected,
        reports: [...agent.reports],
        events: events
          .filter(event => event.sessionId === agent.id || event.targetId === agent.id)
          .slice(-80)
          .map(event => ({ ...event })),
      })),
      events: events.slice(-160).map(event => ({ ...event })),
      totalEvents: events.length,
      warnings: [...this.warnings],
      updatedAt: Date.now(),
    };
  }

  publish() {
    const snapshot = this.snapshot();
    const signature = JSON.stringify({ ...snapshot, revision: 0, updatedAt: 0 });
    if (signature === this.signature) return;
    this.signature = signature;
    this.revision++;
    this.emit('change');
  }

  async fullText(sessionId, id) {
    const ref = [...this.cache.values()].map(entry => entry.refs.get(id)).find(value => value?.sessionId === sessionId);
    if (!ref || this.stopped) return null;
    const epoch = this.epoch;
    const { target } = await this.query.readEvent({ sessionId: ref.owner, seq: ref.seq, before: 0, after: 0 });
    if (this.stopped || epoch !== this.epoch) return null;
    const text = target?.seq === ref.seq ? visibleText(target, ref.kind) : '';
    if (digest(text) !== ref.hash) throw new Error('原始记录已改变，请刷新后重试');
    return { id, sessionId, type: ref.type, text };
  }
}

module.exports = { HarnessWatcher };
