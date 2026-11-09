// 通知红点：以最后一条事件为已读锚点，刷新页面后仍保持已读状态。
import { onLangChange, t } from './i18n.mjs';

const eventKey = event => String(event?.id ?? `${event?.at ?? ''}:${event?.type ?? ''}`);
const latestKey = events => (events.length ? eventKey(events[events.length - 1]) : '');
const storageKey = mode => 'office.notify.seen.v1.' + mode;

export function createNotificationState({ mode, button, dot, panel, getEvents }) {
  let seen = '';
  try {
    seen = localStorage.getItem(storageKey(mode)) || '';
  } catch {
    /* 隐私模式或存储被禁用时仅在本页内记忆 */
  }
  let unread = false;
  const setDot = next => {
    unread = Boolean(next);
    dot.hidden = !unread;
    button.classList.toggle('has-unread', unread);
    button.setAttribute('aria-label', unread ? t('notify.ariaUnread') : t('notify.aria'));
  };
  const markRead = () => {
    const key = latestKey(getEvents());
    if (!key || key === seen) {
      setDot(false);
      return;
    }
    seen = key;
    try {
      localStorage.setItem(storageKey(mode), key);
    } catch {
      /* 忽略存储失败 */
    }
    setDot(false);
  };
  const update = () => {
    if (!panel.hidden) {
      markRead();
      return;
    }
    setDot(Boolean(latestKey(getEvents())) && latestKey(getEvents()) !== seen);
  };
  const open = () => {
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    markRead();
  };
  const close = () => {
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  const toggle = () => (panel.hidden ? open() : close());
  setDot(Boolean(latestKey(getEvents())) && latestKey(getEvents()) !== seen);
  onLangChange(() => setDot(unread));
  return { update, markRead, open, close, toggle };
}
