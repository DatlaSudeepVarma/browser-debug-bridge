import * as vscode from "vscode";
import {
  PROPOSED_PREVIEW_SCHEME,
  type ProposedPreviewStore,
} from "../fix/preview-store.js";
import type { ReviewDiffOpener } from "../fix/review-open.js";
import { toCandidateUri } from "./vscode-open.js";

/**
 * Registers the shared virtual-document provider for proposed after-images.
 * The registration lives for the whole extension session; rejecting a single
 * proposal only clears the store, which:
 *  - fires `onDidChange` for every cleared URI so an already-open diff editor
 *    re-requests content and receives an empty document instead of the
 *    discarded text, and
 *  - closes any open diff tabs whose proposed side uses this scheme.
 */
export function registerProposedPreviewProvider(store: ProposedPreviewStore): vscode.Disposable {
  const changes = new vscode.EventEmitter<vscode.Uri>();
  const provider: vscode.TextDocumentContentProvider = {
    onDidChange: changes.event,
    provideTextDocumentContent(uri: vscode.Uri): string {
      return store.provide(uri.toString()) ?? store.provide(uri.path) ?? "";
    },
  };
  const registration = vscode.workspace.registerTextDocumentContentProvider(PROPOSED_PREVIEW_SCHEME, provider);
  const cleared = store.onDidClear((uris) => {
    for (const uri of uris) {
      try {
        changes.fire(vscode.Uri.parse(uri));
      } catch {
        // A malformed URI cannot be open in an editor; nothing to invalidate.
      }
    }
    void closeProposedDiffTabs();
  });
  return vscode.Disposable.from(registration, changes, { dispose: () => cleared.dispose() });
}

async function closeProposedDiffTabs(): Promise<void> {
  try {
    const stale: vscode.Tab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input: unknown = tab.input;
        if (input instanceof vscode.TabInputTextDiff && input.modified.scheme === PROPOSED_PREVIEW_SCHEME) {
          stale.push(tab);
        } else if (input instanceof vscode.TabInputText && input.uri.scheme === PROPOSED_PREVIEW_SCHEME) {
          stale.push(tab);
        }
      }
    }
    if (stale.length > 0) {
      await vscode.window.tabGroups.close(stale, true);
    }
  } catch {
    // Best effort only; the provider already serves empty content for cleared URIs.
  }
}

export function createVscodeReviewOpener(): ReviewDiffOpener {
  return {
    async openDiff(original, proposedUri, title): Promise<boolean> {
      try {
        await vscode.commands.executeCommand(
          "vscode.diff",
          toCandidateUri(original.workspaceRoot, original.relativePath),
          vscode.Uri.parse(proposedUri),
          title,
        );
        return true;
      } catch {
        return false;
      }
    },
  };
}
