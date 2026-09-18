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

`test` runs Node's test runner via `tsx` in the schema, redaction, and VS Code extension packages. The Chrome extension has no unit tests yet.

## Local bridge

The VS Code extension owns an HTTP server bound to **`127.0.0.1:17321`**. It starts on activation and stops on deactivation.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/health` | public | Liveness |
| GET | `/pair-status` | public | `{ paired: boolean }` (never the token) |
| POST | `/pair` | unauthenticated | Submit the pairing token |
| POST | `/sessions` | Bearer token | Submit a `session.submit` payload |
| POST | `/sessions/:sessionId/ack` | Bearer token | Acknowledge a stored session |

There is no `/events` WebSocket in this phase.

### Security assumptions

- Only loopback IPv4 (`127.0.0.1`, plus IPv4-mapped `::ffff:127.0.0.1`) is accepted.
- Browser requests must send `Origin: chrome-extension://<id>` matching `browserDebugBridge.chromeExtensionId`.
- Requests **without** an `Origin` header are allowed for local VS Code/curl testing. That does not relax browser Origin checks.
- Session endpoints require `Authorization: Bearer <token>`.
- Request bodies larger than 5 MB are rejected with HTTP 413.
- Debug sessions stay in memory (max 20) and are not written to disk.
- Pairing tokens are never logged, returned from `/health` or `/pair-status`, or stored in source.

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
5. Click **Submit test session**. VS Code should log `Session received: <sessionId>`.

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

The built folder must contain `manifest.json`, `background.js`, and `popup.html`. Capture and debugger permissions are not part of this phase. The popup is development pairing UX only.

For rebuild-on-change during extension UI work:

```bash
pnpm --filter @browser-debug-bridge/chrome-extension dev
```

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
