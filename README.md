# Browser Debug Bridge

Browser debugging session → project-aware diagnosis → proposed code fix.

Browser Debug Bridge is a local-first tool. The Chrome extension captures the current tab. The VS Code extension stores that session on a loopback HTTP bridge, ranks files in the open workspace, asks `vscode.lm` for a diagnosis and a proposed edit, and writes files only after you review the proposal and confirm Apply.

Nothing in this repository sends session data to a project-owned cloud backend. The language model is the one selected by VS Code (`vscode.lm`).

## Key features

- Element picker on the tab where you start capture (`activeTab` and `scripting`)
- Bounded DOM and computed-CSS capture, with shared redaction
- Cropped JPEG of the selected visible region (max 1600×1200, about 1 MB), uploaded separately from the session JSON
- The most recent 50 console entries and the most recent 100 network **failures** for that capture
- Loopback bridge at `127.0.0.1:17321` with a pairing token, Origin checks, body limits, and in-memory session storage
- Ranked workspace candidates and bounded source excerpts
- Read-only diagnosis and an in-memory unified diff
- Diagnosis view in the activity bar (`browserDebugBridge.diagnosis`)
- Review in a VS Code diff, Reject without writing, and Apply through one `WorkspaceEdit` after confirmation

Diagnosis and Propose Fix do not modify workspace files.

## System architecture

```text
Chrome element picker
        ↓
DOM, CSS, console, and network-failure capture
        ↓
Cropped JPEG upload, then DebugSessionV1
        ↓
HTTP bridge on 127.0.0.1:17321
        ↓
Project intelligence
        ↓
vscode.lm diagnosis
        ↓
Diagnosis TreeView
        ↓
In-memory fix proposal and unified diff
        ↓
Review (required) → Reject, or confirm Apply
        ↓
WorkspaceEdit, save, then a full-file hash check
```

| Piece | Role |
| --- | --- |
| `apps/chrome-extension` | Manifest V3 popup, picker, capture, and bridge client |
| `apps/vscode-extension` | Bridge, project intelligence, diagnosis, proposal, review, reject, and apply |
| `packages/schema` | `DebugSessionV1` and protocol Zod schemas |
| `packages/redaction` | URL, DOM, text, and workspace-path checks |

The bridge runs inside the VS Code extension process. It starts when the extension activates and stops when the extension deactivates. There is no WebSocket endpoint.

## Prerequisites

- Node.js 20 or later
- pnpm 9 or later (this repo pins `pnpm@10.17.1`)
- Google Chrome, for an unpacked Manifest V3 extension
- Visual Studio Code 1.90 or later
- A `vscode.lm` language model for a live diagnosis or proposal

Tests do not call `vscode.lm`. They use `FakeAiProvider`.

Chrome permissions are `storage`, `activeTab`, and `scripting`, plus host permission `http://127.0.0.1:17321/*`. The manifest does not request `<all_urls>`, `debugger`, `cookies`, or `webRequest`.

## Installation

From the repository root:

```bash
corepack enable
corepack prepare pnpm@10.17.1 --activate
pnpm install
pnpm build
```

On Windows, if Corepack cannot write shims, `npm install -g pnpm@10.17.1` is the fallback documented in [docs/development.md](docs/development.md). Use pnpm for workspace dependencies.

`pnpm build` builds the schema package, the redaction package, the Chrome extension (`apps/chrome-extension/dist`), and the VS Code extension (`apps/vscode-extension/out`).

## Chrome extension setup

1. `pnpm build:chrome`
2. Open `chrome://extensions`
3. Turn on **Developer mode**
4. **Load unpacked** and choose `apps/chrome-extension/dist`
5. Copy the extension ID shown on that card

The popup is the toolbar action **Browser Debug Bridge**. It is a development UI: paste a token, pair, check bridge health, start or cancel capture, or submit a synthetic test session.

`pnpm --filter @browser-debug-bridge/chrome-extension dev` watches the main Vite build only. After changes to the content script or the console and network hooks, run `pnpm build:chrome` again.

## VS Code extension setup

1. Open this repository in VS Code.
2. Run and Debug → **Run VS Code Extension** (F5).

That launch config uses `.vscode/launch.json` and the `build-vscode-extension` preLaunch task. The Extension Development Host loads `apps/vscode-extension`.

In the Extension Development Host:

1. Open the workspace you want to diagnose.
2. Set **Browser Debug Bridge: Chrome Extension Id** (`browserDebugBridge.chromeExtensionId`) to the ID from `chrome://extensions`.
3. Run **Browser Debug Bridge: Stop Local Bridge**, then **Browser Debug Bridge: Start Local Bridge**, or reload the Extension Development Host, so the bridge reads the new ID.

