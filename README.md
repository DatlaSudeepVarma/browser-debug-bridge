# Browser Debug Bridge

Browser debugging session → project-aware diagnosis → proposed code fix.

## What this project is

Browser Debug Bridge is a **local-first** developer tool. It is designed to take a Chrome debugging session, diagnose the issue in the context of the open VS Code project, and propose a code fix for the developer to approve before anything is applied.

The intended flow is:

Chrome → browser debugging session → local bridge → VS Code → project-aware diagnosis → proposed code fix → developer approval → apply

No cloud backend is part of V1. The product stays on the developer's machine.

## Current development status

This repository is in **early development (Phase 8)**.

Phase 1 scaffolded the monorepo. Phase 2 added the shared schema and redaction packages. Phase 3 added a local loopback HTTP bridge. Phase 4 added a session-scoped element picker and bounded DOM/CSS capture. Phase 5A added a cropped JPEG screenshot of the selected element's visible region, stored out of band from DebugSession JSON. Phase 5B added session-scoped console capture. Phase 5C added session-scoped network **failure metadata**. Phase 6 added a deterministic VS Code **project intelligence** foundation. Phase 7 added a **read-only AI diagnosis** behind a provider abstraction, using `vscode.lm` as the first provider. Phase 8 adds a native VS Code **TreeView** so a developer can inspect that diagnosis without changing files.

The following are **not implemented yet**:

- WebSocket events
- Code patching / diffs / file modification
- Screenshot bytes sent to a multimodal model

## Architecture overview

The repository is a pnpm + TypeScript monorepo:

| Area | Role |
| --- | --- |
| Chrome extension | Manifest V3 extension: pair, pick an element, capture a cropped JPEG, session-scoped console, and network failure metadata, submit a sanitized DebugSession |
| VS Code extension | Owns the local loopback HTTP bridge, project intelligence, read-only AI diagnosis, and diagnosis TreeView |
| `@browser-debug-bridge/schema` | DebugSession V1 and protocol message Zod schemas |
| `@browser-debug-bridge/redaction` | URL, DOM, text, and workspace-path sanitization |
| Local bridge | HTTP on `127.0.0.1:17321` inside the VS Code extension process |
| AI providers | Provider-neutral interface; first implementation is `vscode.lm` (no external AI SDKs) |

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

## Current Phase 8 scope

- Session-scoped element picker on the current tab (`activeTab` + `scripting`)
- Bounded selected-element, DOM, and computed-CSS capture
- Cropped JPEG screenshot of the selected visible region (max 1600×1200, ~1 MB)
- Session-scoped console capture (most recent 50 entries) into `DebugSessionV1.console[]`
- Session-scoped network failure metadata (most recent 100 entries) into `DebugSessionV1.network[]` — not a HAR recorder
- Screenshot bytes uploaded to `POST /sessions/:sessionId/screenshot` (not embedded in DebugSession JSON)
- Shared redaction + schema validation before `session.submit`
- Existing local HTTP bridge with in-memory session and screenshot stores
- Deterministic VS Code project intelligence: workspace-jailed discovery, framework/package-manager hints, ranked candidate files, bounded excerpts

- Read-only AI diagnosis from `DebugSessionV1` + bounded `ProjectContext` only
- `vscode.lm` provider behind a swappable `AiProvider` interface
- Prompt-injection framing, evidence IDs, candidate-file validation, and a second AI size budget
- Native VS Code TreeView (`browserDebugBridge.diagnosis`) that presents the validated `Diagnosis`
- In-memory diagnosis state with refresh/clear commands and workspace-jailed candidate navigation

This is **not** a full-repository scan, not a file-modifying agent, and **not** a guarantee of the correct root cause.

**Phase 8 provides a read-only diagnosis UI. It does not generate or apply code changes.**

WebSocket events, diffs, and patch application are not part of this phase.

## Future roadmap

Later phases are expected to add, in order:

1. Proposed fixes with developer approval before apply
2. Optional screenshot-to-model vision

Do not assume any of those capabilities exist in the current tree.
