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

`apps/chrome-extension` is a Manifest V3 extension.

Phase 4 capture is session-scoped. The popup **Start Debug Session** control asks the service worker to inject `content-script.js` into the current tab with `chrome.scripting.executeScript` and `activeTab`. There is no permanent `content_scripts` registration and no `<all_urls>` permission.

```
Page (picker / DOM / CSS / element geometry / session-scoped console)
    → chrome.runtime messaging
    → service worker (screenshot + console ring buffer)
    → hide overlay, captureVisibleTab, crop, JPEG, SHA-256
    → POST /sessions/:sessionId/screenshot (raw JPEG)
    → redaction + DebugSessionV1 metadata + session.submit
    → 127.0.0.1:17321
    → VS Code in-memory session + screenshot stores
```

The content script never receives the pairing token. Bridge authentication stays in the service worker and `src/bridge` client.

Temporary picker/session status uses `chrome.storage.session`. The pairing token and a per-installation tab-id salt stay in `chrome.storage.local`. Captured HTML and screenshot bytes are not written to disk.

DebugSessionV1 contains only screenshot **metadata** (`mime`, `width`, `height`, `sha256`, `cropped`). JPEG bytes travel on a separate authenticated endpoint. `console[]` holds up to 50 session-scoped, redacted entries. `network` remains empty.

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

Chrome capture reuses these functions. It does not duplicate redaction rules. Page text, URLs, attributes, and user descriptions are data, never instructions.

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

That abstraction is not implemented. Provider SDKs are not dependencies of this repository. When AI is added, it should be swappable, local to the developer's workflow, and never applied to the codebase without approval.

## 7. Security-first philosophy

Security is a product constraint, not a later add-on:

- Local-first: session data is not designed to leave the machine for a V1 backend.
- Least privilege: Chrome permissions are storage, `activeTab`, `scripting`, and the existing loopback host permission. `debugger`, `webRequest`, `cookies`, `tabs`, and `<all_urls>` are not requested.
- Redaction before sharing: URLs, DOM, secrets, and sensitive fields are stripped in `@browser-debug-bridge/redaction` before a session is submitted.
- Patch path protection: generated fixes must not silently touch protected paths.
- Human approval: diagnosis may propose a fix; only the developer applies it.

Phase 5A added cropped screenshot capture. Phase 5B adds session-scoped console capture. AI, project intelligence, TreeView, diffs, and file modification remain later phases.

## 8. Phase 4–5B capture details

### Permissions

| Permission | Why |
| --- | --- |
| `storage` | Pairing token (`local`) and temporary capture status (`session`) |
| `activeTab` | Access only the tab the user invoked the extension on |
| `scripting` | Inject the picker/content script and a session-scoped MAIN-world console hook |
| `host_permissions`: `http://127.0.0.1:17321/*` | Existing local bridge (unchanged) |

`activeTab` + `scripting` are sufficient for session-scoped page interaction. Host access to arbitrary sites is not required because the user starts capture from the toolbar popup on the current tab.

### Element picker

The injected script draws a temporary overlay (`data-bdb-picker-host`) in a closed shadow root. Hover highlights the element under the pointer; click selects it; Escape cancels. The overlay is removed on select (after the description prompt), cancel, navigation/`pagehide`, or extension disconnect. It does not persist styles in the application.

### Captured fields

The payload is a `DebugSessionV1`:

- `selectedElement`: selector, tag, id, classes, role, textPreview, rect, ancestorPath
- `dom`: `outerHtmlTruncated`, `htmlBytes`, `truncated`
- `css`: allowlisted `computedSubset` plus compact `matchedRuleSummaries`
- `page`: redacted url/title/origin
- `browser`: Chrome/Chromium name + version + extension version
- `userDescription`: optional, schema-bounded, untrusted text
- `capture.tabIdHash`: SHA-256 of `salt:tabId` (32 hex chars). Salt is a per-installation 256-bit random value in `chrome.storage.local` (`browserDebugBridge.tabIdSalt`). Raw tab ids are never stored in the session.
- `capture.permissionsGranted`: `activeTab` and `scripting` only
- `screenshot`: JPEG metadata only (`mime`, `width`, `height`, `sha256`, `cropped`)
- `console`: up to 50 `{ level, message, timestamp, stack? }` entries from the active session only

