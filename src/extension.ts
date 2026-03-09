import * as vscode from 'vscode';
import { runPythonCommand } from './runner';
import { MetaflowTreeProvider } from './metaflowTreeProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new MetaflowTreeProvider(context.extensionPath);
  vscode.window.createTreeView('metaflowExplorer', { treeDataProvider: provider });

  context.subscriptions.push(
    vscode.commands.registerCommand('metaflow.runFlow', () =>
      runPythonCommand('run')
    ),
    vscode.commands.registerCommand('metaflow.spinStep', () =>
      runPythonCommand('spin')
    ),
    vscode.commands.registerCommand('metaflow.refreshExplorer', () =>
      provider.refresh()
    )
  );
}

export function deactivate() {}
