import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    "browserDebugBridge.hello",
    () => {
      void vscode.window.showInformationMessage(
        "Browser Debug Bridge loaded.",
      );
    },
  );

  context.subscriptions.push(disposable);
}

export function deactivate(): void {}
