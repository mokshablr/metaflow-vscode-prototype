import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';

export interface RunInfo {
  flowFilePath: string;
  flowName: string | undefined;
  runId: string;
}

const _onRunStarted = new vscode.EventEmitter<RunInfo>();
export const onRunStarted: vscode.Event<RunInfo> = _onRunStarted.event;

let outputChannel: vscode.OutputChannel | undefined;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('Metaflow Run');
  }
  return outputChannel;
}

export function parseRunId(line: string): string | null {
  const m = line.match(/run[- ]id[: ]+(\d+)/i);
  return m ? m[1] : null;
}

export function parseFlowName(line: string): string | null {
  // Matches: "Metaflow 2.x.x executing LinearFlow for user:xyz"
  const m = line.match(/executing\s+([A-Z][A-Za-z0-9_]+)\s+for\s+user:/);
  return m ? m[1] : null;
}

/** Fallback: extract FlowSpec subclass name from source file via regex. */
export function extractFlowNameFromFile(filePath: string): string | undefined {
  try {
    const src = fs.readFileSync(filePath, 'utf8');
    const m = src.match(/class\s+([A-Z][A-Za-z0-9_]+)\s*\(\s*FlowSpec\s*\)/);
    return m ? m[1] : undefined;
  } catch {
    return undefined;
  }
}

export async function runPythonCommand(mode: 'run' | 'spin', extraArgs?: string[]): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return;
  }

  const doc = editor.document;
  await doc.save();

  const filePath = doc.fileName;
  const fileDir = path.dirname(filePath);
  const pythonPath = vscode.workspace.getConfiguration('metaflow').get<string>('pythonPath', 'python3');

  const args = [filePath];
  if (mode === 'run') {
    args.push('run');
    if (extraArgs) {
      args.push(...extraArgs);
    }
  } else {
    const stepName = findEnclosingDef(editor);
    if (!stepName) {
      vscode.window.showErrorMessage('No enclosing Python function found above cursor.');
      return;
    }
    args.push('spin', stepName);
  }

  const channel = getOutputChannel();
  channel.show(true);
  channel.appendLine(`\n--- Metaflow ${mode}: ${path.basename(filePath)} ---`);

  const child = spawn(pythonPath, args, { cwd: fileDir });

  let firedRunStarted = false;
  let detectedFlowName: string | undefined;
  const bufs = { stdout: '', stderr: '' };

  function processLine(line: string): void {
    channel.appendLine(line);
    if (!detectedFlowName) {
      detectedFlowName = parseFlowName(line) ?? undefined;
    }
    if (!firedRunStarted) {
      const runId = parseRunId(line);
      if (runId) {
        firedRunStarted = true;
        const flowName = detectedFlowName ?? extractFlowNameFromFile(filePath);
        _onRunStarted.fire({ flowFilePath: filePath, flowName, runId });
      }
    }
  }

  function attachLineHandler(stream: NodeJS.ReadableStream, key: 'stdout' | 'stderr'): void {
    stream.on('data', (chunk: Buffer) => {
      bufs[key] += chunk.toString();
      const lines = bufs[key].split('\n');
      bufs[key] = lines.pop()!;
      for (const line of lines) { processLine(line); }
    });
  }

  attachLineHandler(child.stdout, 'stdout');
  attachLineHandler(child.stderr, 'stderr');

  child.on('close', (code) => {
    for (const remaining of Object.values(bufs)) {
      if (remaining) { processLine(remaining); }
    }
    channel.appendLine(`--- Process exited with code ${code} ---`);
  });

  child.on('error', (err) => {
    channel.appendLine(`Error: ${err.message}`);
  });
}

export function findEnclosingDef(editor: vscode.TextEditor): string | null {
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

export function disposeRunner(): void {
  outputChannel?.dispose();
  _onRunStarted.dispose();
}
