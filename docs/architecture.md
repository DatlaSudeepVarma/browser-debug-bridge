# Architecture

This document describes the architecture that is implemented. Review, Reject, and Apply are part of that path.

## 1. Data flow

```text
Chrome Extension
    → Local HTTP Bridge
    → VS Code Extension
    → Workspace Intelligence
    → Built-in Language Model
    → Diagnosis
    → Proposed Unified Diff
    → Safety Planner
    → User Confirmation
    → WorkspaceEdit
```

A captured page becomes a `DebugSessionV1`. The VS Code extension stores it in memory, ranks files in the open workspace, and asks `vscode.lm` for a diagnosis and then for structured edits. The host builds the unified diff. `planSafeApply` refuses a proposal that fails path, hash, or diff checks. The user must open Review and then confirm the named files. Only then does Apply submit one `WorkspaceEdit`.

There is no project-owned cloud backend, hosted API, dashboard, or database. The language model is the one VS Code selects. Nothing is written unless the user confirms Apply.

## 2. Package responsibilities

| Package | Responsibility |
| --- | --- |
| `apps/chrome-extension` | Manifest V3 popup, element picker, DOM/CSS/console/network capture, JPEG upload, and the loopback client |
| `apps/vscode-extension` | Loopback HTTP bridge, session store, workspace intelligence, diagnosis, proposal, review, reject, and apply |
| `packages/schema` | `DebugSessionV1`, protocol messages, Zod validators, and size constants |
| `packages/redaction` | URL, DOM, text, and workspace-path checks used by both apps |

The Chrome content script does not hold the pairing token. Bridge calls stay in the service worker and `src/bridge`. The VS Code TreeView does not call `vscode.lm`. It reads controllers that already hold a validated diagnosis or proposal.

There is no separate protocol-client, API, or server package.

## 3. Shared contracts

`@browser-debug-bridge/schema` is the contract across the Chrome process and the extension host. TypeScript types are not trusted at the boundary. Both sides parse with Zod.

`PROTOCOL_VERSION` is `1`. `DEBUG_SESSION_SCHEMA_VERSION` versions the session independently of the protocol envelope.

The live HTTP messages are:

| Message | Where it is used |
| --- | --- |
| `health.response` | `GET /health` |
| `pair.status` | `GET /pair-status` |
| `pair.token` | `POST /pair` body |
| `pair.token.result` | Successful pair response |
| `session.submit` | `POST /sessions` |
| `session.ack` | `POST /sessions/:sessionId/ack` and the submit response |
| `screenshot.ack` | JPEG upload response |
| `error` | Rejected requests, with a `ProtocolErrorCode` |

The schema also defines `pair.request` and `pair.response`. The running bridge does not serve that pairing-code exchange. Pairing is `pair.token`.

`DebugSessionV1` carries the selected element, truncated DOM, an allowlisted CSS subset, redacted page fields, browser name and version, an optional user description, a hashed tab id, screenshot **metadata**, up to 50 console entries, and up to 100 network-failure records. JPEG bytes are not a session field.

`createFakeDebugSessionV1()` builds a synthetic session whose `browser.version` is `0.0.0-fake`. `isSyntheticDebugSession` recognizes that version.

## 4. Session lifecycle

