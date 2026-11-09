# Third-party notices

## whatsmyagentdoing

- Project: https://github.com/Charonyuu/whatsmyagentdoing
- Revision: c69bf2bc98cf96a63d146070e9bbc83b507bf0bf (0.8.1)
- Copyright (c) 2026 cheoyu
- License: MIT, reproduced in LICENSE.
- Reused source: public/office.js → public/vendor/office.js; web/office3d.js → vendor/office3d.js. Resource URLs were adapted to support the Harness plugin mount path. Team layout and behavior extensions are in web/team-office.js.
- The incremental log reader design informed the Codex-only reader in src/codex.js.

## Kenney assets

Mini Characters and Furniture Kit by Kenney, https://kenney.nl, CC0.
Original license files are retained in assets/kenney.

## Agent icons and logo

Assets are preserved from the pinned upstream revision. Source and attribution are in assets/agents/README.md and assets/agents/MAGPIE-LICENSE.

## JavaScript dependencies

The browser bundle includes Three.js (MIT) and its bundled loaders, controls, SkeletonUtils and Meshopt decoder. The Meshopt decoder is available under the MIT license as distributed with Three.js. esbuild is MIT-licensed and used only at build time. Playwright is Apache-2.0-licensed and used only for verification.

Dependency license texts are copied into vendor/licenses with the distributable.

## Bootstrap Icons

The independent reference-style demo uses locally bundled SVG icons from https://github.com/twbs/icons. Bootstrap Icons is MIT-licensed; its original license is preserved in vendor/licenses/BOOTSTRAP-ICONS-LICENSE.txt. Icon paths are preserved; their displayed colors are styled by the demo stylesheet.
