window.__ModuleLoader__.load({
  id: 'dsh-mutipleagent',
  factory: require => {
    const { createElement: h, useEffect, useState } = require('react');
    // 面板页面由本插件自己的静态服务提供（不是用户内容），需要同源才能读写本地偏好与同源 API。
    // 其余权限（弹窗、顶层跳转、表单、下载、插件、指针锁定、模态框）保持沙箱默认拒绝。
    const FRAME_SANDBOX = 'allow-scripts allow-same-origin';
    function OfficeIcon({ size = 18 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true },
        h('path', { d: 'M3 10V5h6v5H3Zm12 0V5h6v5h-6ZM9 21v-5h6v5H9ZM6 10v3h12v-3m-6 3v3' }),
      );
    }
    function OfficePage() {
      const [version, setVersion] = useState(0);
      const [error, setError] = useState('');
      const [ready, setReady] = useState(false);
      const url = '/dsh-mutipleagent/?mode=live&source=harness';
      useEffect(() => {
        let active = true;
        const controller = new AbortController();
        setError('');
        setReady(false);
        fetch('/dsh-mutipleagent/api/health', { signal: controller.signal })
          .then(response => {
            if (!response.ok) throw Error('办公室暂不可用（HTTP ' + response.status + '），请确认插件已启用后重试。');
            return response.json();
          })
          .then(() => {
            if (active) setReady(true);
          })
          .catch(error => {
            if (active && error.name !== 'AbortError') setError(error.message);
          });
        return () => {
          active = false;
          controller.abort();
        };
      }, [version]);
      if (error)
        return h(
          'section',
          { className: 'dsh-office-status', role: 'alert' },
          h('p', null, error),
          h('button', { type: 'button', onClick: () => setVersion(value => value + 1) }, '重新连接'),
        );
      if (!ready) return h('p', { className: 'dsh-office-status', role: 'status' }, '正在连接多 Agent 办公室…');
      return h('iframe', {
        className: 'dsh-office-frame',
        src: url,
        title: 'DeepSeek Harness 多 Agent 协作办公室',
        sandbox: FRAME_SANDBOX,
        referrerPolicy: 'no-referrer',
        allow: 'clipboard-write',
      });
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style');
          style.textContent =
            '.dsh-office-frame{display:block;width:100%;height:100%;min-height:0;border:0;background:#edf3fc}.dsh-office-status{padding:24px;color:var(--dsw-alias-label-primary);font:inherit}.dsh-office-status button{font:inherit;color:inherit;background:var(--dsw-alias-button-elevated-fill);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 16px;cursor:pointer}.dsh-office-status button:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:2px}';
          document.head.appendChild(style);
          return () => style.remove();
        }, 'dsh-mutipleagent: panel styles');
        ctx.effect(
          () => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'dsh-mutipleagent' }, OfficePage)),
          'dsh-mutipleagent: main panel',
        );
        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.panellist', () =>
              ctx.slots.register(
                {
                  name: 'sidebar.panellist',
                  id: 'dsh-mutipleagent',
                  order: 30,
                  label: '多 Agent 办公室',
                },
                OfficeIcon,
              ),
            ),
          'dsh-mutipleagent: sidebar entry',
        );
      },
    };
  },
});
