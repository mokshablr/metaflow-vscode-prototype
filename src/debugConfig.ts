import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { runPythonScript } from './pythonRunner';
import { TaskInfo } from './metaflowTreeProvider';
import { extractFlowNameFromFile, findEnclosingDef } from './runner';

const _generatedWrappers: string[] = [];

/** Remove all generated debug wrapper temp files. Call on extension deactivation. */
export function cleanupDebugWrappers(): void {
  for (const p of _generatedWrappers) {
    try { fs.unlinkSync(p); } catch { /* already gone */ }
  }
  _generatedWrappers.length = 0;
}

/**
 * Fetches run IDs for a flow and prompts user to pick one if multiple exist.
 * Returns undefined if no runs exist or the user cancels.
 */
export async function pickRunForFlow(
  extensionPath: string,
  flowName: string
): Promise<string | undefined> {
  const scriptPath = path.join(extensionPath, 'python', 'get_data.py');
  const flowsData = await runPythonScript<Record<string, string[]>>(scriptPath, ['flows']);
  const runIds = flowsData[flowName] ?? [];
  if (runIds.length === 0) { return undefined; }
  if (runIds.length === 1) { return runIds[0]; }
  const picked = await vscode.window.showQuickPick(
    runIds.map(id => ({ label: `run ${id}`, id })),
    { placeHolder: `Select a run for ${flowName}` }
  );
  return picked?.id;
}

/**
 * Finds the Python file defining a given FlowSpec subclass.
 * Priority:
 *   1. Active editor (if it contains `class {flowName}(FlowSpec)`)
 *   2. Workspace glob — if exactly one match, return it
 *   3. Zero or multiple matches → open file picker
 * Returns undefined if the user cancels the picker.
 */
export async function resolveFlowFile(workspaceRoot: string, flowName: string): Promise<string | undefined> {
  const classPattern = new RegExp(`class\\s+${flowName}\\s*\\(\\s*FlowSpec\\s*\\)`);

  // 1. Active editor
  const activeEditor = vscode.window.activeTextEditor;
  if (activeEditor && activeEditor.document.languageId === 'python') {
    const src = activeEditor.document.getText();
    if (classPattern.test(src)) {
      return activeEditor.document.uri.fsPath;
    }
  }

  // 2. Search workspace (reads run in parallel to avoid blocking the event loop)
  const pyFiles = await vscode.workspace.findFiles(
    '**/*.py',
    '{**/node_modules/**,**/.metaflow/**}'
  );
  const results = await Promise.all(
    pyFiles.map(async (fileUri) => {
      try {
        const bytes = await vscode.workspace.fs.readFile(fileUri);
        const src = Buffer.from(bytes).toString('utf8');
        return classPattern.test(src) ? fileUri.fsPath : null;
      } catch {
        return null;
      }
    })
  );
  const matches = results.filter((p): p is string => p !== null);

  if (matches.length === 1) {
    return matches[0];
  }

  // 3. File picker (zero or multiple matches)
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'Python': ['py'] },
    title: `Select the Python file containing ${flowName}`,
    defaultUri: workspaceRoot ? vscode.Uri.file(workspaceRoot) : undefined,
  });
  return picked?.[0]?.fsPath;
}

/**
 * Returns tasks for a specific (flowName, runId, stepName) execution.
 * Throws on script error — no silent fallback.
 */
export async function getTasksForStep(
  extensionPath: string,
  flowName: string,
  runId: string,
  stepName: string
): Promise<TaskInfo[]> {
  const scriptPath = path.join(extensionPath, 'python', 'get_data.py');
  const pathspec = `${flowName}/${runId}/${stepName}`;
  return runPythonScript<TaskInfo[]>(scriptPath, ['tasks', pathspec]);
}

/**
 * Shows a quick pick for task selection.
 * Throws if the user cancels.
 */