`htmlBytes` is the UTF-8 size of the sanitized HTML before truncation, capped at the schema maximum.

### Cropped screenshots

After the user selects an element and hides the picker overlay, the service worker calls `chrome.tabs.captureVisibleTab` (granted by existing `activeTab`; no `debugger` permission). Only the currently visible region is captured. The page is not scrolled. The overlay is not in the image.

The visible-tab PNG is cropped to the selected element's clamped viewport rectangle, scaled down if needed to **1600×1200** (never upscaled), and encoded as JPEG quality ~0.8, max **1 MB**. `screenshot.sha256` is SHA-256 of those final JPEG bytes.

Bytes are uploaded first:

`POST /sessions/:sessionId/screenshot`  
`Content-Type: image/jpeg`  
`Authorization: Bearer <token>`

Then `session.submit` is sent. JPEG sessions are rejected unless a pending screenshot with the matching SHA-256 is already in memory. If metadata is rejected, the pending JPEG is deleted. Session eviction also deletes the screenshot. Nothing is written to disk. Restarting VS Code drops both stores.

Screenshots are sensitive. Visible pixels inside the selected region may include secrets. They are **not** treated as fully redactable, are not sent to AI or a cloud service, and are not persisted.

### Session-scoped console

Capture starts when the user clicks **Start Debug Session** and stops on submit, cancel, Escape, navigation/`pagehide`, extension disconnect, or tab close. There is no permanent global listener and no historical DevTools console dump.

**What is captured**

- Page `console.debug` / `log` / `info` / `warn` / `error` after a session-scoped MAIN-world hook (`chrome.scripting.executeScript` `world: "MAIN"`, not `chrome.debugger`)
- Window `error` and `unhandledrejection` events, stored as `console[]` **error** entries prefixed `[page error]` / `[unhandled rejection]` (runtime error evidence, not `console.log` calls)
- Only the debugging tab. Raw tab ids are not stored (`tabIdHash` only)

**What is not captured**

- Console activity from before the session
- Other tabs, windows, background pages, or unrelated origins
- Browser-generated DevTools-only lines (failed network, CSP, extension, or Chrome-internal messages) that never go through page `console` or `window` error events
- `console.time` / `group` / `count` and similar non-message methods
- Complete browser console history

Isolated-world monkey-patching cannot see page-script `console` calls. The MAIN-world hook restores the original methods when the session ends. The page can still overwrite `console` after install; that is documented, not “fixed” with debugger access.

Levels map as: `debug|log|info|warn|error` unchanged; `warning` → `warn`; `fatal|exception|assert` → `error`; `verbose` → `debug`; `dir|dirxml|table|trace` → `log`; anything else is ignored.

The service worker keeps an in-memory ring buffer of the **most recent 50** entries (`MAX_CONSOLE_ENTRIES`). Messages are clipped to 4096 characters; stacks to 2048 (schema allows 8192). Arguments are serialized with bounded depth (4), property count (20), array length (20), string length (256), and total size (2048) without invoking getters or functions. Circular references become `[Circular]`. Failures become `[Unserializable value]`.

Console text is untrusted. `@browser-debug-bridge/redaction` plus conservative bearer/query-pair heuristics are applied before submit. Redaction is **not** complete secret detection. Extension logs may include buffer size only, never message contents.

Reload or navigation invalidates the current session (existing picker lifecycle). The hook dies with the page; the service worker clears the buffer. A new page is not attached to the old session.

### Not captured

Cookies, authorization headers, `localStorage` / `sessionStorage` / IndexedDB, password-manager data, complete browser console history, network requests, full-page or other-tab screenshots, browser chrome, and workspace files.

Cross-origin stylesheets that throw when reading `cssRules` are skipped. Capture continues; a bounded evidence note may be added.
