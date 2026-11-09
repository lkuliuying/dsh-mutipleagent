import { locale, t } from './i18n.mjs';

export function directoryKey(cwd) {
  if (typeof cwd !== 'string' || !cwd.trim()) return '';
  const value = cwd.trim().replace(/\\/g, '/').replace(/\/+$/, '') || '/';
  return /^[a-z]:\//i.test(value) || /^[a-z]:$/i.test(value) || value.startsWith('//') ? value.toLowerCase() : value;
}

export function directoryGroups(roots = []) {
  const groups = new Map();
  for (const root of roots) {
    const key = directoryKey(root.cwd);
    if (!groups.has(key)) groups.set(key, { key, path: root.cwd?.trim() || t('common.noDirectory'), count: 0 });
    groups.get(key).count++;
  }
  return [...groups.values()];
}

export function directorySessions(roots = [], key) {
  return roots.filter(root => directoryKey(root.cwd) === key);
}

export function sessionLabel(root) {
  const title = typeof root.title === 'string' ? root.title.replace(/\s+/g, ' ').trim() : '';
  const at = Number.isFinite(root.createdAt) ? root.createdAt : root.at;
  const date = Number.isFinite(at) ? new Date(at) : null;
  const time =
    date && !Number.isNaN(date.getTime())
      ? date.toLocaleString(locale(), {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
      : t('common.timeNotRecorded');
  return [title ? title.slice(0, 46) + (title.length > 46 ? '…' : '') : t('common.unnamedSession'), time, String(root.id).slice(-8)].join(' · ');
}
