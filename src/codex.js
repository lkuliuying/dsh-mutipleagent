'use strict';

// 基于上游 watcher 的增量读取方式，仅保留 Codex 数据源。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const unreadableTask = '任务正文未记录为可见明文';
const isOpaque = (text) => typeof text === 'string' && /^gAAAAA[A-Za-z0-9_-]{90,}={0,2}$/.test(text.trim());
const visibleText = (value) => typeof value === 'string' && !isOpaque(value) ? value : '';
const short = (v, n = 180) => visibleText(String(v || '')).replace(/\s+/g, ' ').trim().slice(0, n);
const textOf = (content) => typeof content === 'string' ? visibleText(content)
  : Array.isArray(content) ? content.map((x) => visibleText(x.text)).filter(Boolean).join('\n') : '';
const contextOnly = (text) => {
  let rest = text.trim();
  // 只排除完整的上下文包装；普通请求中的示例、代码块仍属于用户任务。
  const block = /^(?:# AGENTS\.md instructions[ \t]*\r?\n\s*<INSTRUCTIONS>[\s\S]*?<\/INSTRUCTIONS>|<(environment_context|external_codex_apps_[\w.-]+)>[\s\S]*?<\/\1>)\s*/;
  while (rest) {
    const match = rest.match(block);
    if (!match) return false;
    rest = rest.slice(match[0].length);
  }
  return true;
};
const digest = (v) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 20);
const parseArgs = (v) => {
  if (v && typeof v === 'object') return v;
  try { const parsed = JSON.parse(v || '{}'); return parsed && typeof parsed === 'object' ? parsed : {}; } catch { return {}; }
};
const terminal = new Set(['done', 'error', 'interrupted', 'closed']);
const toolName = (v) => String(v || '').split('.').pop();

function newAgent(id) {
  return { id, key: id, agent: 'codex', parentId: null, rootId: id, name: null,
    role: null, cwd: '', model: '', status: 'unknown', activity: '', task: '',
    taskEventId: null, taskSessionId: null, reportEventId: null, startedAt: null, turnStartedAt: null,
    lastEventAt: null, endedAt: null, relationship: 'unconfirmed', reports: [] };
}

class CodexWatcher extends EventEmitter {
  constructor({ codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
    interval = 1000, scanInterval = 5000, hours = 24, rootsLimit = 60 } = {}) {
    super();
    this.home = codexHome;
    this.dir = path.join(codexHome, 'sessions');
    this.interval = interval;
    this.scanInterval = scanInterval;
    this.window = hours * 3600000;
    this.rootsLimit = rootsLimit;
    this.files = new Map();
    this.agents = new Map();
    this.tracks = new Map();
    this.events = new Map();
    this.eventKeys = new Map();
    this.pins = new Set();
    this.pendingCalls = new Map();
    this.pathAssignments = new Map();
    this.pendingTargets = new Map();
    this.lastScan = 0;
    this.revision = 0;
    this.warnings = new Map();
  }

