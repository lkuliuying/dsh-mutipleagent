'use strict';
const { CodexWatcher } = require('./codex');

// 演示完全在内存运行，不打开本机 Codex 数据目录。
class DemoWatcher extends CodexWatcher {
  constructor() {
    super({ codexHome: '' });
    this.records = new Map();
    this.step = 0;
    this.epoch = Date.now();
    this.rootId = 'demo-main';
    this.agent(this.rootId).relationship = 'root';
    this.agent(this.rootId).cwd = '演示项目 / checkout-service';
    this.plan = [
      ['demo-main', 'task_started', {}],
      ['demo-main', 'user_message', { message: '检查结算服务：分别分析接口契约和测试缺口，最后汇总发现与建议。' }],
      ['demo-main', 'agent_message', { message: '我会把接口契约和测试缺口交给两位子 Agent 并行检查，再汇总结果。' }],
      ['demo-main', 'collab_agent_spawn_end', { call_id: 'spawn-api', new_thread_id: 'demo-api', new_agent_nickname: '林 · 接口分析', new_agent_role: '接口检查', prompt: '只读检查结算接口契约，返回问题与依据。' }],
      ['demo-api', 'task_started', {}],
      ['demo-main', 'collab_agent_spawn_end', { call_id: 'spawn-test', new_thread_id: 'demo-test', new_agent_nickname: '夏 · 测试审阅', new_agent_role: '测试检查', prompt: '只读检查测试覆盖，列出需要补充的边界场景。' }],
      ['demo-test', 'task_started', {}],
      ['demo-main', 'collab_waiting_begin', { call_id: 'wait-team' }],
      ['demo-api', 'agent_message', { message: '正在对照请求字段和错误响应，已定位到金额精度的边界。' }],
      ['demo-test', 'agent_message', { message: '正在检查重复请求、空购物车和库存不足场景。' }],
      ['demo-api', 'task_complete', { last_agent_message: '接口检查完成。\n\n1. 金额使用最小货币单位的整数表示，避免浮点误差。\n2. 重复请求需要同一个幂等键。\n3. 库存不足应返回明确的业务错误。\n\n以上均为演示内容。' }],
      ['demo-test', 'task_complete', { last_agent_message: '测试检查完成。\n\n建议补充：\n• 空购物车提交。\n• 幂等键重复使用。\n• 库存不足时无扣款。\n• 请求金额与服务端计算不一致。\n\n以上均为演示内容。' }],
      ['demo-main', 'collab_waiting_end', { call_id: 'wait-team' }],
      ['demo-main', 'agent_message', { message: '两位子 Agent 已完成检查，我正在整理共同结论和后续建议。' }],
      ['demo-main', 'task_complete', { last_agent_message: '协作检查已完成（演示）。\n\n接口与测试检查都指向两个重点：金额的一致性和重复请求的幂等性。\n\n建议优先补充金额校验、幂等处理及对应边界测试，再验证库存不足时的失败路径。\n\n本界面没有执行任何代码检查；这些消息用于展示分配、并行执行、汇报和总结。' }],
    ];
    for (let i = 0; i < 7; i++) this.advance();
  }
  advance() {
    if (this.step >= this.plan.length) return;
    const [id, type, extra] = this.plan[this.step];
    const d = { type: 'event_msg', timestamp: new Date(this.epoch + this.step * 2200).toISOString(), payload: { type, ...extra } };
    this.records.set(this.step, d);
    this.process(this.agent(id), d, { file: '', offset: this.step, length: 0, at: Date.parse(d.timestamp) });
    this.step++;
    this.emit('change');
  }
  start() { this.timer = setInterval(() => this.advance(), 2200); return this; }
  tick() {}
  roots() { return [{ id: this.rootId, title: '结算服务协作检查', cwd: '演示项目 / checkout-service', status: this.agent(this.rootId).status, at: this.epoch }]; }
  snapshot() { const data = super.snapshot(this.rootId); data.mode = 'demo'; return data; }
  fullText(sessionId, eventId) {
    const e = this.events.get(eventId);
    if (!e || e.sessionId !== sessionId) return null;
    const p = this.records.get(e._ref.offset)?.payload || {};
    return { id: e.id, sessionId, type: e.type, text: p.message || p.last_agent_message || p.prompt || e.preview };
  }
}
module.exports = { DemoWatcher };