Until that setting matches the Chrome extension, browser requests are rejected with `ORIGIN_NOT_ALLOWED`. The bridge still starts on activation. If `127.0.0.1:17321` is already taken, activation reports that the local bridge could not start.

There is no marketplace package script in this repository. The extension is used from the Extension Development Host.

## Local bridge pairing

The pairing token is 32 random bytes, shown as 64 hex characters. It is stored in VS Code SecretStorage under `browserDebugBridge.pairingToken` and, after a successful pair, in Chrome `chrome.storage.local`.

1. In the Extension Development Host, run **Browser Debug Bridge: Show Pairing Code**.
2. Copy the token from the input box. Do not paste it into logs or chat.
3. Open the Chrome popup, paste the token, and click **Pair with VS Code**.
4. **Check health** should report the bridge status and the extension version.

`POST /pair` checks the token. Session and screenshot calls then send `Authorization: Bearer <token>`. A wrong token is not stored. **Check health** and pair-status do not require the token. Session, screenshot, and ack calls do.

Chrome requests include an `Origin` of `chrome-extension://<id>`. That value must match `browserDebugBridge.chromeExtensionId`.

## How to start a debugging session

On the page you want to inspect:

1. Pair first. **Start Debug Session** refuses to start when no token is stored, and it checks that the bridge answers `/health`.
2. Click **Start Debug Session**.
3. Hover to highlight, click an element, then enter an optional description. Escape or **Cancel capture** cancels.
4. The extension uploads the cropped JPEG, then submits the session.

A captured session (a real browser version, not the synthetic `0.0.0-fake` version) shows **Chrome debug session received.** in VS Code, with a **Diagnose** action for that session id.

**Submit test session** in the popup, **Diagnose Test Session**, and **Create Test Session** use a synthetic session. A later synthetic session does not replace the latest captured session.

**Diagnose Latest Session** uses the newest captured session. It does not create one. **Refresh** reloads the Diagnosis view and does not call the model. Open a workspace folder first. The activity-bar view is **Browser Debug Bridge → Diagnosis**.

**Analyze Test Session** prints a project-intelligence summary. It does not call the language model.

## How AI diagnosis works

**Diagnose Latest Session**, **Diagnose Test Session**, or the notification's **Diagnose** action runs project intelligence, then `vscode.lm`. If a proposal is already stored, Diagnose asks before discarding it.

Project intelligence searches the open workspace, drops ignored and sensitive paths, and ranks at most 12 candidate files with bounded excerpts. The model sees the serialized session and those excerpts. It does not receive screenshot bytes, a filesystem API, or a workspace-edit API. `vscode.lm` is called with two User messages because that API has no system role. If several models exist, the extension picks the first after a stable vendor, family, and id sort. If none exist, the result is `AI_UNAVAILABLE` and the previous diagnosis is kept.

The Diagnosis view shows the summary, hypotheses, evidence, and candidate files. Model text is shown as plain text.

**Propose Fix** asks the model for structured edits inside those candidate excerpts, checks the result, and stores an in-memory unified diff. The completion message is: `In-memory proposed change ready. No workspace files were modified.`

## How to review, reject, and apply proposed fixes

These commands are implemented. They appear on the Diagnosis view title when a proposal exists.

1. **Review Proposed Fix** opens a read-only VS Code diff of each planned file. The proposal is not writable until this has been opened for the current proposal. A new proposal must be reviewed again.
2. **Reject Proposed Fix** drops the in-memory proposal and its preview. The diagnosis stays. No file is written.
3. **Apply Proposed Fix** plans the edit again, asks you to confirm, and names the relative paths in the dialog. Confirming runs one `WorkspaceEdit`, then saves. Success is reported only when the saved bytes match the planned full-file hash.

Apply refuses the write when:

- Review has not been opened for this proposal
- you cancel the confirmation
- a target buffer is dirty
- the full-file hash no longer matches the proposal
- the stored diff does not match the edits
- the path is not a diagnosis candidate, fails the lexical jail, or fails the canonical path check

If a later save fails, files that were already saved are written back to their previous contents. If the post-write hash does not match, Apply restores those contents when it can, and names the relative paths when it cannot.

A crash during a multi-file save can still leave a subset of files updated. Apply does not retry on its own.

**Clear Diagnosis** drops the diagnosis, the proposal, and the preview, unless Apply is already running.

## Security and privacy model

