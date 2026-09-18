# Architecture

This document records the architecture already decided for Browser Debug Bridge V1. It is not a proposal.

## 1. Product purpose

Browser Debug Bridge is a local-first developer tool:

**Browser debugging session → project-aware diagnosis → proposed code fix.**

The intended path is:

1. Chrome
2. Browser debugging session
3. Local bridge
4. VS Code
5. Project-aware diagnosis
6. Proposed code fix
7. Developer approval
8. Apply

V1 does not include a cloud backend, hosted API, dashboard, or database. Work stays on the developer's machine. Nothing is applied to the workspace without explicit developer approval.

## 2. Chrome extension

`apps/chrome-extension` is a Manifest V3 Chrome extension.

Its future job is to participate in a browser debugging session and send a sanitized session payload toward VS Code. In later phases that includes capture of debugging signals such as console output, network activity, and DOM context.

Phase 1 established the TypeScript + Vite + Manifest V3 foundation. Phase 3 adds pairing with the local VS Code bridge and a development popup that can submit a **fake** DebugSession. It does not request debugger, scripting, or `<all_urls>` permissions, and it does not implement capture.

## 3. VS Code extension

`apps/vscode-extension` is a VS Code extension using the official Extension API.

Its future job is to receive a debug session, inspect the open project, present a diagnosis, and propose a code fix. The developer reviews the proposal and chooses whether to apply it.

Phase 1 established the extension foundation and a Hello smoke-test command. Phase 3 starts a loopback HTTP bridge inside the extension process, stores pairing tokens in SecretStorage, and keeps recent DebugSession payloads in memory. It does not analyze the workspace, show a Debug Session tree, call an AI provider, or modify files.

## 4. Shared packages

Two workspace packages are shared by the apps:

### `@browser-debug-bridge/schema`

Shared contract between Chrome and VS Code. Phase 2 implements:

- DebugSession V1 types
- protocol message types, versioned independently of DebugSession
- Zod runtime validators
- size and version constants

Both sides must validate data at runtime. TypeScript types alone are not trusted across process boundaries. Screenshot *bytes* are not part of DebugSession; the schema stores only screenshot metadata.

### `@browser-debug-bridge/redaction`

Phase 2 implements reusable, host-agnostic sanitization:

- URL redaction
- DOM-like attribute and value sanitization
- secret/JWT-like text handling
- workspace patch path protection

These functions do not depend on Chrome or VS Code APIs. Capture, pairing, and patch application are later phases.

There is no separate protocol-client, API, or server package in V1.

## 5. Local bridge

Chrome and VS Code communicate through a **local HTTP bridge** owned by the VS Code extension.

- Bind address: `127.0.0.1` only (never `0.0.0.0`)
- Port: `17321` (`BRIDGE_PORT`)
- Transport in this phase: HTTP only (no WebSocket `/events` yet)
- Auth: `Authorization: Bearer <pairing-token>` on session endpoints
- Pairing token: 256-bit value in VS Code `SecretStorage`, copied into Chrome `chrome.storage.local` via the development pairing command
- Origin: browser requests must use `chrome-extension://<configured-id>`
- Sessions: validated with `@browser-debug-bridge/schema`, stored in memory (max 20), not written to disk

There is no separate Node app, cloud API, or database.

## 6. Future AI provider abstraction

Project-aware diagnosis and proposed fixes will use an AI provider behind an abstraction.

That abstraction is not implemented in Phase 1. Provider SDKs are not dependencies of this repository. When AI is added, it should be swappable, local to the developer's workflow, and never applied to the codebase without approval.

## 7. Security-first philosophy

Security is a product constraint, not a later add-on:

- Local-first: session data is not designed to leave the machine for a V1 backend.
- Least privilege: the Chrome extension starts with no debug or host permissions; later permissions must be justified by a specific capture need.
- Redaction before sharing: URLs, DOM, secrets, and sensitive fields are stripped in `@browser-debug-bridge/redaction` before a session is used for diagnosis.
- Patch path protection: generated fixes must not silently touch protected paths.
- Human approval: diagnosis may propose a fix; only the developer applies it.

Phase 3 implements the local loopback bridge, pairing, and in-memory session ingest. Capture, AI, and patching remain later phases.
