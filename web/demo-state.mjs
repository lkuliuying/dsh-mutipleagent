export const DURATION = 48;
export const SCENARIOS = {
  search: {
    title: '实现任务搜索与筛选', project: 'Codex Workspace', code: 'TASK-07843',
    titles: ['分析、协调与任务汇总', '查询与筛选接口', '搜索与筛选界面', '边界与回归验证'],
    tasks: ['拆分需求，协调并行执行，审阅三份结果并形成最终总结。', '实现关键词查询、状态筛选和分页接口，补齐参数校验。', '实现搜索栏、筛选控件和结果列表，处理加载与空状态。', '验证搜索、组合筛选和分页边界，检查无结果与错误状态。'],
    files: ['计划与结果汇总', 'src/api/tasks.ts', 'src/views/Tasks.vue', 'tests/tasks.spec.ts'],
    reports: [
      '任务搜索与筛选已完成（演示）。\n\n接口 Agent 完成查询契约；前端 Agent 完成搜索与筛选交互；测试 Agent 验证正常和边界场景。\n\n已汇总三份报告，建议在接入真实数据后继续验证大列表响应速度。\n\n本报告为模拟内容，没有修改你的项目。',
      '接口任务完成（演示）。\n\n完成关键词、状态与分页参数设计。空关键词返回默认列表；无匹配项返回空数组；无效分页参数返回明确错误。\n\n接口约定：GET /tasks?q=关键词&status=状态&page=页码。\n\n本报告为模拟内容。',
      '前端任务完成（演示）。\n\n已实现关键词搜索、状态筛选和分页切换，补齐加载、空结果和读取失败提示。\n\n筛选条件更新后回到第一页；清除搜索后恢复完整列表。\n\n本报告为模拟内容。',
      '测试任务完成（演示）。\n\n已检查：关键词匹配、组合筛选、大小写、空结果、分页边界和网络错误。\n\n验收建议：使用真实接口再次验证快速输入时的请求顺序。\n\n本报告为模拟内容。',
    ],
  },
  review: {
    title: '检查接口与回归测试', project: 'Quality Workspace', code: 'TASK-07844',
    titles: ['协作审阅与结论汇总', '接口契约检查', '搜索交互检查', '回归测试审阅'],
    roles: ['协调与汇总', '接口审阅', '交互检查', '回归检查'],
    tasks: ['分配接口审阅、交互检查和回归测试，汇总发现与建议。', '只读检查接口输入输出契约和失败响应。', '只读检查搜索与筛选交互，记录用户可见问题。', '检查测试覆盖与关键边界，返回回归检查结论。'],
    files: ['审阅结论汇总', 'api/contracts.ts', 'ui/search-panel.ts', 'tests/regression.ts'],
    reports: [
      '协作审阅完成（演示）。\n\n已收齐接口、交互和回归检查报告。建议优先统一无结果响应，并补充快速切换筛选项的测试。\n\n这是一组演示结论，没有读取真实代码。',
      '接口审阅完成（演示）。\n\n发现空结果和参数错误需要使用不同响应语义；建议统一错误字段并补充示例。',
      '交互检查完成（演示）。\n\n搜索、筛选与清除路径完整；建议保留当前条件，避免用户返回列表时丢失上下文。',
      '回归检查完成（演示）。\n\n建议增加无结果、超长关键词、快速连续搜索与分页末页的场景。',
    ],
  },
};
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const ids = ['main', 'api', 'frontend', 'test'];
const names = ['主 Agent', '接口 Agent', '前端 Agent', '测试 Agent'];
const roles = ['协调与汇总', '接口开发', '界面实现', '验证与审阅'];
const starts = [0, 3, 5, 7], ends = [48, 23, 31, 37];
const zones = ['C0 · 协调中心', 'A1 · 接口工作区', 'A2 · 前端工作区', 'B1 · 验证工作区'];
const icons = ['diagram-3-fill', 'cpu-fill', 'file-earmark-code-fill', 'shield-check'];

export function demoSnapshot(seconds = 16, scenario = 'search') {
  const t = clamp(Number(seconds) || 0, 0, DURATION);
  const config = SCENARIOS[scenario] || SCENARIOS.search;
  const stage = t < 7 ? 0 : t < 25 ? 1 : t < 37 ? 2 : 3;
  const agents = ids.map((id, i) => {
    const progress = i === 0 ? Math.round(t / DURATION * 100) : Math.round(clamp((t - starts[i]) / (ends[i] - starts[i]), 0, 1) * 100);
    const done = t >= ends[i];
    return { id, key: id, parentId: i ? 'main' : null, rootId: 'main', agent: 'codex', subagent: i > 0,
      name: names[i], title: config.titles[i], role: (config.roles || roles)[i], zone: zones[i], icon: icons[i], task: config.tasks[i],
      file: config.files[i], code: config.code.slice(0, -1) + (Number(config.code.slice(-1)) + i),
      progress, status: done ? 'done' : t < starts[i] ? 'unknown' : i === 0 && t >= 7 && t < 37 ? 'waiting_agents' : 'tool',
      startedAt: starts[i] * 1000, report: done ? config.reports[i] : null,
      reportPreview: done ? '汇报已就绪' : i ? progress < 25 ? '正在分析任务' : progress < 75 ? '正在执行分配任务' : '正在整理结果' : '正在协调团队',
    };
  });
  const events = [
    ...ids.slice(1).map((id, i) => ({ id: 'assign-' + id, sessionId: 'main', targetId: id, type: 'assign', at: starts[i + 1], preview: config.tasks[i + 1] })),
    ...ids.slice(1).map((id, i) => ({ id: 'report-' + id, sessionId: id, targetId: 'main', type: 'report', at: ends[i + 1], preview: config.reports[i + 1] })),
    { id: 'final-main', sessionId: 'main', type: 'report', at: 48, preview: config.reports[0] },
  ].filter((e) => e.at <= t).sort((a, b) => a.at - b.at);
  return { mode: 'demo', rootId: 'main', scenario, config, seconds: t, stage, agents, events,
    assigned: agents.slice(1).filter((s) => t >= starts[ids.indexOf(s.id)]).length,
    received: agents.slice(1).filter((s) => s.status === 'done').length,
    active: agents.filter((s) => s.status !== 'done' && s.status !== 'unknown').length,
    progress: Math.round(t / DURATION * 100), complete: t >= DURATION };
}

export class DemoPlayer extends EventTarget {
  constructor() { super(); this.seconds = 16; this.playing = false; this.scenario = 'search'; }
  get snapshot() { return demoSnapshot(this.seconds, this.scenario); }
  changed() { this.dispatchEvent(new Event('change')); }
  play() { if (this.seconds >= DURATION) this.seconds = 0; this.playing = !this.playing; this.changed(); }
  restart() { this.seconds = 0; this.playing = true; this.changed(); }
  setScenario(id) { if (!SCENARIOS[id]) return; this.scenario = id; this.seconds = 16; this.playing = false; this.changed(); }
  advance(delta) {
    if (!this.playing || !Number.isFinite(delta) || delta <= 0) return;
    this.seconds = clamp(this.seconds + delta, 0, DURATION);
    if (this.seconds === DURATION) this.playing = false;
    this.changed();
  }
}