- The bridge listens on `127.0.0.1` only, port `17321`.
- A browser `Origin` must be `chrome-extension://` plus the configured extension ID. A request with no `Origin` is accepted so local curl can reach the bridge. That does not allow a normal page fetch, which sends its own `Origin`.
- The pairing token is compared with a timing-safe check when the lengths match. It is not written into session JSON or bridge logs.
- JSON bodies stop at 5 MB. JPEG bodies stop at 1 MB and must start with JPEG magic bytes. At most 20 sessions and 20 screenshots are kept in memory. They are cleared when the bridge stops.
- `requestId` values are kept for the life of the bridge process. Reusing one for a different session is rejected. Submitting the same body again does not make that session the latest.
- A different payload for an existing session id is rejected.
- URLs, DOM fields, and console text pass through redaction before submit. Routing query names such as `id`, `q`, and `page` can keep their values. Other query values, token-like URL fragments, JWTs, and `Bearer` tokens in text are redacted.
- Screenshot bytes stay in the bridge process. The model receives mime, size, hash, and whether the image was cropped.
- Proposed paths must be diagnosis candidates. Lexical checks reject traversal, absolute paths outside the workspace, UNC paths, and sensitive basenames such as `.env` and private-key names. Apply also resolves `realpath` and opens that real path immediately before `WorkspaceEdit`.
- Apply cannot run by itself. Review and the confirmation dialog are required.

## Known limitations

- Redaction is heuristic. A secret that does not match those shapes can remain in DOM text, console text, or the cropped screenshot. Screenshots are not OCR'd.
- While capture is active, a page script can dispatch `bdb:console` or `bdb:network`. Those events are recorded like hook events. Treat captured page text as untrusted. Apply still requires Review and confirmation.
- Console and network buffers live in the extension service worker. A worker restart drops them.
- Screenshot bytes are not shown in the Diagnosis view and are not sent to the model.
- There is no WebSocket stream and no marketplace package.
- `vscode.lm` has to be available for a live diagnosis. The automated tests never call it.
- Multi-file Apply is not an atomic disk transaction.

## Troubleshooting

Messages in the UI stay short. The **Browser Debug Bridge** output channel records error codes, not prompts, tokens, or source text.

| What you see | What to check |
| --- | --- |
| Local bridge could not start | Something else is bound to `127.0.0.1:17321`, or the Extension Development Host did not activate. |
| Bridge unavailable in the popup | The Extension Development Host is not running, or **Start Local Bridge** was not run after a stop. |
| Pairing fails or HTTP 401 | The token does not match SecretStorage. Show the pairing code again and pair again. A rejected token is not saved. |
| `ORIGIN_NOT_ALLOWED` | `browserDebugBridge.chromeExtensionId` does not match the ID on `chrome://extensions`. Restart the bridge after changing it. |
| Invalid session or screenshot | The JPEG was missing, was not a JPEG, was over 1 MB, or its SHA-256 did not match the session. |
| No debug session | Capture a page, or use **Diagnose Test Session**. **Refresh** does not create a session. A synthetic session is not used by **Diagnose Latest Session**. |
| Open a workspace folder | No workspace folder is open in the Extension Development Host. |
| AI provider unavailable | No `vscode.lm` model is available. The previous diagnosis is kept. |
| AI response invalid | The model JSON failed validation. The previous diagnosis or proposal is kept. |
| Review before applying | Run **Review Proposed Fix** for this proposal, then Apply. |
| Dirty buffer or source changed | Save or revert the file, or propose again. Apply will not overwrite a dirty buffer or a file whose full-file hash moved. |
| Apply could not restore a file | The warning lists the relative paths. Check those files before editing further. |

## Development and testing

```bash
pnpm typecheck
pnpm lint
pnpm test
```

`pnpm typecheck` builds `@browser-debug-bridge/schema` and `@browser-debug-bridge/redaction` first, because other packages import their `dist` output, then typechecks each package.

`pnpm test` runs the Node test runner through `tsx` in the schema, redaction, Chrome, and VS Code packages. Bridge tests listen on an ephemeral `127.0.0.1` port. They do not launch Chrome or the Extension Development Host. Workflow tests check that `apps/vscode-extension/test-fixtures/fixture-project` is unchanged on disk. Apply is tested with an in-memory document writer, not a live `WorkspaceEdit`.

Package filters:

```bash
pnpm --filter @browser-debug-bridge/schema test
pnpm --filter @browser-debug-bridge/redaction test
pnpm --filter @browser-debug-bridge/chrome-extension test
pnpm --filter browser-debug-bridge-vscode test
```

A fixture page with sample API routes is available:

```bash
pnpm --filter @browser-debug-bridge/chrome-extension fixture-server
```

More detail is in [docs/development.md](docs/development.md) and [docs/architecture.md](docs/architecture.md).

## License

Private / unlicensed while the project is in early development.
