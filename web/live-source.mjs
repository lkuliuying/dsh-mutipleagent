import { LiveViewAdapter } from './live-state.mjs';
import { officeSource, officeUrl } from './base-url.mjs';

// 连接只读快照流；首次加载、切换及重连都建立动画基线。
export class LiveSource extends EventTarget {
  constructor(rootId) {
    super();
    this.adapter = new LiveViewAdapter();
    this.kind = officeSource();
    this.storageKey = this.kind === 'harness' ? 'office.harness.live.root' : 'office.live.root';
    this.raw = { source: this.kind };
    this.rootId = rootId || localStorage.getItem(this.storageKey) || '';
    this.follow = !rootId;
    this.connection = 'connecting';
    this.error = '';
    this.generation = 0;
    this.baseline = true;
    this.knownRoots = new Set();
    this.records = new Map();
  }

  get snapshot() { return this.adapter.update(this.raw); }

  changed(baseline = false) {
    this.dispatchEvent(new CustomEvent('change', { detail: { baseline } }));
  }

  async connect(rootId = this.rootId) {
    const generation = ++this.generation;
    this.rootId = rootId || '';
    this.source?.close();
    this.abort?.abort();
    this.abort = new AbortController();
    this.baseline = true;
    this.connection = 'connecting';
    this.error = '';
    this.changed(true);
    try {
      let response = await fetch(officeUrl('api/sessions?' + new URLSearchParams(rootId ? { rootId } : {})), { signal: this.abort.signal });
      // 保存的会话可能已被删除；明确指定的地址则保留错误，供用户重新选择。
      if (response.status === 404 && rootId && !new URLSearchParams(location.search).get('rootId')) {
        response = await fetch(officeUrl('api/sessions'), { signal: this.abort.signal });
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '读取会话失败');
      if (generation !== this.generation) return;
      this.accept(data);
      if (generation !== this.generation) return;
      const params = new URLSearchParams(this.rootId ? { rootId: this.rootId } : {});
      const source = this.source = new EventSource(officeUrl('events?' + params));
      source.onopen = () => {
        if (generation !== this.generation) return;
        this.baseline = true;
        this.connection = 'connected';
        this.error = '';
        this.changed(true);
      };
      source.onmessage = (event) => {
        if (generation !== this.generation) return;
        try { this.accept(JSON.parse(event.data)); }
        catch (error) { this.error = '读取事件失败：' + error.message; this.changed(true); }
      };
      source.onerror = () => {
        if (generation !== this.generation) return;
        this.baseline = true;
        this.connection = 'reconnecting';
        this.error = '连接已断开，正在重连；保留上次状态';
        this.changed(true);
      };
    } catch (error) {
      if (generation !== this.generation || error.name === 'AbortError') return;
      this.connection = 'error';
      this.error = error.message;
      this.changed(true);
    }
  }

  accept(data) {
    if (data.mode && data.mode !== 'live') throw new Error('当前服务使用模拟数据，请以普通模式启动办公室');
    const newest = data.roots?.[0];
    const newRoot = this.knownRoots.size && newest && !this.knownRoots.has(newest.id);
    for (const root of data.roots || []) this.knownRoots.add(root.id);
    if (this.follow && newRoot && newest.id !== data.rootId) {
      this.select(newest.id, true);
      return;
    }
    const baseline = this.baseline || data.rootId !== this.raw.rootId || data.agents?.some(agent => agent.loading);
    if (data.source === 'harness' && this.kind !== 'harness') {
      this.kind = 'harness';
      this.storageKey = 'office.harness.live.root';
    }
    this.raw = { ...data, source: this.kind };
    this.rootId = data.rootId || '';
    if (this.rootId) localStorage.setItem(this.storageKey, this.rootId);
    this.changed(baseline);
    this.baseline = Boolean(data.agents?.some(agent => agent.loading));
  }

  select(rootId, keepFollow = false) {
    if (!keepFollow) this.follow = false;
    this.raw = { source: this.kind, rootId, roots: this.raw.roots || [], agents: [], events: [] };
    this.records.clear();
    const url = new URL(location.href);
    url.searchParams.set('rootId', rootId);
    history.replaceState(null, '', url);
    return this.connect(rootId);
  }

  async record(sessionId, eventId) {
    const key = sessionId + ':' + eventId;
    if (this.records.has(key)) return this.records.get(key);
    const response = await fetch(officeUrl('api/report?' + new URLSearchParams({ sessionId, eventId })));
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '读取原始记录失败');
    this.records.set(key, data.text);
    return data.text;
  }

  destroy() { this.generation++; this.abort?.abort(); this.source?.close(); }
}
