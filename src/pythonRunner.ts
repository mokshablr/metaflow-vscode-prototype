import * as vscode from 'vscode';
import * as os from 'os';
import { spawn } from 'child_process';

export interface RunScriptOptions {
  timeoutMs?: number;
}

export function runPythonScript<T = unknown>(
  scriptPath: string,
  args: string[],
  options?: RunScriptOptions
): Promise<T> {
  return new Promise((resolve, reject) => {
    const pythonPath = vscode.workspace.getConfiguration('metaflow').get<string>('pythonPath', 'python3');
    const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
    const child = spawn(pythonPath, [scriptPath, ...args], { cwd });

    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    if (options?.timeoutMs) {
      timeout = setTimeout(() => {
        settled = true;
        child.kill();
        reject(new Error(`Script timed out after ${options.timeoutMs! / 1000}s.`));
      }, options.timeoutMs);
    }

    const out: string[] = [];
    const err: string[] = [];
    child.stdout?.on('data', (c: Buffer) => out.push(c.toString()));
    child.stderr?.on('data', (c: Buffer) => err.push(c.toString()));
    child.on('close', (code) => {
      if (timeout) { clearTimeout(timeout); }
      if (settled) { return; }
      try {
        const parsed = JSON.parse(out.join(''));
        if (parsed && typeof parsed === 'object' && 'error' in parsed) {
          reject(new Error(parsed.error));
        } else {
          resolve(parsed as T);
        }
      } catch {
        reject(new Error(err.join('') || `exit code ${code}`));
      }
    });
    child.on('error', (e) => {
      if (timeout) { clearTimeout(timeout); }
      if (settled) { return; }
      reject(e);
    });
  });
}
