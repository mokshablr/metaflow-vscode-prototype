import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

const CTX = { FLOW: 'flow', RUN: 'run', STEP: 'step', TASK: 'task', ARTIFACT: 'artifact', ERROR: 'error' } as const;

class FlowNode extends vscode.TreeItem {
  constructor(public readonly flowName: string, public readonly runIds: string[]) {
    super(flowName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = CTX.FLOW;
  }
}

class RunNode extends vscode.TreeItem {
  constructor(public readonly pathspec: string, runId: string) {
    super(runId, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = CTX.RUN;
  }
}

class StepNode extends vscode.TreeItem {
  constructor(public readonly pathspec: string, stepName: string) {
    super(stepName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = CTX.STEP;
  }
}

class TaskNode extends vscode.TreeItem {
  constructor(public readonly pathspec: string, taskId: string) {
    super(taskId, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = CTX.TASK;
  }
}

class ArtifactNode extends vscode.TreeItem {
  constructor(name: string, value: string) {
    super(`${name} = ${value}`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = CTX.ARTIFACT;
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
  private _childCache = new Map<string, Promise<vscode.TreeItem[]>>();
  private readonly scriptPath: string;

  constructor(extensionPath: string) {
    this.scriptPath = path.join(extensionPath, 'python', 'get_data.py');
  }

  refresh(): void {
    this._loadingPromise = null;
    this._childCache.clear();
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
      return element.runIds.map(id => new RunNode(`${element.flowName}/${id}`, id));
    }
    if (element instanceof RunNode) {
      return this.cached(element.pathspec, () => this.loadSteps(element.pathspec));
    }
    if (element instanceof StepNode) {
      return this.cached(element.pathspec, () => this.loadTasks(element.pathspec));
    }
    if (element instanceof TaskNode) {
      return this.cached(element.pathspec, () => this.loadArtifacts(element.pathspec));
    }
    return [];
  }

  private cached(key: string, fn: () => Promise<vscode.TreeItem[]>): Promise<vscode.TreeItem[]> {
    if (!this._childCache.has(key)) {
      this._childCache.set(key, fn());
    }
    return this._childCache.get(key)!;
  }

  private runScript(...args: string[]): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const pythonPath = vscode.workspace.getConfiguration('metaflow').get<string>('pythonPath', 'python3');
      const cwd = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? os.homedir();
      const child = spawn(pythonPath, [this.scriptPath, ...args], { cwd });
      const out: string[] = [], err: string[] = [];
      child.stdout?.on('data', (c: Buffer) => out.push(c.toString()));
      child.stderr?.on('data', (c: Buffer) => err.push(c.toString()));
      child.on('close', (code) => {
        try {
          const parsed = JSON.parse(out.join(''));
          if (parsed && typeof parsed === 'object' && 'error' in parsed) {
            reject(new Error(parsed.error));
          } else {
            resolve(parsed);
          }
        } catch {
          reject(new Error(err.join('') || `exit code ${code}`));
        }
      });
      child.on('error', reject);
    });
  }

  private loadFlows(): Promise<(FlowNode | ErrorNode)[]> {
    return this.runScript('flows').then(parsed => {
      const nodes = Object.entries(parsed as Record<string, string[]>).map(
        ([flowName, runIds]) => new FlowNode(flowName, runIds)
      );
      return nodes.length > 0 ? nodes : [new ErrorNode('No flows found')];
    }).catch(err => [new ErrorNode(`Failed to load flows: ${err.message}`)]);
  }

  private loadSteps(runPathspec: string): Promise<vscode.TreeItem[]> {
    return this.runScript('steps', runPathspec).then(parsed => {
      const stepNames = parsed as string[];
      if (stepNames.length === 0) { return [new ErrorNode('No steps found')]; }
      return stepNames.map(name => new StepNode(`${runPathspec}/${name}`, name));
    }).catch(err => [new ErrorNode(`Failed to load steps: ${err.message}`)]);
  }

  private loadTasks(stepPathspec: string): Promise<vscode.TreeItem[]> {
    return this.runScript('tasks', stepPathspec).then(parsed => {
      const taskIds = parsed as string[];
      if (taskIds.length === 0) { return [new ErrorNode('No tasks found')]; }
      return taskIds.map(id => new TaskNode(`${stepPathspec}/${id}`, id));
    }).catch(err => [new ErrorNode(`Failed to load tasks: ${err.message}`)]);
  }

  private loadArtifacts(taskPathspec: string): Promise<vscode.TreeItem[]> {
    return this.runScript('artifacts', taskPathspec).then(parsed => {
      const artifacts = parsed as Record<string, string>;
      const entries = Object.entries(artifacts);
      if (entries.length === 0) { return [new ErrorNode('No artifacts found')]; }
      return entries.map(([name, value]) => new ArtifactNode(name, value));
    }).catch(err => [new ErrorNode(`Failed to load artifacts: ${err.message}`)]);
  }
}
