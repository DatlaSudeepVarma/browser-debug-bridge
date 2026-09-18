# Browser Debug Bridge

Browser debugging session → project-aware diagnosis → proposed code fix.

## What this project is

Browser Debug Bridge is a **local-first** developer tool. It is designed to take a Chrome debugging session, diagnose the issue in the context of the open VS Code project, and propose a code fix for the developer to approve before anything is applied.

The intended flow is:

Chrome → browser debugging session → local bridge → VS Code → project-aware diagnosis → proposed code fix → developer approval → apply

No cloud backend is part of V1. The product stays on the developer's machine.

## Current development status

This repository is in **early development (Phase 3)**.

Phase 1 scaffolded the monorepo. Phase 2 added the shared schema and redaction packages. Phase 3 adds a local loopback HTTP bridge from the Chrome extension to the VS Code extension.

The following are **not implemented yet**:

- Chrome debugging capture (console, network, DOM, screenshots, element picker)
- WebSocket events
- Workspace analysis
- AI diagnosis
- Code patching

VS Code now starts a loopback HTTP server on activation. Browser capture is still not implemented.

## Architecture overview

The repository is a pnpm + TypeScript monorepo:

| Area | Role |
| --- | --- |
| Chrome extension | Manifest V3 extension that can pair with VS Code and submit a fake session |
| VS Code extension | Owns the local loopback HTTP bridge and in-memory session store |
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

## Current Phase 3 scope

- Local HTTP bridge bound to `127.0.0.1:17321` inside the VS Code extension
- Pairing token in VS Code SecretStorage and Chrome `chrome.storage.local`
- `POST /sessions` validates protocol + DebugSession V1 and stores a bounded in-memory list
- Development commands and a minimal Chrome popup for pairing and fake session submit
- Unit tests for the bridge server

Browser capture, WebSocket events, AI, and patching are not part of this phase.

## Future roadmap

Later phases are expected to add, in order:

1. Chrome capture (element picker, console, network, screenshots)
2. VS Code Debug Session UI
3. Project-aware diagnosis
4. Proposed fixes with developer approval before apply

Do not assume any of those capabilities exist in the current tree.
