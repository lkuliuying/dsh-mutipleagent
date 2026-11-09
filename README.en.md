# dsh-mutipleagent

[![ci](https://github.com/lkuliuying/dsh-mutipleagent/actions/workflows/ci.yml/badge.svg)](https://github.com/lkuliuying/dsh-mutipleagent/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

English · [简体中文](README.md)

A 3D office for DeepSeek Harness multi-agent work. Open it from the Harness sidebar and watch the real root session, its sub-agents, tool activity and final reports as characters at desks.

**Read-only.** It never starts, pauses or approves tasks, never calls a model, never writes to a session, and never sends anything off the machine.

![The 3D office](https://raw.githubusercontent.com/lkuliuying/dsh-mutipleagent/main/assets/screenshots/demo-office-en.jpg)

| Task detail | Activity feed |
| --- | --- |
| ![Task detail](https://raw.githubusercontent.com/lkuliuying/dsh-mutipleagent/main/assets/screenshots/demo-task-detail-en.jpg) | ![Activity feed](https://raw.githubusercontent.com/lkuliuying/dsh-mutipleagent/main/assets/screenshots/demo-notifications-en.jpg) |

Generated from demo data with `npm run screenshots`. The interface ships in Chinese and English — switch with the 中 / EN control in the top bar. In live mode, task text, agent names and event previews stay exactly as they appear in your session logs, so they are not translated.

Current version `v0.2.0`, package `dsh-mutipleagent`. Compatible with DeepSeek Harness `^0.2.2-rc.1` and Node.js `^22.19.0 || >=24.0.0`. See [CHANGELOG.md](CHANGELOG.md) for per-version notes and [Releases](https://github.com/lkuliuying/dsh-mutipleagent/releases) for the published notes.

## What's new in v0.2.0

- Chinese and English UI, following the system language by default, switchable in the header.
- Faster first paint and lighter reads: furniture plus three characters load first, `app.js` drops from 731.6 KB to 10.5 KB and `demo.js` from 814 KB to 73.4 KB (one shared `three.js` chunk, gzip on), and unchanged sessions are no longer re-folded every second.
- Static files serve `ETag` / `304` and gzip; polling stops when no page is connected and refreshes on open.
- `/api/health` reports version, uptime, client count, read cost and polling state.
- Tooling: ESLint, Prettier, `.gitattributes`, CI (Node 22.19 / 24, browser acceptance, build freshness) and `npm run release`.

## Install

Quit Harness Desktop completely, then:

    dsh plugin --profile desktop add 'dsh-mutipleagent@https://codeload.github.com/lkuliuying/dsh-mutipleagent/legacy.tar.gz/refs/tags/v0.2.0' --ignore-scripts

If `dsh` is not on `PATH`, use the bundled CLI:

    & 'C:\ProgramSoftware\Deepseek\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add 'dsh-mutipleagent@https://codeload.github.com/lkuliuying/dsh-mutipleagent/legacy.tar.gz/refs/tags/v0.2.0' --ignore-scripts

Restart Harness and pick **Multi-Agent Office** in the sidebar. No API key, no separate server, nothing else to configure.

To build from source instead:

    npm ci
    npm run build
    npm pack --ignore-scripts
    dsh plugin --profile desktop add "F:\path\to\dsh-mutipleagent-0.1.3.tgz"

## What you get

- **Desks, not dashboards.** Agents sit down, face their monitor and type; screens show current status and the latest event. Task hand-offs and reports travel as light trails from screen to screen.
- **Screen detail.** Click any monitor for the real agent, status, task, model/tool and recent events. Esc, overlay and a close button all work; narrow screens switch to a readable text layout.
- **Session picker.** Choose a workspace directory, then a session inside it. Search by path, title, time or short ID; identical titles stay distinguishable. Your last choice is remembered.
- **Notification centre.** Unread dot clears against a read anchor, with "mark all read", category icons and a compact three-line summary.
- **Graceful degradation.** Without WebGL the team tree, activity log and reports still work, and "reduce motion" is one checkbox away.
- **Bilingual UI.** Chinese and English, switchable in the header and remembered locally.

## Boundaries

- Data comes only from Harness's public `sessionQuery` interface. No session files, no credentials, no private reasoning or system messages.
- The server binds `127.0.0.1`, serves `GET` only, rejects cross-origin requests and non-loopback hosts, and reuses Harness's owner check when mounted.
- No telemetry, no external fonts, no CDN, no third-party scripts.
- Numbers follow recorded events. Some Desktop builds store `spawn_agent` payloads encrypted, so a hand-off may show "not recorded" rather than an invented description.

Read [SECURITY.md](SECURITY.md) for the full threat model and how to report a vulnerability privately.

## FAQ

**Only the root agent shows up.** The plugin only renders sub-agents that actually existed. Ask for parallel work in the session (for example "spawn two read-only sub-agents, one for the API contract and one for test gaps") and let it run.

**Numbers differ from what I saw in the session.** Logs are written per message block, not per token; known sessions are checked roughly once a second and new ones every five seconds. Missing data is shown as "not recorded" instead of a guess.

**Does it upload my sessions?** No. See the boundaries above and [SECURITY.md](SECURITY.md).

**Port 4317 is taken.** `node src/server.js --port 4320 --open`, or use the plugin panel which has no fixed port.

## Develop

    npm ci
    npm run build
    npm test
    npm run lint && npm run format:check && npm run check:compat

`npm run test:ui` drives the real WebGL page with Playwright. `npm run screenshots` regenerates the images above. `npm run release -- 0.2.0` bumps versions, runs every gate, commits and tags; GitHub Actions then publishes the release.

Source layout: `src/` is the read-only server and session parsing, `web/` is the UI and 3D scene, `vendor/` is pinned upstream rendering code, `assets/` holds models and images. See [CONTRIBUTING.md](CONTRIBUTING.md) before sending a PR.

## Licence

Based on [Charonyuu/whatsmyagentdoing](https://github.com/Charonyuu/whatsmyagentdoing) (commit `c69bf2bc98cf96a63d146070e9bbc83b507bf0bf`, v0.8.1); upstream MIT licence kept in [LICENSE](LICENSE). Character and furniture models are Kenney Mini Characters and Furniture Kit (CC0), original licences under `assets/kenney`. Full attribution in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
