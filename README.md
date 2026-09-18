# Browser Debug Bridge

Browser debugging session → project-aware diagnosis → proposed code fix.

## What this project is

Browser Debug Bridge is a **local-first** developer tool. It is designed to take a Chrome debugging session, diagnose the issue in the context of the open VS Code project, and propose a code fix for the developer to approve before anything is applied.

The intended flow is:

Chrome → browser debugging session → local bridge → VS Code → project-aware diagnosis → proposed code fix → developer approval → apply

No cloud backend is part of V1. The product stays on the developer's machine.

## Current development status

This repository is in **early development (Phase 2)**.

Phase 1 scaffolded the monorepo. Phase 2 adds the shared DebugSession/protocol schema and redaction utilities.

The following are **not implemented yet**:

- Chrome debugging capture (console, network, DOM, screenshots)
- Chrome ↔ VS Code communication
- Pairing or a local bridge server
- Workspace analysis
- AI diagnosis
- Code patching

The only VS Code runtime behavior is still the smoke-test command: **Browser Debug Bridge: Hello**.

## Architecture overview

The repository is a pnpm + TypeScript monorepo:

| Area | Role |
| --- | --- |
| Chrome extension | Future capture surface for a debugging session (Manifest V3) |
| VS Code extension | Future diagnosis and proposed-fix UI |
| `@browser-debug-bridge/schema` | DebugSession V1 and protocol message Zod schemas |
| `@browser-debug-bridge/redaction` | URL, DOM, text, and workspace-path sanitization |
| Local bridge | Future Chrome ↔ VS Code transport (not scaffolded as a separate app) |
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

## Current Phase 2 scope

- Versioned `DebugSessionV1` Zod schema and inferred types
- Versioned Chrome ↔ VS Code protocol *message* schemas (no transport)
- Redaction helpers for URLs, DOM-like data, sensitive text, and patch paths
- Unit tests for schema, protocol, and redaction

Phase 1 remains in place: pnpm workspace, strict TypeScript, Chrome/VS Code extension foundations, and the Hello command.

## Future roadmap

Later phases are expected to add, in order:

1. Chrome capture and the local Chrome ↔ VS Code bridge
2. VS Code Debug Session UI
3. Project-aware diagnosis
4. Proposed fixes with developer approval before apply

Do not assume any of those capabilities exist in the current tree.
