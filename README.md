# Browser Debug Bridge

Browser debugging session → project-aware diagnosis → proposed code fix.

## What this project is

Browser Debug Bridge is a **local-first** developer tool. It is designed to take a Chrome debugging session, diagnose the issue in the context of the open VS Code project, and propose a code fix for the developer to approve before anything is applied.

The intended flow is:

Chrome → browser debugging session → local bridge → VS Code → project-aware diagnosis → proposed code fix → developer approval → apply

No cloud backend is part of V1. The product stays on the developer's machine.

## Current development status

This repository is in **early development (Phase 5B)**.

Phase 1 scaffolded the monorepo. Phase 2 added the shared schema and redaction packages. Phase 3 added a local loopback HTTP bridge. Phase 4 added a session-scoped element picker and bounded DOM/CSS capture. Phase 5A added a cropped JPEG screenshot of the selected element's visible region, stored out of band from DebugSession JSON. Phase 5B adds session-scoped, bounded browser console capture into `DebugSessionV1.console[]`.

The following are **not implemented yet**:

- Network capture
- WebSocket events
- Workspace analysis / project intelligence
- AI diagnosis
- VS Code Debug Session TreeView
- Code patching / diffs / file modification

## Architecture overview

The repository is a pnpm + TypeScript monorepo:

| Area | Role |
| --- | --- |
| Chrome extension | Manifest V3 extension: pair, pick an element, capture a cropped JPEG and session-scoped console, submit a sanitized DebugSession |
| VS Code extension | Owns the local loopback HTTP bridge, in-memory session store, and in-memory screenshot store |
| `@browser-debug-bridge/schema` | DebugSession V1 and protocol message Zod schemas |
| `@browser-debug-bridge/redaction` | URL, DOM, text, and workspace-path sanitization |
| Local bridge | HTTP on `127.0.0.1:17321` inside the VS Code extension process |
| AI providers | Future, behind an abstraction; not implemented |

See [docs/architecture.md](docs/architecture.md) for the decided architecture.

## Repository structure

```
browser-debug-bridge/
├── apps/
│   ├── chrome-extension/
│   └── vscode-extension/
├── packages/
│   ├── schema/
│   └── redaction/
├── docs/
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## Development setup

Requirements:

- Node.js 20 or later
- pnpm 9 or later

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
```

Full commands are in [docs/development.md](docs/development.md).

## Current Phase 5B scope

- Session-scoped element picker on the current tab (`activeTab` + `scripting`)
- Bounded selected-element, DOM, and computed-CSS capture
- Cropped JPEG screenshot of the selected visible region (max 1600×1200, ~1 MB)
- Session-scoped console capture (most recent 50 entries) into `DebugSessionV1.console[]`
- Screenshot bytes uploaded to `POST /sessions/:sessionId/screenshot` (not embedded in DebugSession JSON)
- Shared redaction + schema validation before `session.submit`
- Existing local HTTP bridge with in-memory session and screenshot stores

Network, WebSocket events, AI, and patching are not part of this phase.

## Future roadmap

Later phases are expected to add, in order:

1. Additional Chrome capture (network)
2. VS Code Debug Session UI
3. Project-aware diagnosis
4. Proposed fixes with developer approval before apply

Do not assume any of those capabilities exist in the current tree.
