# Development

These instructions match the current workspace scripts.

## Prerequisites

- **Node.js 20 or later** (this repo is tested with Node.js 24)
- **pnpm 9 or later** (the repo declares `packageManager`: `pnpm@10.17.1`)

Enable pnpm with Corepack if it is not already on your `PATH`:

```bash
corepack enable
corepack prepare pnpm@10.17.1 --activate
```

On Windows, if Corepack cannot write shims under `C:\Program Files\nodejs`, install pnpm into your user npm prefix instead:

```bash
npm install -g pnpm@10.17.1
```

Do not use npm or yarn to install workspace dependencies.

## Install dependencies

From the repository root:

```bash
pnpm install
```

This links every package under `apps/*` and `packages/*`.

## Typecheck

```bash
pnpm typecheck
```

This runs `typecheck` in each workspace package (`tsc --noEmit`).

## Build

```bash
pnpm build
```

This runs `build` in each workspace package:

| Package | Build output |
| --- | --- |
| `@browser-debug-bridge/schema` | `packages/schema/dist/` |
| `@browser-debug-bridge/redaction` | `packages/redaction/dist/` |
| `@browser-debug-bridge/chrome-extension` | `apps/chrome-extension/dist/` |
| `browser-debug-bridge-vscode` | `apps/vscode-extension/out/` |

Filter shortcuts:

```bash
pnpm build:chrome
pnpm build:vscode
```

## Lint and test

```bash
pnpm lint
pnpm test
```

`lint` runs ESLint from the repo root.

`test` runs Node's test runner via `tsx` in the schema, redaction, Chrome extension, and VS Code extension packages.

## Local bridge

The VS Code extension owns an HTTP server bound to **`127.0.0.1:17321`**. It starts on activation and stops on deactivation.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | public | Liveness |
| GET | `/pair-status` | public | `{ paired: boolean }` (never the token) |
| POST | `/pair` | unauthenticated | Submit the pairing token |
| POST | `/sessions` | Bearer token | Submit a `session.submit` payload |
| POST | `/sessions/:sessionId/screenshot` | Bearer token | Raw JPEG bytes for that session id |
| DELETE | `/sessions/:sessionId/screenshot` | Bearer token | Drop a pending/bound screenshot |
| POST | `/sessions/:sessionId/ack` | Bearer token | Acknowledge a stored session |

There is no `/events` WebSocket in this phase.

### Security assumptions

- Only loopback IPv4 (`127.0.0.1`, plus IPv4-mapped `::ffff:127.0.0.1`) is accepted.
- Browser requests must send `Origin: chrome-extension://<id>` matching `browserDebugBridge.chromeExtensionId`.
- Requests **without** an `Origin` header are allowed for local VS Code/curl testing. That does not relax browser Origin checks.
- Session endpoints require `Authorization: Bearer <token>`.
- JSON request bodies larger than 5 MB are rejected with HTTP 413.
- JPEG screenshot bodies larger than 1 MB are rejected with HTTP 413.
- Debug sessions and screenshot artifacts stay in memory (max 20 each) and are not written to disk.
- Pairing tokens and screenshot bytes are never logged.

### Configure the Chrome origin

Unpacked Chrome extensions do not have a permanent production ID.

1. Build and load `apps/chrome-extension/dist` at `chrome://extensions`.
2. Copy the extension ID.
3. In VS Code / Cursor settings, set:

```json
{
  "browserDebugBridge.chromeExtensionId": "paste-the-id-here"
}
```

4. Run **Browser Debug Bridge: Stop Local Bridge**, then **Start Local Bridge** (or reload the Extension Development Host) so the server picks up the ID.

Until this is set, Chrome popup requests are rejected with `ORIGIN_NOT_ALLOWED`. `curl` to `/health` still works because it has no Origin header.

### Development pairing flow

This is **local development UX**, not production pairing.

1. Launch the VS Code Extension Development Host (F5).
2. Command Palette → **Browser Debug Bridge: Show Pairing Code**.
3. Copy the token from the input box. Do not paste it into logs or chat.
4. Open the Chrome extension popup, paste the token, click **Pair with VS Code**.
5. Click **Start Debug Session** on a local page, or **Submit test session** for the fake payload. VS Code should log `Session received: <sessionId>`.

The token lives in VS Code `SecretStorage` (`browserDebugBridge.pairingToken`) and, after pairing, in Chrome `chrome.storage.local`. It is generated with `crypto.randomBytes(32)`.

### VS Code commands

| Command | Purpose |
| --- | --- |
| Browser Debug Bridge: Hello | Smoke test that the extension loaded |
| Browser Debug Bridge: Show Pairing Code | Local-dev display of the pairing token |
| Browser Debug Bridge: Start Local Bridge | Start the loopback server if it is not running |
| Browser Debug Bridge: Stop Local Bridge | Stop the server (idempotent) |
| Browser Debug Bridge: Create Test Session | Insert a fake `DebugSessionV1` into the in-memory store |

### Fake session testing

Both sides use `createFakeDebugSessionV1()` from `@browser-debug-bridge/schema`. Values are obviously fake. The Chrome popup **Submit test session** button posts that payload through the paired bridge.

### Bridge tests

```bash
pnpm --filter browser-debug-bridge-vscode test
pnpm test
```

Bridge tests start a real `127.0.0.1` HTTP server on an ephemeral port and do not require the VS Code Extension Host.

## Build the Chrome extension

```bash
pnpm build:chrome
```

Load the unpacked extension in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `apps/chrome-extension/dist`