  agent(id) {
    if (!this.agents.has(id)) this.agents.set(id, newAgent(id));
    return this.agents.get(id);
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), this.interval);
    return this;
  }

  stop() { clearInterval(this.timer); }

  readHeader(file) {
    const fd = fs.openSync(file, 'r');
    try {
      const blocks = [];
      let at = 0;
      for (;;) {
        const buf = Buffer.alloc(65536);
        const n = fs.readSync(fd, buf, 0, buf.length, at);
        if (!n) return null;
        at += n;
        const end = buf.subarray(0, n).indexOf(10);
        blocks.push(buf.subarray(0, end < 0 ? n : end));
        if (end >= 0) return JSON.parse(Buffer.concat(blocks).toString('utf8'));
      }
    } finally { fs.closeSync(fd); }
  }

  scan(now) {
    const found = new Map();
    const walk = (dir) => {
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
      catch (e) { if (e.code !== 'ENOENT') this.warnings.set('scan', '部分会话目录暂时无法读取'); return; }
      for (const entry of entries) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
          const match = entry.name.match(/([0-9a-f]{8}-[0-9a-f-]{27,})\.jsonl$/i);
          if (!match) continue;
          try {
            const st = fs.statSync(file);
            found.set(match[1], { file, size: st.size, mtime: st.mtimeMs });
          } catch { this.warnings.set('scan', '部分会话日志暂时无法读取'); }
        }
      }
    };
    walk(this.dir);
    this.files = found;
    const recent = [...found].filter(([, f]) => f.mtime >= now - this.window)
      .sort((a, b) => b[1].mtime - a[1].mtime).slice(0, this.rootsLimit * 4);
    for (const [id, f] of recent) this.ensureMeta(id, f);
    // 沿已知父 ID 补读元数据，不依赖父会话最近是否有写入。
    for (const s of [...this.agents.values()]) {
      if (s.parentId && found.has(s.parentId)) this.ensureMeta(s.parentId, found.get(s.parentId));
    }
    this.lastScan = now;
  }

  ensureMeta(id, f = this.files.get(id)) {
    if (!f) return;
    const s = this.agent(id);
    if (s._metaFile === f.file && s._hasMeta) return;
    try {
      const d = this.readHeader(f.file);
      if (d?.type === 'session_meta') {
        this.metadata(s, d.payload || {});
        s._metaFile = f.file;
        s._hasMeta = true;
      }
    } catch { this.warnings.set('header:' + id, '有会话元数据暂时不可用，将继续重试'); }
  }

  metadata(s, p) {
    if (p.id && p.id !== s.id) return;
    s.cwd = p.cwd || s.cwd;
    s.startedAt ||= Date.parse(p.timestamp) || null;
    s.name = p.agent_nickname || s.name;
    s.role = p.agent_role || p.agent_type || s.role;
    const spawn = p.source?.subagent?.thread_spawn;
    s._historyStart = Number.isInteger(p.subagent_history_start_ordinal) ? p.subagent_history_start_ordinal : s._historyStart || 0;
    s._internal = !!p.source?.internal || p.thread_source === 'guardian_review'
      || ['guardian', 'review', 'compact', 'memory_consolidation'].includes(p.source?.subagent?.other)
      || ['review', 'compact', 'memory_consolidation'].includes(p.source?.subagent);
    s.agentPath = p.agent_path || spawn?.agent_path || s.agentPath || null;
    s.name ||= s.agentPath?.split('/').filter(Boolean).pop() || null;
    const parent = p.parent_thread_id || spawn?.parent_thread_id;
    if (parent) this.link(s.id, parent, 'metadata');
    else if (p.thread_source === 'user' || typeof p.source === 'string') {
      if (!s.parentId) s.relationship = 'root';
    }
    if (spawn) {
      s.name = spawn.agent_nickname || s.name;
      s.role = spawn.agent_role || spawn.agent_type || s.role;
    }
    s._isSubagent = !!parent || !!p.source?.subagent || p.thread_source === 'subagent';
    if (s.agentPath && s.parentId) {
      const assignment = this.pathAssignments.get(s.parentId + ':' + s.agentPath);
      if (assignment) this.assign(this.agent(s.parentId), s.id, assignment.prompt, assignment.ref, assignment.callId);
    }
    this.resolvePendingTargets();
  }

  resolveTarget(sender, target) {
    if (typeof target !== 'string' || !target) return null;
    if (this.agents.has(target)) return target;
    const base = sender.agentPath || (!sender.parentId ? '/root' : null);
    const agentPath = target.startsWith('/') ? target : base && base + '/' + target;
    if (!agentPath) return null;
    return [...this.agents.values()].find((s) => !s._internal && s.agentPath === agentPath
      && this.rootOf(s.id) === this.rootOf(sender.id))?.id || null;
  }

  resolvePendingTargets() {
    for (const [id, pending] of this.pendingTargets) {
      const event = this.events.get(id);
      const sender = this.agents.get(pending.sender);
      if (!event || !sender) { this.pendingTargets.delete(id); continue; }
      const targetId = this.resolveTarget(sender, pending.target);
      if (targetId) {
        event.targetId = targetId;
        this.pendingTargets.delete(id);
        this.revision++;
      }
    }
  }

  link(childId, parentId, evidence) {
    if (!childId || !parentId || childId === parentId) return;
    const child = this.agent(childId);
    if (child.parentId && child.parentId !== parentId) {
      child.relationship = 'conflict';
      return;
    }
    // 防止异常元数据形成环，进而污染整棵团队树。
    let cursor = parentId;
    const seen = new Set([childId]);
    while (cursor) {
      if (seen.has(cursor)) { child.relationship = 'conflict'; return; }
      seen.add(cursor);
      cursor = this.agents.get(cursor)?.parentId;
    }
    this.agent(parentId);
    child.parentId = parentId;
    child.relationship = evidence;
    child._isSubagent = true;
  }

  rootOf(id) {
    let s = this.agents.get(id);
    const seen = new Set();
    while (s?.parentId && !seen.has(s.id)) {
      seen.add(s.id);
      s = this.agents.get(s.parentId);
    }
    return s?.id || id;
  }

  add(s, type, text, ref, { targetId = null, key = null } = {}) {
    const content = visibleText(text);
    const dedupe = key ? s.id + ':' + type + ':' + key : null;
    if (dedupe && this.eventKeys.has(dedupe)) return this.events.get(this.eventKeys.get(dedupe));
    const id = digest(s.id + ':' + ref.offset + ':' + (ref.hash || '') + ':' + type + ':' + (targetId || ''));
    const e = { id, sessionId: s.id, targetId, type, at: ref.at,
      preview: short(content), hasText: !!content, _ref: { ...ref } };
    this.events.set(id, e);
    if (dedupe) this.eventKeys.set(dedupe, id);
    s.lastEventAt = Math.max(s.lastEventAt || 0, ref.at || 0);
    this.revision++;
    return e;
  }

  status(s, state, at) {
    s.status = state;
    s.lastEventAt = Math.max(s.lastEventAt || 0, at || 0);
    s.endedAt = terminal.has(state) ? at : null;
    if (state !== 'tool' && state !== 'waiting') s.activity = '';
  }

  report(s, text, ref) {
    text = visibleText(text);
    if (!text) return null;
    const hash = digest(text);
    const previous = [...this.events.values()].reverse().find((e) => e.type === 'report'
      && e.sessionId === s.id && e._textHash === hash
      && (e._ref.ownerSessionId || ref.ownerSessionId));
    if (previous) {
      if (!ref.ownerSessionId) previous._ref = { ...ref };
      s.reportEventId = previous.id;
      if (!s.reports.includes(previous.id)) s.reports.push(previous.id);
      this.eventKeys.set(s.id + ':report:' + String(s._turn || '') + ':' + hash, previous.id);
      return previous;
    }
    const e = this.add(s, 'report', text, ref, { key: String(s._turn || '') + ':' + digest(text) });
    s.reportEventId = e.id;
    e._textHash = hash;
    if (!s.reports.includes(e.id)) s.reports.push(e.id);
    return e;
  }

  process(s, d, ref) {
    if (!d || typeof d !== 'object' || !d.payload || typeof d.payload !== 'object') return;
    const p = d.payload || {};
    if (d.type === 'session_meta') { this.metadata(s, p); return; }
    if (d.type === 'turn_context') { s.model = p.model || s.model; s.cwd = p.cwd || s.cwd; return; }
    if (d.type === 'event_msg') {
      const t = p.type;
      if (typeof t !== 'string') {
        this.warnings.set('structure:' + s.id, '日志中存在缺少类型的事件，已跳过该条记录');
        return;
      }
      if (t === 'task_started' || t === 'turn_started') {
        s._turn = p.turn_id || ref.offset;
        s.turnStartedAt = ref.at;
        s.reportEventId = null;
        this.status(s, 'thinking', ref.at);
      } else if (t === 'user_message') {
        if (!visibleText(p.message) || contextOnly(p.message)) return;
        const e = this.add(s, 'task', p.message, ref);
        s.task = short(p.message);
        s.taskEventId = e.id;
        s.taskSessionId = s.id;
        this.status(s, 'thinking', ref.at);
      } else if (t === 'agent_message') {
        if (p.phase === 'final_answer' || p.channel === 'final') this.report(s, p.message, ref);
        else this.add(s, 'progress', p.message, ref, { key: String(s._turn || '') + ':' + digest(p.message || '') });
        this.status(s, 'typing', ref.at);
      } else if (t === 'task_complete' || t === 'turn_completed') {
        this.report(s, p.last_agent_message, ref);
        this.status(s, 'done', ref.at);
        this.add(s, 'complete', '', ref, { key: String(s._turn || ref.offset) });
      } else if (t === 'turn_aborted') {
        this.status(s, 'interrupted', ref.at);
        this.add(s, 'interrupted', p.reason || '任务已中断', ref);
      } else if (t === 'error') {
        this.status(s, 'error', ref.at);
        this.add(s, 'error', p.message || 'Codex 记录了错误', ref);
      } else if (['exec_approval_request', 'apply_patch_approval_request', 'request_user_input'].includes(t)) {
        this.status(s, 'waiting', ref.at);
        s.activity = '等待用户处理';
        this.add(s, 'approval', p.message || p.reason || '等待用户处理，具体内容请查看 Codex', ref);
      } else if (t.startsWith('collab_')) this.collaboration(s, p, ref);
      else if (t === 'item_started' || t === 'item_completed') {
        const item = p.item || {};
        if (item.type === 'AgentMessage') {
          const text = textOf(item.content);
          if (item.phase === 'final_answer' || item.channel === 'final') this.report(s, text, ref);
          else this.add(s, 'progress', text, ref, { key: String(s._turn || '') + ':' + digest(text) });
        } else if (item.type === 'CommandExecution' || item.type === 'McpToolCall' || item.type === 'FileChange') {
          const activity = item.type === 'CommandExecution' ? short(Array.isArray(item.command) ? item.command.join(' ') : item.command)
            : item.type === 'FileChange' ? '修改文件' : String(item.tool || 'MCP 工具');
          this.status(s, t === 'item_started' ? 'tool' : 'thinking', ref.at);
          s.activity = activity;
          if (t === 'item_started') this.add(s, 'tool', activity, ref, { key: item.id || null });
        }
      }
      return;
    }
    if (d.type !== 'response_item') return;
    if (p.type === 'message' && p.role === 'user') {
      const text = textOf(p.content);
      if (!visibleText(text) || contextOnly(text)) return;
      const e = this.add(s, 'task', text, ref, { key: String(s._turn || '') + ':' + digest(text) });
      s.task = short(text); s.taskEventId = e.id; s.taskSessionId = s.id;
    } else if (p.type === 'message' && p.role === 'assistant') {
      const text = textOf(p.content);
      if (!text) return;
      if (p.phase === 'final_answer' || p.channel === 'final') this.report(s, text, ref);
      else this.add(s, 'progress', text, ref, { key: String(s._turn || '') + ':' + digest(text) });
      if (!terminal.has(s.status)) this.status(s, 'typing', ref.at);
    } else if (['function_call', 'custom_tool_call', 'local_shell_call', 'web_search_call'].includes(p.type)) {
      const name = toolName(p.name || p.type);
      const args = parseArgs(p.arguments || p.input || p.action);
      const callId = p.call_id || p.id;
      if (callId) this.pendingCalls.set(callId, { name, args, sender: s.id, ref });
      const waiting = name.startsWith('request_user_input');
      const waitingAgents = name === 'wait_agent';
      this.status(s, waitingAgents ? 'waiting_agents' : waiting ? 'waiting' : 'tool', ref.at);
      s.activity = name === 'interrupt_agent' ? short('请求中断 ' + (args.target || 'Agent'), 240)
        : short(args.cmd || args.command || p.name || p.type, 240);
      this.add(s, waitingAgents ? 'wait' : waiting ? 'approval' : 'tool', waitingAgents ? '' : s.activity, ref, { key: callId });
      if (['send_input', 'send_message', 'followup_task'].includes(name)) {
        const target = args.id || args.target;
        // 先记真实正文，再补关联；ID 不依赖子日志先后到达的顺序。
        const event = this.add(s, 'message', args.message || '', ref, { key: callId });
        event.targetId ||= this.resolveTarget(s, target);
        if (!event.targetId && typeof target === 'string') this.pendingTargets.set(event.id, { sender: s.id, target });
      }
    } else if (['function_call_output', 'custom_tool_call_output'].includes(p.type)) {
      const call = this.pendingCalls.get(p.call_id);
      if (call?.name === 'spawn_agent') {
        const out = parseArgs(p.output);
        const childId = out.agent_id || out.thread_id;
        if (childId) this.assign(s, childId, call.args.message || call.args.prompt || '', { ...call.ref, at: ref.at }, p.call_id, out);
        else if (out.task_name) {
          const assignment = { prompt: call.args.message || call.args.prompt || '', ref: { ...call.ref, at: ref.at }, callId: p.call_id };
          this.pathAssignments.set(s.id + ':' + out.task_name, assignment);
          const child = [...this.agents.values()].find((v) => v.parentId === s.id && v.agentPath === out.task_name);
          if (child) this.assign(s, child.id, assignment.prompt, assignment.ref, assignment.callId);
        }
      }
      if (call) this.pendingCalls.delete(p.call_id);
      if (!terminal.has(s.status)) this.status(s, 'thinking', ref.at);
    }
  }

  assign(s, childId, prompt, ref, callId, p = {}) {
    this.link(childId, s.id, 'spawn');
    const child = this.agent(childId);
    child.name = p.new_agent_nickname || p.agent_nickname || child.name;
    child.role = p.new_agent_role || p.agent_role || child.role;
    const e = this.add(s, 'assign', prompt, ref, { targetId: childId, key: callId || childId });
    if (!child.taskEventId) { child.task = isOpaque(prompt) ? unreadableTask : short(prompt); child.taskEventId = e.id; child.taskSessionId = s.id; }
    if (p.model) child.model = p.model;
  }

  collaboration(s, p, ref) {
    const sender = this.agent(p.sender_thread_id || s.id);
    if (p.type === 'collab_agent_spawn_begin') {
      this.pendingCalls.set(p.call_id, { prompt: p.prompt });
    } else if (p.type === 'collab_agent_spawn_end') {
      if (p.new_thread_id) this.assign(sender, p.new_thread_id, p.prompt || this.pendingCalls.get(p.call_id)?.prompt || '', ref, p.call_id, p);
      else this.add(sender, 'error', '子 Agent 创建失败', ref, { key: p.call_id });
      this.pendingCalls.delete(p.call_id);
    } else if (p.type === 'collab_agent_interaction_end') {
      this.add(sender, 'message', p.prompt || '', ref, { targetId: p.receiver_thread_id, key: p.call_id });
    } else if (p.type === 'collab_waiting_begin') {
      this.status(sender, 'waiting_agents', ref.at);
      this.add(sender, 'wait', '', ref, { key: p.call_id });
    } else if (p.type === 'collab_waiting_end') {
      this.status(sender, 'thinking', ref.at);
      const statuses = p.statuses || Object.fromEntries((p.agent_statuses || []).map((v) => [v.thread_id, v.status]));
      for (const [id, state] of Object.entries(statuses)) {
        const child = this.agent(id);
        if (typeof state === 'object' && state?.completed != null) {
          const e = this.report(child, state.completed, { ...ref, ownerSessionId: s.id });
          this.status(child, 'done', ref.at);
        } else if (typeof state === 'object' && state?.errored != null) this.status(child, 'error', ref.at);
      }
    } else if (p.type === 'collab_close_end' && p.receiver_thread_id) {
      const child = this.agent(p.receiver_thread_id);
      if (!terminal.has(child.status)) this.status(child, 'closed', ref.at);
      this.add(sender, 'close', '', ref, { targetId: child.id, key: p.call_id });
    }
  }

  load(id) {
    const f = this.files.get(id);
    if (!f) return;
    const st = fs.statSync(f.file);
    let track = this.tracks.get(id);
    if (track && (st.size < track.offset || track.file !== f.file || (st.size === track.offset && st.mtimeMs !== track.mtime))) {
      for (const [key, e] of this.events) if (e.sessionId === id || e._ref.ownerSessionId === id) this.events.delete(key);
      for (const [key, value] of this.eventKeys) if (!this.events.has(value)) this.eventKeys.delete(key);
      this.agents.set(id, newAgent(id));
      track = null;
      this.revision++;
    }
    if (!track) {
      track = { file: f.file, offset: 0, ordinal: 0, pending: Buffer.alloc(0), mtime: st.mtimeMs };
      this.tracks.set(id, track);
    }
    const s = this.agent(id);
    const fd = fs.openSync(f.file, 'r');
    try {
      // 按字节定位记录，UTF-8 半字和半行会留到下次写入后再解析。
      let budget = 16 * 1024 * 1024;
      while (track.offset < st.size && budget > 0) {
        const buf = Buffer.alloc(Math.min(1024 * 1024, st.size - track.offset));
        const n = fs.readSync(fd, buf, 0, buf.length, track.offset);
        if (!n) break;
        const start = track.offset - track.pending.length;
        const joined = Buffer.concat([track.pending, buf.subarray(0, n)]);
        track.offset += n;
        budget -= n;
        let lineStart = 0;
        for (let i = 0; i < joined.length; i++) if (joined[i] === 10) {
          const line = joined.subarray(lineStart, i).toString('utf8').trim();
          if (line) {
            try {
              const d = JSON.parse(line);
              if (track.ordinal === 0 || track.ordinal >= (s._historyStart || 0)) {
                this.process(s, d, { file: f.file, offset: start + lineStart,
                  length: i - lineStart, hash: digest(line), at: Date.parse(d.timestamp) || st.mtimeMs });
              }
            } catch (e) {
              if (e instanceof SyntaxError) this.warnings.set('parse:' + id, '日志中存在无法解析的记录，其他活动继续同步');
              else throw e;
            }
          }
          track.ordinal++;
          lineStart = i + 1;
        }
        track.pending = Buffer.from(joined.subarray(lineStart));
      }
      track.mtime = st.mtimeMs;
      s.loading = track.offset < st.size;
      s.lastEventAt ||= st.mtimeMs;
    } finally { fs.closeSync(fd); }
  }

  roots() {
    return [...this.agents.values()].filter((s) => !s.parentId && !s._isSubagent && !s._internal && this.files.has(s.id))
      .sort((a, b) => (this.files.get(b.id)?.mtime || 0) - (this.files.get(a.id)?.mtime || 0))
      .slice(0, this.rootsLimit).map((s) => ({
        id: s.id, title: s.task || path.basename(s.cwd) || 'Codex 任务', cwd: s.cwd,
        status: s.status, at: this.files.get(s.id)?.mtime || s.lastEventAt,
      }));
  }

  select(id) {
    if (!this.agents.has(id)) return false;
    this.pins.add(id);
    this.tick();
    return true;
  }

  tick() {
    const before = this.revision;
    try {
      const now = Date.now();
      if (!this.lastScan || now - this.lastScan >= this.scanInterval) this.scan(now);
      const roots = this.pins.size ? this.pins : new Set(this.roots().slice(0, 1).map((s) => s.id));
      // 创建事件可能先于子日志落盘；每一轮都重新扩展团队成员。
      for (let round = 0; round < 12; round++) {
        let added = false;
        for (const s of [...this.agents.values()]) if (roots.has(this.rootOf(s.id))) {
          if (this.files.has(s.id) && !s._internal) {
            try {
              this.ensureMeta(s.id);
              const had = this.tracks.has(s.id);
              this.load(s.id);
              if (!had) added = true;
              this.warnings.delete('read:' + s.id);
            } catch (e) {
              this.warnings.set('read:' + s.id, '有成员日志读取受阻（' + (e.code || e.name) + '），其他成员继续同步');
            }
          }
        }
        if (!added) break;
      }
      this.warnings.delete('runtime');
    } catch (e) {
      this.warnings.set('runtime', '会话读取暂时受阻（' + (e.code || e.name) + '），将自动重试');
    }
    if (before !== this.revision) this.emit('change');
  }

  snapshot(rootId) {
    const roots = this.roots();
    const selected = rootId && this.agents.has(rootId) ? this.rootOf(rootId) : roots[0]?.id || null;
    const members = [...this.agents.values()].filter((s) => this.rootOf(s.id) === selected && !s._internal);
    const ids = new Set(members.map((s) => s.id));
    const allEvents = [...this.events.values()].filter((e) => ids.has(e.sessionId))
      .sort((a, b) => a.at - b.at || a._ref.offset - b._ref.offset);
    const publicEvent = ({ _ref, _textHash, ...e }) => e;
    return { mode: 'live', revision: this.revision, rootId: selected, roots,
      agents: members.map((s) => {
        const agent = Object.fromEntries(Object.entries(s).filter(([k]) => !k.startsWith('_')));
        agent.rootId = selected;
        agent.name ||= s.id === selected ? '主 Agent' : '子 Agent ' + s.id.slice(0, 6);
        agent.subagent = !!s.parentId;
        agent.events = allEvents.filter((e) => e.sessionId === s.id || e.targetId === s.id).slice(-80).map(publicEvent);
        return agent;
      }),
      events: allEvents.slice(-160).map(publicEvent), totalEvents: allEvents.length,
      warnings: [...new Set(this.warnings.values())], updatedAt: Date.now() };
  }

  fullText(sessionId, eventId) {
    const e = this.events.get(eventId);
    if (!e || e.sessionId !== sessionId) return null;
    const ref = e._ref;
    const fd = fs.openSync(ref.file, 'r');
    let d;
    try {
      const buf = Buffer.alloc(ref.length);
      const n = fs.readSync(fd, buf, 0, buf.length, ref.offset);
      if (n !== ref.length) throw new Error('原始记录已经改变');
      const raw = buf.toString('utf8').trim();
      if (ref.hash && digest(raw) !== ref.hash) throw new Error('原始记录已经改变');
      d = JSON.parse(raw);
    } finally { fs.closeSync(fd); }
    const p = d.payload || {};
    let text = p.message || p.last_agent_message || p.prompt || textOf(p.content) || textOf(p.item?.content);
    if (p.type === 'collab_waiting_end') text = p.statuses?.[sessionId]?.completed
      || p.agent_statuses?.find((x) => x.thread_id === sessionId)?.status?.completed;
    if (p.type === 'function_call' || p.type === 'custom_tool_call') {
      const a = parseArgs(p.arguments || p.input);
      text = a.message || a.prompt || a.cmd || a.command || p.name;
    }
    const unavailable = isOpaque(text) && ['assign', 'task'].includes(e.type) ? unreadableTask : '';
    return { id: e.id, sessionId, type: e.type, text: visibleText(String(text || '')) || unavailable || e.preview || '' };
  }
}

module.exports = { CodexWatcher, newAgent, short, textOf };
