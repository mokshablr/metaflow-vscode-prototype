import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';
import { VALID_STATUSES } from '../../src/metaflowTreeProvider';

export { VALID_STATUSES };
export type ValidStatus = typeof VALID_STATUSES[number];

export function isValidStatus(status: unknown): boolean {
  return typeof status === 'string' && (VALID_STATUSES as readonly string[]).includes(status);
}

export const EXTENSION_ID = 'local.metaflow-vscode-prototype';

export function getPythonPath(): string {
  return vscode.workspace.getConfiguration('metaflow').get<string>('pythonPath', 'python3');
}

export interface ScriptResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export function runPythonScript(scriptPath: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv): Promise<ScriptResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(getPythonPath(), [scriptPath, ...args], {
      cwd: cwd ?? path.resolve(__dirname, '../../..'),
      ...(env ? { env } : {}),
    });

    const out: string[] = [];
    const err: string[] = [];

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Python script timed out after 15s'));
    }, 15000);

    child.stdout?.on('data', (c: Buffer) => out.push(c.toString()));
    child.stderr?.on('data', (c: Buffer) => err.push(c.toString()));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ stdout: out.join(''), stderr: err.join(''), code });
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

let metaflowCheckPromise: Promise<boolean> | null = null;

export function isMetaflowInstalled(): Promise<boolean> {
  if (!metaflowCheckPromise) {
    metaflowCheckPromise = new Promise<boolean>((resolve) => {
      try {
        const child = spawn(getPythonPath(), ['-c', 'import metaflow']);
        child.on('close', (code) => resolve(code === 0));
        child.on('error', () => resolve(false));
      } catch {
        resolve(false);
      }
    });
  }
  return metaflowCheckPromise;
}

export function safeParseJson(stdout: string): unknown | null {
  try {
    return JSON.parse(stdout);
  } catch {
    return null;
  }
}

export async function ensureExtensionActive(): Promise<void> {
  const ext = vscode.extensions.getExtension(EXTENSION_ID);
  if (ext && !ext.isActive) {
    await ext.activate();
  }
}