1. The user pairs, then clicks **Start Debug Session**. The service worker injects the picker and the MAIN-world console and network hooks into the current tab. There is no permanent `content_scripts` entry.
2. Hover highlights an element. Click selects it. Escape, **Cancel capture**, navigation, or tab close stops the session and clears the in-memory console and network buffers.
3. After selection, the overlay is hidden. The service worker captures the visible tab, crops it, and uploads the JPEG.
4. The worker redacts the capture, builds `session.submit`, and posts it. The bridge validates the body, stores the session, and returns `session.ack`.
5. A captured session (any browser version other than `0.0.0-fake`) becomes the latest captured session and shows **Chrome debug session received.** with a **Diagnose** action for that session id.
6. **Diagnose Latest Session** uses that captured session. It does not create one. **Refresh** reloads the Diagnosis view and does not call the model. If a proposal exists, Diagnose asks before replacing it.
7. **Submit test session**, **Create Test Session**, and **Diagnose Test Session** use a synthetic session. A later synthetic session does not replace the latest captured session.
8. Diagnosis success replaces the previous diagnosis and clears any previous proposal. Failure, cancellation, and a cleared in-flight run keep or discard results without storing a partial diagnosis. See Failure handling.
9. **Propose Fix** stores an in-memory proposal. **Review Proposed Fix** marks that proposal reviewed after the diff opens. **Reject Proposed Fix** drops the proposal and keeps the diagnosis. **Apply Proposed Fix** writes, then clears the proposal.
10. **Clear Diagnosis** drops the diagnosis, the proposal, and the preview unless Apply is already running.
11. Bridge stop and extension deactivation clear the in-memory session and screenshot stores. They are not written to disk.

The bridge keeps at most 20 sessions. Adding a session that is already stored does not refresh `receivedAt` and does not notify again. A different payload for an existing session id is rejected. An idempotent `requestId` whose session was already evicted is acknowledged and is not stored again.

## 5. Authentication

The bridge binds `127.0.0.1` port `17321`. Tests may use an ephemeral port. It does not bind `0.0.0.0`.

The pairing token is 32 random bytes, encoded as 64 hex characters. VS Code stores it in SecretStorage under `browserDebugBridge.pairingToken`. **Show Pairing Code** displays it. Chrome stores it in `chrome.storage.local` only after `pair.token.result` parses as paired.

| Route | Auth |
| --- | --- |
| `GET /health` | none |
| `GET /pair-status` | none |
| `OPTIONS` | none |
| `POST /pair` | the token in the JSON body |
| `POST /sessions`, screenshot upload and delete, `POST /sessions/:sessionId/ack` | `Authorization: Bearer <token>` |

Bearer comparison uses a timing-safe equality check when the lengths match. A length mismatch returns before that compare. The token is not written into session JSON or bridge logs.

When an `Origin` header is present it must be `chrome-extension://` plus `browserDebugBridge.chromeExtensionId`. A request with no `Origin` is accepted so local curl can reach the bridge. A page fetch sends its own origin and does not match. `Host` must be `127.0.0.1` or `127.0.0.1` with a numeric port. A host that smuggles another authority is rejected.

JSON bodies stop at 5 MB. JPEG bodies stop at 1 MB and must start with JPEG magic bytes.

## 6. Data redaction

`@browser-debug-bridge/redaction` is the shared implementation. Chrome does not keep a second copy of the rules.

