# Browser Debug Bridge

Browser debugging session → project-aware diagnosis → proposed code fix.

## What this project is

Browser Debug Bridge is a **local-first** developer tool. It is designed to take a Chrome debugging session, diagnose the issue in the context of the open VS Code project, and propose a code fix for the developer to approve before anything is applied.

The intended flow is:

```text
Chrome element picker
        ↓
Bounded DOM/CSS capture
        ↓
Screenshot capture
        ↓
Console and network failure capture
        ↓
DebugSessionV1
        ↓
Authenticated local bridge
        ↓
Project Intelligence
        ↓
AI Diagnosis
        ↓
VS Code TreeView
        ↓
AI Fix Proposal
        ↓
Validated Unified Diff
        ↓
Native VS Code Diff        (not implemented)
        ↓
Explicit Apply / Reject    (not implemented)
        ↓
Validated workspace modification
        ↓
Developer verifies the result
```

No cloud backend is part of V1. Session metadata stays on the developer's machine except for the configured AI provider (`vscode.lm`).

## Current development status

This repository is in **early development (Phase 11)**. Phases 1–9 are implemented. Phase 10 (native VS Code diff UI, explicit Apply/Reject, and workspace writes) was **not implemented**. Phase 11 audited the existing tree, hardened security and state races, and added integration tests.

The following are **not implemented**:

- Native VS Code diff UI
- Apply / Reject commands
- Any `WorkspaceEdit` / `writeFile` path
- WebSocket events
- Screenshot bytes sent to a multimodal model
- Marketplace publication

Do not treat this tree as production-ready. See [docs/architecture.md](docs/architecture.md) for the security checklist and remaining risks.

## Architecture overview

The repository is a pnpm + TypeScript monorepo:

| Area | Role |
| --- | --- |
| Chrome extension | Manifest V3: pair, pick an element, capture a cropped JPEG, session-scoped console and network failure metadata, submit a sanitized DebugSession |
| VS Code extension | Owns the local loopback HTTP bridge, project intelligence, read-only AI diagnosis, diagnosis TreeView, and in-memory fix proposals |
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

## Supported environment

- Node.js 20 or later
- pnpm 9 or later
- Google Chrome (Manifest V3 unpacked extension)
- Visual Studio Code 1.90 or later (Extension Development Host)
- A `vscode.lm` language model for live diagnosis/proposals (tests use `FakeAiProvider`)

Chrome permissions remain `storage`, `activeTab`, `scripting`, plus host permission `http://127.0.0.1:17321/*`. There is no `<all_urls>`, `debugger`, `cookies`, or `webRequest` permission.

## Development setup

```bash
pnpm install
pnpm typecheck
pnpm build
pnpm test
pnpm lint
```

Full commands, pairing, packaging, and manual checks are in [docs/development.md](docs/development.md).

## Current V1 scope

- Session-scoped element picker on the current tab (`activeTab` + `scripting`)
- Bounded selected-element, DOM, and computed-CSS capture with shared redaction
- Cropped JPEG screenshot of the selected visible region (max 1600×1200, ~1 MB), uploaded separately from session JSON
- Session-scoped console capture (most recent 50 entries)
- Session-scoped network **failure metadata** (most recent 100 entries) — not a HAR recorder
- Local HTTP bridge on `127.0.0.1:17321` with Bearer pairing, Origin checks, body limits, session/screenshot caps, requestId replay cache, and duplicate-session rejection
- Deterministic project intelligence: workspace-jailed discovery, ranked candidate files, bounded excerpts
- Read-only AI diagnosis from `DebugSessionV1` + bounded `ProjectContext` only
- Native VS Code TreeView (`browserDebugBridge.diagnosis`)
- In-memory proposed change + validated unified diff, candidate-allowlisted and size-bounded

**Generating a diagnosis, proposal, or unified diff does not modify workspace files.** There is no Apply path in this tree.

## Security and privacy boundaries

- Chrome talks only to `http://127.0.0.1:17321`. It does not send capture data to an unapproved remote service.
- Pairing tokens live in VS Code `SecretStorage` and Chrome `storage.local`. They are not placed in DebugSession payloads or logs.
- Authorization headers, cookies, request/response bodies, and unrelated storage are not captured.
- Screenshot bytes are stored in memory, out of band from session JSON, and are not sent to the model.
- Heuristic redaction is **not** perfect secret detection. JWTs, obvious API-key query names, and a small set of sensitive field names are redacted; unknown secrets can still appear in DOM text, console messages, or screenshots.
- `inspectWorkspacePath` is a lexical jail. Canonical/realpath checks run on proposed fix paths when the workspace exists on disk. Lexical checks alone do not stop symlink attacks; that is why canonical inspection exists.
- Native Apply is absent, so the product cannot currently write a proposed patch. Future Apply must re-read the file, compare `originalContentHash`, and refuse stale or escaped targets.

## V1 exclusions

Autonomous agents, automatic code fixing without approval, cloud backends, team collaboration, browsers other than Chrome, extra AI provider SDKs, screenshot vision, full HAR recording, arbitrary workspace scanning, and marketplace publication.

## License

Private / unlicensed while the project is in early development.
