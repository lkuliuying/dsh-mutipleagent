'use strict';
const { createOfficeServer } = require('./src/server');
const { HarnessWatcher } = require('./src/harness-watcher');

exports.name = 'dsh-mutipleagent';
exports.inject = ['webServer', 'connection', 'sessionQuery'];

exports.apply = function apply(ctx) {
  ctx.effect(() => {
    const watcher = new HarnessWatcher({ query: ctx.sessionQuery });
    const server = createOfficeServer({
      watcher,
      basePath: '/dsh-mutipleagent',
      defaultDocument: 'demo.html',
      authorize(req) {
        const admission = ctx.connection.admit(req);
        if ('rejection' in admission) return admission.rejection;
        // 此页面展示本机完整团队，只向宿主的 owner 开放。
        return admission.peer.principal.kind === 'owner' ? undefined : 403;
      },
    });
    let unregister;
    try {
      unregister = ctx.webServer.register({
        kind: 'prefix',
        path: '/dsh-mutipleagent',
        handler(req, res) {
          // 保留目录尾斜线，保证相对资源在 Web 和 Desktop 代理中一致。
          const url = new URL(req.url, 'http://localhost');
          if (url.pathname === '/dsh-mutipleagent') {
            res.writeHead(302, { location: '/dsh-mutipleagent/' + url.search });
            res.end();
            return;
          }
          server.emit('request', req, res);
        },
      });
      watcher.start();
    } catch (error) {
      unregister?.();
      server.closeOffice();
      throw error;
    }
    return () => {
      unregister();
      server.closeOffice();
    };
  }, 'dsh-mutipleagent: office route and session observer');
};