- `redactUrl` redacts sensitive query names, JWTs, and any query value whose name is not in `PUBLIC_QUERY_PARAMETER_NAMES` (`id`, `q`, `query`, `search`, `state`, `page`, `limit`, `offset`, `sort`, `order`, `tab`, `view`, `lang`, `locale`, `ref`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`). Token-like URL fragments are redacted. A fragment without those shapes, such as a short slug, can remain.
- `redactSensitiveText` redacts JWTs and `Bearer` tokens in free text.
- DOM helpers redact sensitive attributes, `javascript:` URLs, and `data:` URLs.
- `inspectWorkspacePath` rejects traversal, NUL bytes, absolute paths outside the workspace folder, UNC and `\\?\` paths, drive-relative paths, and sensitive basenames such as `.env`, `.envrc`, `.npmrc`, `.pem`, `.key`, `.pfx`, and `.p12`. `~` is not expanded.

Redaction runs before submit. Page text, URLs, attributes, and the user description stay untrusted data. The model is told not to follow instructions inside them.

This is not complete secret detection. A value that matches none of those shapes can remain in DOM text or a console message. Console stacks can still contain file paths. Screenshot pixels are not OCR'd.

## 7. Screenshot handling

After the user selects an element, the service worker calls `chrome.tabs.captureVisibleTab`. Only the visible region is captured. The page is not scrolled. The picker overlay is hidden first.

The PNG is cropped to the selected element's clamped viewport rectangle, scaled down when needed to 1600×1200, and encoded as JPEG at quality about 0.8. The result must be at most 1 MB. `screenshot.sha256` is the SHA-256 of those final bytes.

Bytes are uploaded first:

`POST /sessions/:sessionId/screenshot` with `Content-Type: image/jpeg` and the bearer token.

`session.submit` is accepted for a JPEG session only when a pending artifact with that SHA-256 is already stored. A rejected metadata body deletes the pending JPEG. Evicting a session deletes its screenshot. At most 20 artifacts are kept. Nothing is written to disk.

The model receives mime, dimensions, hash, and whether the image was cropped. It does not receive the bytes. The Diagnosis view lists those dimensions and can open the stored JPEG in a local panel. That panel does not write the image to disk.

## 8. AI interaction

`AiProvider` is `isAvailable()` and `complete({ system, user })`. `DiagnosisService` and `FixProposalService` share that interface. The first implementation is `vscode.lm`: `selectChatModels()`, then `sendRequest` with two User messages, because that API has no system role. If several models exist, the extension uses the first after a stable vendor, family, and id sort. No model id is hard-coded. No model means `AI_UNAVAILABLE`.

Diagnosis input is the serialized session plus the bounded `ProjectContext`: page, selected element, DOM, CSS, screenshot metadata, console, network failures, the user description, framework and package-manager hints, and ranked excerpts. The model does not receive pairing tokens, cookies, authorization headers, request bodies, screenshot bytes, workspace roots, or files outside the excerpt budget.

Limits on the diagnosis prompt include 24,000 characters, 8 candidate files, 2 excerpts per file, 40 lines per excerpt, 20 console entries, and 20 network entries. If the budget still cannot be met, the result is `AI_CONTEXT_TOO_LARGE`.

The model must return JSON and cite serializer ids (`BROWSER.*` and `PROJECT.candidate[n]`). Unknown evidence ids and file paths that were not in `ProjectContext` are dropped. Diagnosis text is bounded. The response is not executed.

The fix prompt is a separate budget. It includes the validated diagnosis and at most three diagnosis-referenced candidate files with excerpts that were already captured. If those excerpts are missing, the result is `AI_FIX_CONTEXT_INSUFFICIENT`. The model returns `{ relativePath, startLine, endLine, replacement }` edits. The host generates the unified diff. The model is not given a shell, `git`, or `WorkspaceEdit`.

One diagnosis run and one proposal run are in flight at a time. A second request is busy.

## 9. File ranking

Workspace intelligence is local and deterministic. `ProjectContext` is not sent to Chrome and is not stored on the bridge.

```text
DebugSessionV1
    → every open workspace folder
    → findFiles, at most 500 source files, shared across roots
    → small manifest and lockfile reads
    → named integer scores
    → at most 12 ranked candidates
    → bounded excerpts
    → ProjectContext
```

Browser URLs, selectors, console stacks, and network paths are search signals. They are not filesystem paths. A candidate path is `workspaceRoot` plus a relative path discovered inside that root.

Ignored directories include `.git`, `node_modules`, `.next`, `dist`, `build`, `coverage`, `out`, `target`, `vendor`, `.cache`, `tmp`, and `logs`. Framework hints prefer package names (`next`, `nuxt`, `@angular/core`, `astro`, `svelte`, `vue`, `react`) over filename guesses. Package-manager evidence is lockfile presence, in the order bun, pnpm, yarn, npm.

| Signal | Weight |
| --- | --- |
| Console stack path that resolves inside the workspace | 100 |
| Page URL path segment | 40 |
| Network failure URL path segment | 25 |
| Selected element id | 25 |
| `data-testid` | 20 |
| Component or file name | 20 |
| Class name | 15 |
| Framework routing convention | 10 |
| Selected text | 5 |

Ties break by workspace folder name, then relative path. The first file is a rank, not a claim that it is the cause.

Excerpts are at most 3 per file and 40 lines each, with 200 context lines in total. Files larger than 256 KB are not fully loaded. A cancelled run returns `{ status: "cancelled" }` and is not stored as a completed analysis. No open workspace returns `{ status: "no-workspace" }`.

## 10. Proposal validation

`FixProposalService` checks the model JSON before anything is stored.

Every path must be:

1. a diagnosis candidate
2. accepted by `inspectWorkspacePath`
3. free of sensitive basenames

An unsafe proposal is refused. It is not truncated into a smaller edit. Duplicate paths, empty edit lists, malformed ranges, edits outside the trusted excerpt, and overlapping edits are refused.

The host hashes the bounded excerpt (`originalContentHash`) and ignores any hash the model supplies. A proposal built from excerpt A is invalid against excerpt B. Session and diagnosis fingerprints are stored on the proposal. A later diagnosis clears the previous proposal before the new diagnosis is shown.

`planSafeApply` runs those checks again and also:

- refuses a missing, malformed, or identity-inconsistent proposal (`APPLY_NO_PROPOSAL`, `APPLY_PROPOSAL_MALFORMED`, `APPLY_IDENTITY_MISMATCH`)
- refuses a proposal that does not belong to the current session and diagnosis (`APPLY_DIAGNOSIS_MISMATCH`)
- refuses a path that fails the lexical jail (`APPLY_PATH_REJECTED`) or whose real path leaves the workspace (`APPLY_CANONICAL_REJECTED`)
- refuses a missing file (`APPLY_FILE_MISSING`)
- refuses edits that do not replay onto the live file (`APPLY_EDIT_INVALID`, `APPLY_TEXT_AMBIGUOUS`)
- regenerates the unified diff and refuses when `diff.text` differs (`APPLY_DIFF_MISMATCH`)

## 11. Hash verification

Two hashes are in use. They are not interchangeable.

| Hash | What it covers | When it is checked |
| --- | --- | --- |
| `originalContentHash` | SHA-256 of the bounded excerpt the model saw | Proposal validation and the safety planner |
| `liveFileHashes` | SHA-256 of the complete file | Safety planner, immediately before `WorkspaceEdit` |

Apply refuses when the full-file baseline is missing (`APPLY_BASELINE_MISSING`). The excerpt digest is not a substitute. Apply refuses when the file on disk no longer matches that baseline (`APPLY_SOURCE_CHANGED`).

After a successful save, Apply reads the file again and compares it with the SHA-256 of the planned contents. A mismatch restores the previous contents when it can. If the restore fails, the result names the relative paths.

## 12. Safe application

`browserDebugBridge.reviewFix` opens a read-only VS Code diff of each planned file. `markReviewed` runs only after that open succeeds, and only if the proposal is still current. Replacing the proposal clears the reviewed flag.

`browserDebugBridge.rejectFix` drops the in-memory proposal and its preview. The diagnosis stays. No file is written.

`browserDebugBridge.applyFix` is the only `WorkspaceEdit` path. `runApplyFix`:

1. Refuses while diagnosis or another apply is running.
2. Runs `planSafeApply` against a fresh read of the live files.
3. Refuses with `APPLY_NOT_REVIEWED` until this proposal has been reviewed.
4. Confirms with the user. The dialog lists the relative paths.
5. Plans again. If the after-image changed, the result is `stale` and nothing is written.
6. Asks the writer to re-resolve each canonical path. A path that no longer matches the planned real path returns `mismatch` and is not opened.
7. Opens `vscode.Uri.file` of that real path and submits one `WorkspaceEdit` for every planned file.
8. Saves. If a later save fails, files that were already saved are written back to their previous contents.
9. Verifies the post-write hash. Success clears the proposal. A mismatch restores the previous contents.

A dirty editor buffer is `REVIEW_SOURCE_DIRTY`. Apply does not overwrite it.

A crash during a multi-file save can still leave a subset of files updated. Apply does not retry on its own. The gap between the last canonical recheck and the editor open is small, and a symlink swap in that gap is not separately locked.

## 13. Failure handling

| Situation | Result |
| --- | --- |
| Bridge port already taken | Activation reports that the local bridge could not start. Sessions are not accepted. |
| Bad token, origin, host, JSON, or JPEG | HTTP error with a protocol code. A rejected token is not stored. A rejected session does not replace a stored one. |
| Model missing | `AI_UNAVAILABLE`. The previous diagnosis stays. |
| Model request throws | `AI_REQUEST_FAILED`. The previous diagnosis stays. |
| Model JSON invalid or too large | `AI_RESPONSE_INVALID` or `AI_RESPONSE_TOO_LARGE`. The previous diagnosis or proposal stays. |
| Prompt over budget | `AI_CONTEXT_TOO_LARGE` or `AI_FIX_CONTEXT_INSUFFICIENT`. Nothing new is stored. |
| User or token cancels | `AI_CANCELLED` or `{ status: "cancelled" }`. An in-flight success that loses the generation check is `discarded` or `stale` and is not stored. |
| User declines the confirm dialog | `declined`. The proposal stays. |
| Proposal replaced during Apply | `stale` or `stale-after-write`. A write that already finished is not reported as a clean apply. |
| Save fails | Earlier files in that apply are restored. The proposal stays. |
| Post-write hash mismatch | Previous contents are restored, or the warning names the paths that could not be restored. |
| Page dispatches `bdb:console` or `bdb:network` during capture | The event is recorded like a hook event. URL text is still redacted. Apply still requires Review and confirmation. |

User notifications stay short. The output channel records error codes, not prompts, tokens, excerpts, or raw model text.

## 14. Security boundaries

- Chrome permissions are `storage`, `activeTab`, and `scripting`, plus `http://127.0.0.1:17321/*`. The manifest does not request `<all_urls>`, `debugger`, `cookies`, `tabs`, or `webRequest`.
- Capture is the current tab, and only after the user starts it. Cookies, authorization headers, storage APIs, request and response bodies, successful network calls, and other tabs are not collected.
- Console and network hooks run in the page MAIN world and are removed when the session ends. The page can replace `console` or `fetch` after install. Bridge URLs on `127.0.0.1:17321` and `localhost:17321` are not recorded as network failures.
- The content script never sees the pairing token. Tab ids are stored as SHA-256 of `salt:tabId`. The salt is a per-installation 256-bit value in `chrome.storage.local`.
- Screenshot bytes and session JSON stay in the extension process. Restarting VS Code drops them.
- `requestId` values are remembered for the life of the process. Reuse with a different session id is rejected. The protocol has no timestamp nonce. A process that already has the pairing token can submit a new session.
- Proposed paths must be diagnosis candidates. Lexical checks do not follow symlinks. `inspectCanonicalWorkspaceTarget` resolves `realpath` and rejects a target outside the workspace. Apply resolves that path again and opens the real path.
- The model cannot read the workspace or apply an edit. The host drops paths the model invents.
- Review and the confirmation dialog are required. Reject writes nothing.

### Capture limits

| Resource | Cap |
| --- | --- |
| Stored sessions | 20 |
| Screenshot artifacts | 20, 1 MB JPEG each |
| Console entries | 50 |
| Network failure entries | 100 |
| Discovered source files | 500 |
| Ranked candidates | 12 |
| Diagnosis AI input | 24,000 characters |
| Concurrent diagnosis or proposal | 1 |

### Maintainer checklist

- [ ] Chrome `permissions` and `host_permissions` stay as documented unless a requirement is written down
- [ ] No `<all_urls>`, `debugger`, `cookies`, or `webRequest`
- [ ] The bridge still binds `127.0.0.1` only
- [ ] Bearer comparison stays timing-safe, and the pairing token is never logged
- [ ] Origin checks are not weakened to make a test pass
- [ ] Candidate allowlist, excerpt hash, and full-file hash checks stay on the Apply path
- [ ] `browserDebugBridge.applyFix` remains the only `WorkspaceEdit` path
- [ ] Apply still requires Review, names the files, rechecks the canonical path, and verifies the saved bytes
- [ ] No new AI SDK, cloud endpoint, or telemetry
- [ ] Schema changes ship with compatibility tests