The built folder must contain `manifest.json`, `background.js`, `popup.html`, `content-script.js`, and `console-hook.js`. `content-script.js` and `console-hook.js` are produced by extra Vite IIFE builds and are injected only when the user starts a debug session (`console-hook.js` into the page MAIN world).

### Chrome permissions (Phase 4–5B)

| Permission | Why it exists |
| --- | --- |
| `storage` | Pairing token in `chrome.storage.local`; capture status in `chrome.storage.session` |
| `activeTab` | Reach only the tab where the user clicked the extension action |
| `scripting` | Inject the session-scoped picker/content script and MAIN-world console hook |
| `host_permissions`: `http://127.0.0.1:17321/*` | Talk to the existing local VS Code bridge |

Not requested: `<all_urls>`, `debugger`, `webRequest`, `cookies`, `tabs`.

### Capture mode

1. Pair Chrome with VS Code.
2. Open a regular `http(s)` page.
3. Click **Start Debug Session** in the popup.
4. Hover to highlight, click to select, enter an optional description, submit.
5. Press Escape or **Cancel capture** to exit. Reload/navigation removes the picker.

The page never receives the pairing token. Invalid sessions are not sent.

`tabIdHash` is SHA-256 of `salt:tabId` truncated to 32 hex characters. The salt is a 256-bit random per-installation value in `chrome.storage.local` (`browserDebugBridge.tabIdSalt`). It is not a hard-coded secret. Raw tab ids are not stored in DebugSessionV1.

Captured HTML and descriptions are not written to `chrome.storage.local` and do not survive browser restart.

For rebuild-on-change during popup/background work:

```bash
pnpm --filter @browser-debug-bridge/chrome-extension dev
```

That watch build does not rebuild `content-script.js` or `console-hook.js`. Use `pnpm build:chrome` after picker/content-script/console-hook changes.

Reload the extension on `chrome://extensions` after each rebuild.

## Launch the VS Code extension development host

1. Build at least once (`pnpm build:vscode` or the preLaunch task below).
2. Open this repository root in VS Code or Cursor.
3. Choose **Run and Debug** → **Run VS Code Extension** (F5).

That configuration lives in `.vscode/launch.json`. It starts an Extension Development Host with:

`--extensionDevelopmentPath=<repo>/apps/vscode-extension`

The **preLaunchTask** `build-vscode-extension` compiles `apps/vscode-extension` to `out/`.

### Smoke test

In the Extension Development Host:

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Run **Browser Debug Bridge: Hello**
3. Confirm the information message: `Browser Debug Bridge loaded.`

That Hello command remains available. After F5, the local bridge should already be running. Confirm with:

```bash
curl http://127.0.0.1:17321/health
```

### Phase 4 capture smoke test

Use the fixture page at `apps/chrome-extension/test-page/index.html`. It contains only fake secrets.

1. From `apps/chrome-extension/test-page`, serve it on loopback, for example:

   ```bash
   python -m http.server 4173 --bind 127.0.0.1
   ```

2. Open `http://127.0.0.1:4173/?token=fake-secret-token`.
3. Launch the VS Code Extension Development Host and pair Chrome (see above).
4. Click **Start Debug Session**.
5. Hover elements and confirm the overlay follows the pointer.
6. Click **Buy now**, enter a short description, submit.
7. Confirm VS Code logs `Session received: <sessionId>`.
8. Confirm the submitted `page.url` redacts `token=` and the captured DOM does not include `FakePassword123!` or `fake-api-key-value`.
9. Start capture again, press Escape, and confirm the overlay disappears.
10. Start capture, then reload the tab, and confirm the picker is gone.

Do not use real credentials.

### Phase 5A screenshot smoke test

The same fixture page includes a small `tiny` span, the medium **Buy now** button, and a large dashed panel.

1. Pair Chrome with VS Code and open the fixture page.
2. Start a debug session, select **tiny**, submit.
3. Confirm VS Code logs `Session received` and `Screenshot received` (byte count only, no image data).
4. Confirm the DebugSession `screenshot` field is JPEG metadata: `cropped: true`, real width/height, SHA-256, not 1×1 placeholders.
5. Repeat with the large panel. The JPEG should be proportionally scaled if it exceeds 1600×1200 and must not include the orange picker overlay.
6. If practical, select an element that is partly off-screen. Only the visible region is captured; the page is not scrolled.
7. Reload the Extension Development Host and confirm in-memory screenshots are gone.

Do not use real secrets. Screenshots are not redacted. Network capture is not implemented.

### Phase 5B console smoke test

The fixture page includes buttons that emit fake `console.log` / `warn` / `error`, a thrown `Error`, and an unhandled rejection (`token=fake-token-123`, `api_key=fake-api-key-456`).

1. Pair Chrome with VS Code and open the fixture page.
2. Start a debug session, then click the console buttons (and throw / reject if desired).
3. Select an element and submit.
4. Confirm VS Code received `console[]` entries (levels, ISO timestamps, bounded stacks).
5. Confirm at most 50 entries and that `fake-token-123` / `fake-api-key-456` are `[REDACTED]`.
6. Confirm `[page error]` / `[unhandled rejection]` prefixes for runtime events if those buttons were used.
7. Cancel a new session, click a console button, and confirm that message is not attached to a later session.
8. Reload during capture and confirm the old session does not continue on the new page.

A real Chrome + Extension Development Host is required for this path. Isolated-world unit tests do not load `chrome.tabs` or the MAIN-world hook.
