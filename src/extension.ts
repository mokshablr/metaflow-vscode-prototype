import * as vscode from 'vscode';
import { runPythonCommand } from './runner';
import { ArtifactNode, MetaflowTreeProvider } from './metaflowTreeProvider';

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
  );
}

export function deactivate() {}
