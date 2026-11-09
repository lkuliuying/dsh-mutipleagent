import { locale, t } from './i18n.mjs';

let activeControl = null;
let nextSelectId = 0;

const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
};
const icon = (name, className) => {
  const image = node('img', className);
  image.src = './demo-icons/' + name + '.svg';
  image.alt = '';
  return image;
};
const normalized = value => value.trim().toLowerCase().replace(/\\/g, '/');

export function closeOfficeControls() {
  activeControl?.close();
}

export function enhanceSelect(select, { filterable = true } = {}) {
  if (!select.id) select.id = 'office-select-' + ++nextSelectId;
  const wrapper = node('div', 'office-select');
  const trigger = node('button', 'select-trigger');
  trigger.type = 'button';
  trigger.id = select.id + '-trigger';
  const labels = [...select.labels];
  for (const label of labels) label.htmlFor = trigger.id;
  const value = node('span', 'select-value');
  trigger.append(value, icon('chevron-down', 'select-chevron'));
  wrapper.append(trigger);
  select.after(wrapper);
  select.hidden = true;
  const popover = node('div', 'select-popover');
  popover.id = select.id + '-popover';
  popover.setAttribute('popover', 'manual');
  popover.hidden = true;
  // 面板属于原弹窗的焦点范围，并进入顶层，避开正文滚动区域的裁切。
  (select.closest('dialog') || document.body).append(popover);
  const filter = node('form', 'select-filter'),
    input = node('input', 'select-filter-input');
  input.type = 'text';
  input.autocomplete = 'off';
  input.spellcheck = false;
  const clear = node('button', 'select-filter-clear');
  clear.type = 'button';
  clear.setAttribute('aria-label', t('controls.clearFilter'));
  clear.append(icon('x-lg'));
  filter.append(icon('search'), input, clear);
  const options = node('div', 'select-options');
  options.id = select.id + '-options';
  options.role = 'listbox';
  const empty = node('p', 'select-empty', t('controls.noMatch'));
  empty.role = 'status';
  if (filterable) popover.append(filter, options, empty);
  else popover.append(options, empty);
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-controls', options.id);
  if (filterable) {
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', options.id);
  }
  const controller = new AbortController(),
    signal = controller.signal;
  let items = [],
    filtered = [],
    activeValue = null,
    open = false,
    composing = false,
    lastQuery = '',
    lastSignature = '';

  function position() {
    if (!open) return;
    const rect = trigger.getBoundingClientRect(),
      viewport = window.visualViewport;
    if (!rect.width || !rect.height) {
      close();
      return;
    }
    const leftEdge = (viewport?.offsetLeft || 0) + 12,
      topEdge = (viewport?.offsetTop || 0) + 12;
    const rightEdge = leftEdge + (viewport?.width || innerWidth) - 24;
    const bottomEdge = topEdge + (viewport?.height || innerHeight) - 24;
    const minWidth = Number(select.dataset.popoverMinWidth) || 360;
    const width = Math.min(Math.max(rect.width, minWidth), rightEdge - leftEdge);
    const below = bottomEdge - rect.bottom - 8,
      above = rect.top - topEdge - 8;
    const upwards = below < 260 && above > below;
    popover.style.width = width + 'px';
    popover.style.maxHeight = Math.max(0, Math.min(380, upwards ? above : below)) + 'px';
    popover.style.left = Math.max(leftEdge, Math.min(rect.left, rightEdge - width)) + 'px';
    popover.style.top = (upwards ? rect.top - 8 - popover.getBoundingClientRect().height : rect.bottom + 8) + 'px';
  }
  function highlight(item, scroll = false) {
    activeValue = item?.value ?? null;
    let active;
    for (const option of options.children) {
      const match = activeValue !== null && option.dataset.value === activeValue;
      option.dataset.active = String(match);
      if (match) active = option;
    }
    if (active) input.setAttribute('aria-activedescendant', active.id);
    else input.removeAttribute('aria-activedescendant');
    if (scroll) active?.scrollIntoView({ block: 'nearest' });
  }
  function render() {
    const query = normalized(input.value);
    const queryChanged = query !== lastQuery,
      scrollTop = queryChanged ? 0 : options.scrollTop;
    lastQuery = query;
    filtered = items.filter(item => normalized(item.search).includes(query));
    // 快照每秒刷新会调用 refresh() → render()；选项没变时不重建节点，否则点击途中的
    // 选项会被替换掉（浏览器里表现为"点了没反应"，Playwright 里表现为点击超时）。
    const signature = JSON.stringify([
      query,
      locale(),
      select.value,
      filtered.map(item => [item.index, item.value, item.label, item.description, item.disabled]),
    ]);
    if (signature !== lastSignature) {
      lastSignature = signature;
      options.replaceChildren(
        ...filtered.map(item => {
          const option = node('div', 'select-option');
          option.role = 'option';
          option.id = select.id + '-option-' + item.index;
          option.dataset.value = item.value;
          option.setAttribute('aria-selected', String(item.value === select.value));
          option.setAttribute('aria-disabled', String(item.disabled));
          const copy = node('span', 'select-option-copy');
          copy.append(node('strong', '', item.label));
          if (item.description) copy.append(node('small', '', item.description));
          const check = icon('check-lg', 'select-check');
          check.hidden = item.value !== select.value;
          option.append(copy, check);
          option.addEventListener('pointermove', () => {
            if (!item.disabled) highlight(item);
          });
          option.addEventListener('pointerdown', event => event.preventDefault());
          option.addEventListener('click', () => choose(item));
          return option;
        }),
      );
    }
    empty.hidden = filtered.length > 0;
    clear.setAttribute('aria-hidden', String(!input.value));
    clear.tabIndex = input.value ? 0 : -1;
    highlight(
      filtered.find(item => item.value === activeValue && !item.disabled) ||
        filtered.find(item => item.value === select.value && !item.disabled) ||
        filtered.find(item => !item.disabled),
    );
    options.scrollTop = scrollTop;
    if (queryChanged)
      highlight(
        filtered.find(item => item.value === activeValue),
        true,
      );
    position();
  }
  function close(restoreFocus = false) {
    if (!open) return;
    open = false;
    if (popover.showPopover && popover.matches(':popover-open')) popover.hidePopover();
    popover.hidden = true;
    input.value = '';
    composing = false;
    trigger.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    if (activeControl === api) activeControl = null;
    if (restoreFocus && trigger.isConnected) trigger.focus();
  }
  function show() {
    if (select.disabled || open) return;
    closeOfficeControls();
    activeControl = api;
    open = true;
    activeValue = select.value;
    popover.hidden = false;
    if (popover.showPopover) popover.showPopover();
    trigger.setAttribute('aria-expanded', 'true');
    if (filterable) input.setAttribute('aria-expanded', 'true');
    render();
    if (filterable) input.focus();
    else trigger.focus();
    highlight(
      filtered.find(item => item.value === activeValue),
      true,
    );
  }
  function choose(item) {
    if (!item || item.disabled || composing) return;
    const changed = select.value !== item.value;
    select.value = item.value;
    close(true);
    refresh();
    if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function refresh() {
    const label = select.getAttribute('aria-label') || t('controls.selectOption');
    if (filterable) {
      input.setAttribute('aria-label', t('controls.filterPrefix', { label: label.replace(/^(选择|Select)\s*/, '') }));
      input.placeholder = t('controls.filterPlaceholder');
    }
    options.setAttribute('aria-label', t('controls.optionsAria', { label }));
    items = [...select.options].map((option, index) => ({
      value: option.value,
      label: option.dataset.label || option.textContent,
      description: option.dataset.description || '',
      search: option.dataset.search || option.textContent,
      disabled: option.disabled,
      index,
    }));
    value.textContent = select.selectedOptions[0]?.dataset.label || select.selectedOptions[0]?.textContent || t('controls.choose');
    trigger.setAttribute(
      'aria-label',
      [label, value.textContent, select.selectedOptions[0]?.dataset.description].filter(Boolean).join(t('common.listSeparator')),
    );
    trigger.title = select.title || select.selectedOptions[0]?.textContent || '';
    trigger.disabled = select.disabled;
    if (select.disabled) close();
    if (open) render();
  }
  const api = {
    refresh,
    close,
    destroy() {
      close();
      controller.abort();
      popover.remove();
      wrapper.remove();
      select.hidden = false;
      for (const label of labels) label.htmlFor = select.id;
    },
  };
  trigger.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-expanded', 'false');
  trigger.addEventListener('click', () => (open ? close(true) : show()), { signal });
  trigger.addEventListener(
    'keydown',
    event => {
      if (!open) {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          show();
        }
        return;
      }
      if (filterable) return;
      const enabled = filtered.filter(item => !item.disabled);
      if (!enabled.length) return;
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const index = enabled.findIndex(item => item.value === activeValue);
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? enabled.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
        highlight(enabled[next], true);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        choose(enabled.find(item => item.value === activeValue));
      } else if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    },
    { signal },
  );
  input.addEventListener(
    'compositionstart',
    () => {
      composing = true;
    },
    { signal },
  );
  input.addEventListener(
    'compositionend',
    () => {
      composing = false;
      render();
    },
    { signal },
  );
  input.addEventListener('input', render, { signal });
  filter.addEventListener(
    'submit',
    event => {
      event.preventDefault();
      if (!composing) choose(filtered.find(item => item.value === activeValue));
    },
    { signal },
  );
  clear.addEventListener(
    'click',
    () => {
      input.value = '';
      render();
      input.focus();
    },
    { signal },
  );
  popover.addEventListener(
    'keydown',
    event => {
      if (event.isComposing || composing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      } else if (event.key === 'Tab') {
        // 回到触发器后让浏览器继续原有 Tab 顺序，不把焦点留在隐藏面板内。
        close(true);
      } else if (event.target === input && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const enabled = filtered.filter(item => !item.disabled),
          index = enabled.findIndex(item => item.value === activeValue);
        if (!enabled.length) return;
        const next =
          event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? enabled.length - 1
              : (index + (event.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
        highlight(enabled[next], true);
      } else if (event.target === input && event.key === 'Enter') {
        event.preventDefault();
        choose(filtered.find(item => item.value === activeValue));
      }
    },
    { signal },
  );
  document.addEventListener(
    'pointerdown',
    event => {
      if (open && !wrapper.contains(event.target) && !popover.contains(event.target)) close();
    },
    { signal },
  );
  document.addEventListener(
    'focusin',
    event => {
      if (open && !wrapper.contains(event.target) && !popover.contains(event.target)) close();
    },
    { signal },
  );
  select.addEventListener('change', refresh, { signal });
  const dialog = select.closest('dialog');
  dialog?.addEventListener(
    'close',
    () => {
      if (!dialog.open) close();
    },
    { signal },
  );
  window.addEventListener('resize', position, { signal });
  window.addEventListener('scroll', position, { capture: true, signal });
  window.visualViewport?.addEventListener('resize', position, { signal });
  refresh();
  return api;
}

export function bindSearchNavigation({ input, form, results, list, status, clear, onClear, onOpen }) {
  const controller = new AbortController(),
    signal = controller.signal;
  let activeId = null,
    composing = false;
  const buttons = () => [...list.querySelectorAll('.search-result')];
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('aria-expanded', 'false');
  list.role = 'listbox';
  list.setAttribute('aria-label', t('controls.matchesAria'));
  function highlight(button, scroll = false) {
    activeId = button?.dataset.value ?? null;
    for (const item of buttons()) {
      const active = item === button;
      item.dataset.active = String(active);
      item.setAttribute('aria-selected', String(active));
    }
    if (button) input.setAttribute('aria-activedescendant', button.id);
    else input.removeAttribute('aria-activedescendant');
    if (scroll) button?.scrollIntoView({ block: 'nearest' });
  }
  function close() {
    results.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    if (activeControl === api) activeControl = null;
  }
  function refresh() {
    const hasQuery = Boolean(input.value.trim()),
      items = buttons();
    clear.setAttribute('aria-hidden', String(!input.value));
    clear.tabIndex = input.value ? 0 : -1;
    for (const [index, button] of items.entries()) {
      button.id = list.id + '-option-' + index;
      button.role = 'option';
      button.tabIndex = -1;
    }
    status.textContent = hasQuery ? (items.length ? t('controls.found', { count: items.length }) : t('controls.noMatches')) : '';
    if (!hasQuery) {
      activeId = null;
      close();
      return;
    }
    if (activeControl !== api) {
      closeOfficeControls();
      activeControl = api;
    }
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    highlight(items.find(button => button.dataset.value === activeId) || items[0]);
  }
  const api = {
    refresh,
    close,
    destroy() {
      close();
      controller.abort();
    },
  };
  input.addEventListener(
    'compositionstart',
    () => {
      composing = true;
    },
    { signal },
  );
  input.addEventListener(
    'compositionend',
    () => {
      composing = false;
    },
    { signal },
  );
  input.addEventListener(
    'keydown',
    event => {
      if (event.isComposing || composing || event.keyCode === 229) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (!results.hidden) close();
        else onClear();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        if (!results.hidden)
          buttons()
            .find(button => button.dataset.value === activeId)
            ?.click();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || (!results.hidden && (event.key === 'Home' || event.key === 'End'))) {
        event.preventDefault();
        if (results.hidden) {
          onOpen();
          return;
        }
        const items = buttons(),
          index = items.findIndex(button => button.dataset.value === activeId);
        if (!items.length) return;
        const next =
          event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        highlight(items[next], true);
      }
    },
    { signal },
  );
  form.addEventListener(
    'submit',
    event => {
      event.preventDefault();
      if (composing || results.hidden) return;
      buttons()
        .find(button => button.dataset.value === activeId)
        ?.click();
    },
    { signal },
  );
  list.addEventListener(
    'pointermove',
    event => {
      const button = event.target.closest('.search-result');
      if (button) highlight(button);
    },
    { signal },
  );
  list.addEventListener('pointerdown', event => event.preventDefault(), { signal });
  document.addEventListener(
    'pointerdown',
    event => {
      if (!form.parentElement.contains(event.target)) close();
    },
    { signal },
  );
  document.addEventListener(
    'focusin',
    event => {
      if (!form.parentElement.contains(event.target)) close();
    },
    { signal },
  );
  return api;
}
