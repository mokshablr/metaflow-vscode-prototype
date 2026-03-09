import * as vscode from 'vscode';
import { runPythonCommand } from './runner';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('metaflow.runFlow', () =>
      runPythonCommand('run')
    ),
    vscode.commands.registerCommand('metaflow.spinStep', () =>
      runPythonCommand('spin')
    )
  );
}

export function deactivate() {}
