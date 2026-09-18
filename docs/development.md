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

`test` runs Node's test runner via `tsx` in the schema and redaction packages. The Chrome and VS Code apps have no unit tests yet.

## Build the Chrome extension

```bash
pnpm build:chrome
```

Load the unpacked extension in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select `apps/chrome-extension/dist`

The built folder must contain `manifest.json` and `background.js`. The service worker only logs that it loaded. Capture, pairing, and debugger permissions are not part of Phase 1.

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

That Hello command is the only VS Code behavior implemented in Phase 1.
