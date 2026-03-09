import * as vscode from 'vscode';
import * as path from 'path';

let sharedTerminal: vscode.Terminal | undefined;

function getTerminal(): vscode.Terminal {
  if (!sharedTerminal || sharedTerminal.exitStatus !== undefined) {
    sharedTerminal = vscode.window.createTerminal('Metaflow');
  }
  return sharedTerminal;
}

export async function runPythonCommand(mode: 'run' | 'spin'): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const doc = editor.document;
  await doc.save();

  const filePath = doc.fileName;
  const fileDir = path.dirname(filePath);
  const terminal = getTerminal();

  if (mode === 'run') {
    terminal.show();
    terminal.sendText(`cd "${fileDir}" && python "${filePath}" run`);
    return;
  }

  // spin: find enclosing step def above cursor
  const stepName = findEnclosingDef(editor);
  if (!stepName) {
    vscode.window.showErrorMessage('No enclosing Python function found above cursor.');
    return;
  }

  terminal.show();
  terminal.sendText(`cd "${fileDir}" && python "${filePath}" spin ${stepName}`);
}

function findEnclosingDef(editor: vscode.TextEditor): string | null {
  const cursorLine = editor.selection.active.line;
  for (let i = cursorLine; i >= 0; i--) {
    const text = editor.document.lineAt(i).text.trim();
    const match = text.match(/^(?:async\s+def|def)\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(/);
    if (match) {
      return match[1];
    }
  }
  return null;
}
