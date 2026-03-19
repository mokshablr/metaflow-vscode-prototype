import * as vscode from 'vscode';
import * as path from 'path';
import { runPythonScript } from './pythonRunner';

export const CTX = { FLOW: 'flow', RUN: 'run', STEP: 'step', TASK: 'task', ARTIFACT: 'artifact', ERROR: 'error' } as const;

export type SortMode = 'default' | 'name' | 'type';
export type RunFilter = 'all' | 'successful' | 'failed';

export const VALID_STATUSES = ['done', 'failed', 'running', 'unknown'] as const;
export type NodeStatus = typeof VALID_STATUSES[number];

export interface ArtifactInfo { type: string; preview: string; raw: string; }
export interface StepInfo { name: string; status: NodeStatus; }
export interface TaskInfo { id: string; status: NodeStatus; duration?: number | null; }

export function sortArtifactEntries(
  entries: [string, ArtifactInfo][],
  mode: SortMode
): [string, ArtifactInfo][] {
  if (mode === 'name') {
    return [...entries].sort(([a], [b]) => a.localeCompare(b));
  } else if (mode === 'type') {
    return [...entries].sort(([, a], [, b]) => a.type.localeCompare(b.type));
  }
  return entries;
}

class FlowNode extends vscode.TreeItem {
  constructor(public readonly flowName: string, public readonly runIds: string[]) {
    super(flowName, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = CTX.FLOW;
  }
}

export class RunNode extends vscode.TreeItem {
  constructor(
    public readonly flowName: string,
    public readonly runId: string
  ) {
    super(runId, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = CTX.RUN;
  }
}

function applyStatusIcon(item: vscode.TreeItem, status: string): void {
  if (status === 'failed') {
    item.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
    item.description = 'failed';
  } else if (status === 'running') {
    item.iconPath = new vscode.ThemeIcon('loading~spin');
  }
}

export class StepNode extends vscode.TreeItem {
  constructor(public readonly pathspec: string, info: StepInfo) {
    super(info.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = CTX.STEP;
    applyStatusIcon(this, info.status);
  }
}

export class TaskNode extends vscode.TreeItem {
  constructor(public readonly pathspec: string, info: TaskInfo) {
    super(info.id, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = CTX.TASK;
    applyStatusIcon(this, info.status);
  }
}

export class ArtifactNode extends vscode.TreeItem {
  constructor(public readonly artifactName: string, public readonly info: ArtifactInfo) {
    super(`${artifactName} = ${info.preview}`, vscode.TreeItemCollapsibleState.None);
    this.description = info.type;
    this.tooltip = new vscode.MarkdownString(`**${artifactName}** *(${info.type})*\n\n${info.preview}`);
    this.contextValue = CTX.ARTIFACT;
  }
}

class ErrorNode extends vscode.TreeItem {
  constructor(message: string) {
    super(message, vscode.TreeItemCollapsibleState.None);
    this.contextValue = CTX.ERROR;
    this.iconPath = new vscode.ThemeIcon('warning');
  }
}

export class MetaflowTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _loadingPromise: Promise<(FlowNode | ErrorNode)[]> | null = null;
  private _childCache = new Map<string, Promise<vscode.TreeItem[]>>();
  private _artifactCache = new Map<string, Promise<vscode.TreeItem[]>>();
  private readonly scriptPath: string;
  private readonly deleteScriptPath: string;
  private _sortMode: SortMode = 'default';
  private _runFilter: RunFilter = 'all';

  constructor(extensionPath: string) {
    this.scriptPath = path.join(extensionPath, 'python', 'get_data.py');
    this.deleteScriptPath = path.join(extensionPath, 'python', 'delete_run.py');
  }

  refresh(): void {
    this._loadingPromise = null;
    this._childCache.clear();
    this._artifactCache.clear();
    this._onDidChangeTreeData.fire();
  }

