// 资源与接口跟随页面所在目录，兼容独立根路径及 Harness 的插件挂载路径。
export function officeUrl(resource = '') {
  const base = new URL('.', globalThis.document?.baseURI || location.href);
  return new URL(resource.replace(/^\/+/, ''), base).href;
}

export function officeSource() {
  return new URLSearchParams(location.search).get('source') === 'harness' ? 'harness' : 'codex';
}

export function officePage(live = false, source = officeSource()) {
  const url = new URL(officeUrl('demo.html'));
  if (live) url.searchParams.set('mode', 'live');
  if (source === 'harness') url.searchParams.set('source', 'harness');
  return url.href;
}

export function applyOfficeBrand(source, live = false) {
  if (source !== 'harness') return;
  document.title = 'DSH Office · ' + (live ? '实时协作' : '协作演示');
  const brand = document.querySelector('.brand');
  brand.href = officePage(live, source);
  brand.querySelector(':scope > span:last-child').replaceChildren('DSH', Object.assign(document.createElement('span'), { className: 'brand-light', textContent: 'Office' }));
  document.querySelector('.profile-avatar img').src = officeUrl('assets/agents/dsh.svg');
  document.getElementById('dialog-mode').textContent = 'DSH OFFICE / ' + (live ? 'LIVE' : 'DEMO');
}
