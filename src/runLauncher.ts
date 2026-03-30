import * as vscode from 'vscode';
import * as path from 'path';
import { runPythonScript } from './pythonRunner';
import { runPythonCommand } from './runner';

export interface ParameterInfo {
  name: string;
  type: string | null;
  default: string | number | boolean | null;
}

export type BackendChoice = 'local' | 'kubernetes' | 'batch';

/** Calls get_parameters.py and returns the detected Parameter definitions. */
export async function getParameters(
  extensionPath: string,
  flowFilePath: string
): Promise<ParameterInfo[]> {
  const scriptPath = path.join(extensionPath, 'python', 'get_parameters.py');
  return runPythonScript<ParameterInfo[]>(scriptPath, [flowFilePath]);
}

/**
 * Pure function — builds the extra args to append after `metaflow run`.
 * Each non-empty parameter becomes `--<name> <value>`.
 * Backend flags map to Metaflow's `--with` argument.
 * Exported for testing; no I/O performed.
 */
export function buildRunArgs(
  params: Array<{ name: string; value: string }>,
  backend: BackendChoice
): string[] {
  const args: string[] = [];
  for (const { name, value } of params) {
    if (value.trim() !== '') {
      args.push(`--${name}`, value);
    }
  }
  if (backend === 'kubernetes') {
    args.push('--with', 'kubernetes');
  } else if (backend === 'batch') {
    args.push('--with', 'batch');
  }
  return args;
}

export async function launchRun(extensionPath: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'python') {
    vscode.window.showErrorMessage('Open a Python flow file first.');
    return;
  }

  const flowFilePath = editor.document.uri.fsPath;

  let parameters: ParameterInfo[];
  try {
    parameters = await getParameters(extensionPath, flowFilePath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to parse flow parameters: ${msg}`);
    return;
  }

  // Escape on any InputBox cancels the whole launch
  const resolvedParams: Array<{ name: string; value: string }> = [];
  for (const param of parameters) {
    const defaultStr = param.default != null ? String(param.default) : '';
    const typeLabel = param.type ? ` (${param.type})` : '';
    const value = await vscode.window.showInputBox({
      title: `Parameter: ${param.name}${typeLabel}`,
      prompt: `Enter value for --${param.name}`,
      value: defaultStr,
      placeHolder: defaultStr || 'no default',
    });
    if (value === undefined) {
      return;
    }
    resolvedParams.push({ name: param.name, value });
  }

  const backendItems = [
    {
      label: '$(play) Local',
      description: 'Run locally (default)',
      backend: 'local' as BackendChoice,
    },
    {
      label: '$(cloud) Kubernetes',
      description: '--with kubernetes',
      backend: 'kubernetes' as BackendChoice,
    },
    {
      label: '$(server-process) AWS Batch',
      description: '--with batch',
      backend: 'batch' as BackendChoice,
    },
  ];

  const picked = await vscode.window.showQuickPick(backendItems, {
    placeHolder: 'Select execution backend',
  });
  if (!picked) {
    return;
  }

  const extraArgs = buildRunArgs(resolvedParams, picked.backend);
  await runPythonCommand('run', extraArgs);
}
