import * as vscode from 'vscode';
import { runPythonCommand, onRunStarted, disposeRunner, extractFlowNameFromFile } from './runner';
import { ArtifactNode, CTX, RunNode, StepNode, MetaflowTreeProvider } from './metaflowTreeProvider';
import { showDag, updateDagRunStatus } from './dagView';
import { RunMonitor, RunStatusData, MonitorStopReason } from './runMonitor';
import { RunMonitorView } from './runMonitorView';
import { debugExecution, debugStepFromEditor, resolveFlowFile, pickRunForFlow, cleanupDebugWrappers } from './debugConfig';

const activeMonitors = new Map<string, { monitor: RunMonitor; view: RunMonitorView }>();

function startMonitoring(
  extensionPath: string,
  flowName: string,
  runId: string,
  flowFilePath?: string
): void {
  const key = `${flowName}/${runId}`;

  const existing = activeMonitors.get(key);
  if (existing) {
    existing.view.show(flowName, runId);
    return;
  }

  const monitor = new RunMonitor(extensionPath, flowName, runId, flowFilePath);
  const view = new RunMonitorView();

  monitor.onStatusUpdate((data: RunStatusData) => {
    view.update(data);
    updateDagRunStatus(data.steps);
  });

  monitor.onMonitorStopped((reason: MonitorStopReason) => {
    activeMonitors.delete(key);
    if (reason === 'completed') {
      vscode.window.showInformationMessage(`Run ${key} completed successfully.`);
    } else if (reason === 'failed') {
      vscode.window.showWarningMessage(`Run ${key} failed.`);
    } else if (reason === 'error') {
      vscode.window.showWarningMessage(`Monitor for ${key} stopped due to repeated errors.`);
    }
  });

  view.onDispose(() => {
    monitor.stop('panel_closed');
    activeMonitors.delete(key);
  });

  activeMonitors.set(key, { monitor, view });
  view.show(flowName, runId);
  monitor.start();
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new MetaflowTreeProvider(context.extensionPath);
  const treeView = vscode.window.createTreeView('metaflowExplorer', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  context.subscriptions.push(
    treeView,
    vscode.commands.registerCommand('metaflow.runFlow', () => runPythonCommand('run')),
    vscode.commands.registerCommand('metaflow.spinStep', () => runPythonCommand('spin')),
    vscode.commands.registerCommand('metaflow.refreshExplorer', () => provider.refresh()),
    vscode.commands.registerCommand('metaflow.cycleSortArtifacts', () => provider.cycleSortMode()),
    vscode.commands.registerCommand('metaflow.filterRuns', async () => {
      const choice = await vscode.window.showQuickPick(
        [
          { label: '$(list-unordered) All Runs', value: 'all' as const },
          { label: '$(pass) Successful Runs', value: 'successful' as const },
          { label: '$(error) Failed Runs', value: 'failed' as const },
        ],
        { placeHolder: 'Filter runs by status' }
      );
      if (choice) { provider.setRunFilter(choice.value); }
    }),
    vscode.commands.registerCommand('metaflow.copyArtifactValue', (node: unknown) => {
      if (!(node instanceof ArtifactNode)) {
        vscode.window.showErrorMessage('Select an artifact first.');
        return;
      }
      vscode.env.clipboard.writeText(node.info.raw);
      vscode.window.showInformationMessage(`Copied value of '${node.artifactName}'`);
    }),
    vscode.commands.registerCommand('metaflow.exportArtifactJson', async (node: unknown) => {
      if (!(node instanceof ArtifactNode)) {
        vscode.window.showErrorMessage('Select an artifact first.');
        return;
      }
      const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`${node.artifactName}.json`),
        filters: { 'JSON': ['json'] },
      });
      if (uri) {
        const payload = JSON.stringify(
          { name: node.artifactName, type: node.info.type, value: node.info.raw },
          null, 2
        );
        await vscode.workspace.fs.writeFile(uri, Buffer.from(payload, 'utf8'));
        vscode.window.showInformationMessage(`Exported to ${uri.fsPath}`);
      }
    }),
    vscode.commands.registerCommand('metaflow.deleteRun', async (node: unknown) => {
      if (!node || (node as vscode.TreeItem).contextValue !== CTX.RUN) {
        vscode.window.showErrorMessage('Select a run first.');
        return;
      }
      const runNode = node as RunNode;
      const { flowName, runId } = runNode;

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open. Open your project folder first.');
        return;
      }
      const metaflowDir = vscode.Uri.joinPath(vscode.Uri.file(workspaceFolder), '.metaflow');
      try {
        await vscode.workspace.fs.stat(metaflowDir);
      } catch {
        vscode.window.showErrorMessage(
          'Deletion is only supported for the local metadata provider (.metaflow directory not found).'
        );
        return;
      }

      const confirm = await vscode.window.showWarningMessage(
        `Delete run "${flowName}/${runId}"? This will permanently remove the run and all its artifacts.`,
        { modal: true },
        'Delete'
      );
      if (confirm !== 'Delete') { return; }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Deleting run ${flowName}/${runId}…`,
          cancellable: false,
        },
        async () => {
          try {
            await provider.deleteRun(flowName, runId);
            provider.refresh();
            vscode.window.showInformationMessage(`Run "${flowName}/${runId}" deleted.`);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Failed to delete run "${flowName}/${runId}": ${msg}`);
          }
        }
      );
    }),
    vscode.commands.registerCommand('metaflow.showDAG', async (uri?: vscode.Uri) => {
      const filePath = uri?.fsPath
        ?? (vscode.window.activeTextEditor?.document.languageId === 'python'
          ? vscode.window.activeTextEditor.document.uri.fsPath : undefined);
      if (!filePath?.endsWith('.py')) {
        vscode.window.showErrorMessage('Open a Python file containing a Metaflow flow first.');
        return;
      }

      const flowName = extractFlowNameFromFile(filePath);
      if (!flowName) {
        vscode.window.showErrorMessage('No FlowSpec subclass found in this file.');
        return;
      }

      let selectedRunId: string | undefined;
      try {
        selectedRunId = await pickRunForFlow(context.extensionPath, flowName);
        // undefined means 0 runs — show DAG without run context
      } catch {
        // No runs available — show DAG without run context
      }

      showDag(context.extensionPath, filePath, flowName, selectedRunId);
    }),
    vscode.commands.registerCommand('metaflow.debugStep', async (node?: unknown) => {
      if (!(node instanceof StepNode)) {
        vscode.window.showErrorMessage('Right-click a step in the Metaflow Explorer to debug it.');
        return;
      }
      const [flowName, runId, stepName] = node.pathspec.split('/');
      await debugExecution(context.extensionPath, flowName, runId, stepName);
    }),
    vscode.commands.registerCommand(
      'metaflow.debugStepDirect',
      async (flowName: string, runId: string, stepName: string) => {
        await debugExecution(context.extensionPath, flowName, runId, stepName);
      }
    ),
    vscode.commands.registerCommand('metaflow.debugStepFromEditor', async () => {
      await debugStepFromEditor(context.extensionPath);
    }),
    vscode.commands.registerCommand('metaflow.showRunDAG', async (node?: unknown) => {
      if (!(node instanceof RunNode)) { return; }
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) { return; }
      const flowFile = await resolveFlowFile(workspaceRoot, node.flowName);
      if (!flowFile) { return; }
      showDag(context.extensionPath, flowFile, node.flowName, node.runId);
    }),
    vscode.commands.registerCommand('metaflow.monitorRun', async () => {
      const flowName = await vscode.window.showInputBox({
        prompt: 'Enter the flow name',
        placeHolder: 'e.g., MyFlow',
      });
      if (!flowName) { return; }

      const runId = await vscode.window.showInputBox({
        prompt: 'Enter the run ID',
        placeHolder: 'e.g., 1840392213',
      });
      if (!runId) { return; }

      startMonitoring(context.extensionPath, flowName, runId);
    }),
  );

  // Auto-monitor when a run starts
  context.subscriptions.push(
    onRunStarted(async (info) => {
      let flowName = info.flowName;
      if (!flowName) {
        flowName = await vscode.window.showInputBox({
          prompt: 'Could not detect flow name from output. Enter the flow class name:',
          placeHolder: 'e.g., LinearFlow',
        });
        if (!flowName) { return; }
      }
      startMonitoring(context.extensionPath, flowName, info.runId, info.flowFilePath);
    })
  );
}

export function deactivate() {
  for (const { monitor, view } of activeMonitors.values()) {
    monitor.dispose();
    view.dispose();
  }
  activeMonitors.clear();
  disposeRunner();
  cleanupDebugWrappers();
}
