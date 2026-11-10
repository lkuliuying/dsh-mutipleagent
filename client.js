window.__ModuleLoader__.load({
  id: 'dsh-mutipleagent',
  factory: require => {
    const { createElement: h, useEffect, useState } = require('react');
    // 面板页面由本插件自己的静态服务提供（不是用户内容），需要同源才能读写本地偏好与同源 API。
    // 其余权限（弹窗、顶层跳转、表单、下载、插件、指针锁定、模态框）保持沙箱默认拒绝。
    const FRAME_SANDBOX = 'allow-scripts allow-same-origin';
    const OFFICE_BASE = '/dsh-mutipleagent/';
    const VIEW_ID = 'dsh-mutipleagent';
    const VIEW_LABEL = '多 Agent 办公室';
    // 会话内视图直接带上当前会话 id：办公室据此锁定 rootId，不再要求用户先选目录和会话。
    // rev 取健康检查里的插件版本：升级后地址随之变化，停留在标签页里的旧 iframe 会自动重载，
    // 不必等用户手动刷新整个 Harness 页面（CSS/脚本更新也能立刻生效）。
    function officeUrl(sessionId, rev) {
      const params = new URLSearchParams({ mode: 'live', source: 'harness' });
      if (sessionId) {
        params.set('rootId', sessionId);
        params.set('embed', '1');
      }
      if (rev) params.set('rev', rev);
      return OFFICE_BASE + '?' + params.toString();
    }
    function OfficeIcon({ size = 18 }) {
      return h(
        'svg',
        { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, 'aria-hidden': true },
        h('path', { d: 'M3 10V5h6v5H3Zm12 0V5h6v5h-6ZM9 21v-5h6v5H9ZM6 10v3h12v-3m-6 3v3' }),
      );
    }
    // 面板与会话视图共用同一套连接状态机：先探活，再挂 iframe。
    function OfficeFrame({ sessionId, className }) {
      const [version, setVersion] = useState(0);
      const [error, setError] = useState('');
      const [ready, setReady] = useState(false);
      const [rev, setRev] = useState('');
      const url = officeUrl(sessionId, rev);
      useEffect(() => {
        let active = true;
        const controller = new AbortController();
        setError('');
        setReady(false);
        fetch(OFFICE_BASE + 'api/health', { signal: controller.signal })
          .then(response => {
            if (!response.ok) throw Error('办公室暂不可用（HTTP ' + response.status + '），请确认插件已启用后重试。');
            return response.json();
          })
          .then(data => {
            if (!active) return;
            setRev(String(data?.version ?? ''));
            setReady(true);
          })
          .catch(error => {
            if (active && error.name !== 'AbortError') setError(error.message);
          });
        return () => {
          active = false;
          controller.abort();
        };
      }, [version, sessionId]);
      if (error)
        return h(
          'section',
          { className: 'dsh-office-status', role: 'alert' },
          h('p', null, error),
          h('button', { type: 'button', onClick: () => setVersion(value => value + 1) }, '重新连接'),
        );
      if (!ready) return h('p', { className: 'dsh-office-status', role: 'status' }, '正在连接多 Agent 办公室…');
      return h('iframe', {
        key: url,
        className,
        src: url,
        title: 'DeepSeek Harness 多 Agent 协作办公室',
        sandbox: FRAME_SANDBOX,
        referrerPolicy: 'no-referrer',
        allow: 'clipboard-write',
      });
    }
    function OfficePage() {
      return h(OfficeFrame, { className: 'dsh-office-frame' });
    }
    // 会话内标签：sessionId 由 conversation.view 的 inject(sessionId) 注入，切换会话即换 iframe。
    // 标签页在屏时给 body 打标记，宿主据此收起底部输入框，把整块高度让给办公室画面；离开标签即恢复。
    let officeViewCount = 0;
    function OfficeView({ sessionId }) {
      useEffect(() => {
        officeViewCount += 1;
        document.body.dataset.officeView = 'active';
        return () => {
          officeViewCount = Math.max(0, officeViewCount - 1);
          if (officeViewCount === 0) delete document.body.dataset.officeView;
        };
      }, []);
      return h('div', { className: 'dsh-office-view' }, h(OfficeFrame, { sessionId, className: 'dsh-office-frame' }));
    }
    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.effect(() => {
          const style = document.createElement('style');
          style.textContent =
            '.dsh-office-frame{display:block;width:100%;height:100%;min-height:0;border:0;background:#edf3fc}.dsh-office-view{display:flex;flex:1 1 auto;flex-direction:column;min-height:0;min-width:0;height:100%;width:100%;background:#edf3fc}.dsh-office-view>.dsh-office-frame{flex:1 1 auto;height:auto}body[data-office-view=active] [data-conversation-region=composer]{display:none!important}.dsh-office-status{padding:24px;color:var(--dsw-alias-label-primary);font:inherit}.dsh-office-status button{font:inherit;color:inherit;background:var(--dsw-alias-button-elevated-fill);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 16px;cursor:pointer}.dsh-office-status button:focus-visible{outline:2px solid var(--dsw-focus-ring-color);outline-offset:2px}';
          document.head.appendChild(style);
          return () => style.remove();
        }, 'dsh-mutipleagent: panel styles');
        ctx.effect(
          () => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'dsh-mutipleagent' }, OfficePage)),
          'dsh-mutipleagent: main panel',
        );
        // 会话页顶部标签行（对话 / 轨迹 / 上下文 / …）：在具体会话里直接可用的入口。
        ctx.effect(
          () =>
            ctx.slots.inject('conversation.view', () =>
              ctx.slots.register(
                {
                  name: 'conversation.view',
                  id: VIEW_ID,
                  order: 30,
                  label: () => VIEW_LABEL,
                  inject: sessionId => ({ sessionId }),
                },
                OfficeView,
              ),
            ),
          'dsh-mutipleagent: conversation view',
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