export async function promptTaskSelection(tasks: TaskInfo[]): Promise<string> {
  const items = tasks.map(t => ({
    label: `task ${t.id}`,
    description: t.status,
    detail: t.duration != null ? `${t.duration}s` : 'still running',
    taskId: t.id,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select a task to debug',
    matchOnDescription: true,
  });

  if (!picked) {
    throw new Error('Task selection cancelled');
  }
  return picked.taskId;
}

/**
 * Generates a standalone debug wrapper script that loads the step's input artifacts
 * via the Metaflow Python API and calls the step function directly.
 *
 * This avoids Metaflow's `step` CLI, which requires orchestrator-managed state
 * (_graph_info) that is not propagated to intermediate task datastores.
 *
 * Returns the path to the generated temp file, or undefined on failure.
 */
export async function getDebugWrapperPath(
  extensionPath: string,
  flowFilePath: string,
  flowName: string,
  runId: string,
  stepName: string,
  taskId: string
): Promise<string | undefined> {
  const scriptPath = path.join(extensionPath, 'python', 'get_data.py');
  const pathspec = `${flowName}/${runId}/${stepName}/${taskId}`;
  try {
    const result = await runPythonScript<{ wrapper_path: string }>(
      scriptPath,
      ['gen_debug_wrapper', pathspec, flowFilePath]
    );
    _generatedWrappers.push(result.wrapper_path);
    return result.wrapper_path;
  } catch {
    return undefined;
  }
}

/**
 * Builds a debugpy config that runs the generated wrapper script.
 * The wrapper loads artifacts via the Metaflow Python API and calls the step directly.
 */
export function buildDebugConfigFromWrapper(
  wrapperPath: string,
  flowName: string,
  stepName: string,
  runId: string,
  taskId: string,
  pythonPath: string
): object {
  return {
    name: `Debug: ${flowName}/${runId}/${stepName}/${taskId}`,
    type: 'debugpy',
    request: 'launch',
    program: wrapperPath,
    args: [],
    justMyCode: false,
    console: 'integratedTerminal',
    python: pythonPath,
  };
}

/**
 * Pure function — builds a debugpy launch configuration using Metaflow's `step` CLI.
 * Kept for tests and as a fallback; primary path uses buildDebugConfigFromWrapper.
 * No I/O performed.
 */
export function buildDebugConfig(
  flowFilePath: string,
  flowName: string,
  stepName: string,
  runId: string,
  taskId: string,
  pythonPath: string,
  inputPaths: string[] = []
): object {
  const args = ['step', stepName, '--run-id', runId, '--task-id', taskId];
  for (const ip of inputPaths) {
    args.push('--input-paths', ip);
  }
  return {
    name: `Debug: ${flowName}/${runId}/${stepName}/${taskId}`,
    type: 'debugpy',
    request: 'launch',
    program: flowFilePath,
    args,
    justMyCode: false,
    console: 'integratedTerminal',
    python: pythonPath,
  };
}

/**
 * Core debug primitive — resolves all context and starts an ephemeral debug session.
 * Never writes to launch.json.
 */
export async function debugExecution(
  extensionPath: string,
  flowName: string,
  runId: string,
  stepName: string
): Promise<void> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder open. Open your project folder first.');
    return;
  }

  // 1 + 2. Resolve flow file and fetch tasks in parallel (independent operations)
  let flowFilePath: string | undefined;
  let tasks: TaskInfo[];
  try {
    [flowFilePath, tasks] = await Promise.all([
      resolveFlowFile(workspaceFolder.uri.fsPath, flowName),
      getTasksForStep(extensionPath, flowName, runId, stepName),
    ]);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(
      `Failed to get tasks for ${flowName}/${runId}/${stepName}: ${msg}`
    );
    return;
  }

  if (!flowFilePath) {
    vscode.window.showErrorMessage(`Could not locate flow file for ${flowName}.`);
    return;
  }

  if (tasks.length === 0) {
    vscode.window.showErrorMessage(
      `No tasks found for ${flowName}/${runId}/${stepName}. The step may not have run yet.`
    );
    return;
  }

  // 3. Select task
  let taskId: string;
  if (tasks.length === 1) {
    taskId = tasks[0].id;
  } else {
    try {
      taskId = await promptTaskSelection(tasks);
    } catch {
      return; // user cancelled
    }
  }

  // 4. Generate a debug wrapper script (avoids Metaflow's step CLI _graph_info issue)
  const wrapperPath = await getDebugWrapperPath(
    extensionPath, flowFilePath, flowName, runId, stepName, taskId
  );

  if (!wrapperPath) {
    vscode.window.showErrorMessage(
      `Failed to generate debug wrapper for ${flowName}/${runId}/${stepName}/${taskId}.`
    );
    return;
  }

  // 5. Build config and start ephemeral debug session
  const pythonPath = vscode.workspace.getConfiguration('metaflow').get<string>('pythonPath', 'python3');
  const config = buildDebugConfigFromWrapper(wrapperPath, flowName, stepName, runId, taskId, pythonPath);
  await vscode.debug.startDebugging(workspaceFolder, config as vscode.DebugConfiguration);
}

/**
 * Entry point for Ctrl+Alt+Shift+D from editor.
 * Detects flow name, run ID (with picker if multiple), and step from cursor.
 */
export async function debugStepFromEditor(extensionPath: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== 'python') {
    vscode.window.showErrorMessage('Open a Python file containing a Metaflow flow first.');
    return;
  }

  // 1. Extract flow name from file
  const flowName = extractFlowNameFromFile(editor.document.uri.fsPath);
  if (!flowName) {
    vscode.window.showErrorMessage('No FlowSpec subclass found in the current file.');
    return;
  }

  // 2. Get runs for this flow
  let runId: string;
  try {
    const selected = await pickRunForFlow(extensionPath, flowName);
    if (!selected) {
      vscode.window.showErrorMessage(`No runs found for ${flowName}. Run the flow first.`);
      return;
    }
    runId = selected;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to get runs for ${flowName}: ${msg}`);
    return;
  }

  // 3. Get step name from cursor position
  const stepName = findEnclosingDef(editor);
  if (!stepName) {
    vscode.window.showErrorMessage(
      'Cursor is not inside a step function. Move cursor inside a @step method.'
    );
    return;
  }

  // 4. Debug
  await debugExecution(extensionPath, flowName, runId, stepName);
}
