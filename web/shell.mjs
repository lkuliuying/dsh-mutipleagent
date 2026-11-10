// 场景聚焦模式：隐藏除 3D 办公室以外的所有浮层（顶栏、统计卡、详情面板、
// 工具条与任务协作流程），让画面独占窗口。状态记在 localStorage，刷新后保留。
const STORAGE_KEY = 'office.shell';

export function initShell() {
  if (typeof document === 'undefined') return () => {};
  const body = document.body;
  const toggle = document.getElementById('toggle-shell');
  const restore = document.getElementById('shell-restore');
  if (!toggle && !restore) return () => {};

  let saved = '';
  try {
    saved = localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    saved = '';
  }

  const isScene = () => body.dataset.shell === 'scene';
  const apply = scene => {
    if (scene) body.dataset.shell = 'scene';
    else delete body.dataset.shell;
    if (restore) restore.hidden = !scene;
    toggle?.setAttribute('aria-pressed', scene ? 'true' : 'false');
    try {
      localStorage.setItem(STORAGE_KEY, scene ? 'scene' : 'all');
    } catch {
      // 隐私模式下写入失败时保持纯内存状态即可。
    }
  };

  toggle?.addEventListener('click', () => apply(!isScene()));
  restore?.addEventListener('click', () => {
    apply(false);
    toggle?.focus();
  });
  window.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = event.target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (event.key === 'h' || event.key === 'H') {
      event.preventDefault();
      apply(!isScene());
    } else if (event.key === 'Escape' && isScene()) {
      apply(false);
    }
  });

  apply(saved === 'scene');
  return () => apply(false);
}
