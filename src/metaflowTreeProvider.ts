import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

const CTX = { FLOW: 'flow', RUN: 'run', ERROR: 'error' } as const;

class FlowNode extends vscode.TreeItem {
  constructor(public readonly runs: string[], flowName: string) {
    super(flowName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = CTX.FLOW;
  }
}

class RunNode extends vscode.TreeItem {
  constructor(runId: string) {
    super(runId, vscode.TreeItemCollapsibleState.None);
    this.contextValue = CTX.RUN;
  }
}

class ErrorNode extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.contextValue = CTX.ERROR;
  }
}

export class MetaflowTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _loadingPromise: Promise<(FlowNode | ErrorNode)[]> | null = null;
  private readonly scriptPath: string;

  constructor(extensionPath: string) {
    this.scriptPath = path.join(extensionPath, 'python', 'get_flows_and_runs.py');
  }

  refresh(): void {
    this._loadingPromise = null;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    if (!element) {
      if (!this._loadingPromise) {
        this._loadingPromise = this.loadFlows();
      }
      return this._loadingPromise;
    }
    if (element instanceof FlowNode) {
      return element.runs.map(r => new RunNode(r));
    }
    return [];
  }

  private loadFlows(): Promise<(FlowNode | ErrorNode)[]> {
    return new Promise(resolve => {
      const pythonPath = vscode.workspace.getConfiguration('metaflow').get<string>('pythonPath', 'python3');

      let child: ReturnType<typeof spawn>;
      try {
        const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
        child = spawn(pythonPath, [this.scriptPath], { cwd });
      } catch (err) {
        resolve([new ErrorNode(`Failed to spawn python3: ${err}`)]);
        return;
      }

      if (!child.stdout) {
        resolve([new ErrorNode('No stdout from python3 process')]);
        return;
      }

      const outChunks: string[] = [];
      const errChunks: string[] = [];

      child.stdout.on('data', (chunk: Buffer) => outChunks.push(chunk.toString()));
      child.stderr?.on('data', (chunk: Buffer) => errChunks.push(chunk.toString()));

      child.on('close', (code: number | null) => {
        const stdout = outChunks.join('');
        const stderr = errChunks.join('');
        try {
          const parsed = JSON.parse(stdout);
          if (parsed.error) {
            resolve([new ErrorNode(parsed.error)]);
            return;
          }
          const nodes = Object.entries(parsed as Record<string, string[]>).map(
            ([flowName, runs]) => new FlowNode(runs, flowName)
          );
          resolve(nodes.length > 0 ? nodes : [new ErrorNode('No flows found')]);
        } catch {
          const detail = stderr || `exit code ${code}`;
          resolve([new ErrorNode(`Failed to read flows: ${detail}`)]);
        }
      });

      child.on('error', (err: Error) => {
        resolve([new ErrorNode(`Spawn error: ${err.message}`)]);
      });
    });
  }
}