  cycleSortMode(): void {
    const cycle: SortMode[] = ['default', 'name', 'type'];
    const idx = cycle.indexOf(this._sortMode);
    this._sortMode = cycle[(idx + 1) % cycle.length];
    this._artifactCache.clear();
    this._onDidChangeTreeData.fire();
    vscode.window.showInformationMessage(`Artifact sort: ${this._sortMode}`);
  }

  getSortMode(): SortMode { return this._sortMode; }
  getRunFilter(): RunFilter { return this._runFilter; }

  setRunFilter(filter: RunFilter): void {
    if (this._runFilter !== filter) {
      this._runFilter = filter;
      this.refresh();
    }
  }

  deleteRun(flowName: string, runId: string): Promise<void> {
    return runPythonScript(this.deleteScriptPath, [flowName, runId]).then(() => undefined);
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem { return element; }

  getChildren(element?: vscode.TreeItem): vscode.ProviderResult<vscode.TreeItem[]> {
    if (!element) {
      if (!this._loadingPromise) { this._loadingPromise = this.loadFlows(); }
      return this._loadingPromise;
    }
    if (element instanceof FlowNode) {
      return element.runIds.map(id => new RunNode(element.flowName, id));
    }
    if (element instanceof RunNode) {
      const runPathspec = `${element.flowName}/${element.runId}`;
      return this.cached(runPathspec, () => this.loadSteps(runPathspec));
    }
    if (element instanceof StepNode) {
      return this.cached(element.pathspec, () => this.loadTasks(element.pathspec));
    }
    if (element instanceof TaskNode) {
      if (!this._artifactCache.has(element.pathspec)) {
        this._artifactCache.set(element.pathspec, this.loadArtifacts(element.pathspec));
      }
      return this._artifactCache.get(element.pathspec)!;
    }
    return [];
  }

  private cached(key: string, fn: () => Promise<vscode.TreeItem[]>): Promise<vscode.TreeItem[]> {
    if (!this._childCache.has(key)) { this._childCache.set(key, fn()); }
    return this._childCache.get(key)!;
  }

  private loadFlows(): Promise<(FlowNode | ErrorNode)[]> {
    return runPythonScript(this.scriptPath, ['flows', this._runFilter]).then(parsed => {
      const nodes = Object.entries(parsed as Record<string, string[]>).map(
        ([flowName, runIds]) => new FlowNode(flowName, runIds)
      );
      return nodes.length > 0 ? nodes : [new ErrorNode('No flows found')];
    }).catch(err => [new ErrorNode(`Failed to load flows: ${err.message}`)]);
  }

  private loadSteps(runPathspec: string): Promise<vscode.TreeItem[]> {
    return runPythonScript(this.scriptPath, ['steps', runPathspec]).then(parsed => {
      const steps = parsed as StepInfo[];
      if (steps.length === 0) { return [new ErrorNode('No steps found')]; }
      return steps.map(info => new StepNode(`${runPathspec}/${info.name}`, info));
    }).catch(err => [new ErrorNode(`Failed to load steps: ${err.message}`)]);
  }

  private loadTasks(stepPathspec: string): Promise<vscode.TreeItem[]> {
    return runPythonScript(this.scriptPath, ['tasks', stepPathspec]).then(parsed => {
      const tasks = parsed as TaskInfo[];
      if (tasks.length === 0) { return [new ErrorNode('No tasks found')]; }
      return tasks.map(info => new TaskNode(`${stepPathspec}/${info.id}`, info));
    }).catch(err => [new ErrorNode(`Failed to load tasks: ${err.message}`)]);
  }

  private loadArtifacts(taskPathspec: string): Promise<vscode.TreeItem[]> {
    return runPythonScript(this.scriptPath, ['artifacts', taskPathspec]).then(parsed => {
      let entries = Object.entries(parsed as Record<string, ArtifactInfo>);
      if (entries.length === 0) { return [new ErrorNode('No artifacts found')]; }
      entries = sortArtifactEntries(entries, this._sortMode);
      return entries.map(([name, info]) => new ArtifactNode(name, info));
    }).catch(err => [new ErrorNode(`Failed to load artifacts: ${err.message}`)]);
  }
}
