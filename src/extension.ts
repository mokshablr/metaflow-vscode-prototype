import * as vscode from 'vscode';
import { runPythonCommand } from './runner';
import { ArtifactNode, CTX, RunNode, MetaflowTreeProvider } from './metaflowTreeProvider';
import { showDag } from './dagView';

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
    vscode.commands.registerCommand('metaflow.showDAG', (uri?: vscode.Uri) => {
      const filePath = uri?.fsPath
        ?? (vscode.window.activeTextEditor?.document.languageId === 'python'
          ? vscode.window.activeTextEditor.document.uri.fsPath : undefined);
      if (!filePath?.endsWith('.py')) {
        vscode.window.showErrorMessage('Open a Python file containing a Metaflow flow first.');
        return;
      }
      showDag(context.extensionPath, filePath);
    }),
  );
}

export function deactivate() {}
