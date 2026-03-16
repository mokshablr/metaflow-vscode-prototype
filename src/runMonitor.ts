import * as vscode from 'vscode';
import * as path from 'path';
import { runPythonScript } from './pythonRunner';

export type StepStatus = 'done' | 'running' | 'pending' | 'failed';
export type MonitorStopReason = 'completed' | 'failed' | 'error' | 'panel_closed' | 'disposed' | 'stopped';

export interface StepStatusInfo {
  name: string;
  status: StepStatus;
}

export interface RunStatusData {
  flow: string;
  run_id: string;
  finished: boolean;
  successful: boolean | null;
  steps: StepStatusInfo[];
}

const FAST_INTERVAL = 2000;
const SLOW_INTERVAL = 5000;
const MAX_CONSECUTIVE_ERRORS = 5;

interface DagShape {
  nodes: { id: string }[];
  edges: { from: string; to: string }[];
}

function bfsStepOrder(nodes: { id: string }[], edges: { from: string; to: string }[]): string[] {
  const outMap = new Map<string, string[]>();
  for (const n of nodes) { outMap.set(n.id, []); }
  for (const e of edges) { outMap.get(e.from)?.push(e.to); }

  const visited = new Set<string>();
  const order: string[] = [];
  const startNode = outMap.has('start') ? 'start' : (nodes[0]?.id ?? '');
  const queue = startNode ? [startNode] : [];

  while (queue.length) {
    const name = queue.shift()!;
    if (visited.has(name)) { continue; }
    visited.add(name);
    order.push(name);
    for (const next of outMap.get(name) ?? []) {
      if (!visited.has(next)) { queue.push(next); }
    }
  }

  for (const n of nodes) {
    if (!visited.has(n.id)) { order.push(n.id); }
  }
  return order;
}

export class RunMonitor implements vscode.Disposable {
  private readonly _onStatusUpdate = new vscode.EventEmitter<RunStatusData>();
  readonly onStatusUpdate: vscode.Event<RunStatusData> = this._onStatusUpdate.event;

  private readonly _onMonitorStopped = new vscode.EventEmitter<MonitorStopReason>();
  readonly onMonitorStopped: vscode.Event<MonitorStopReason> = this._onMonitorStopped.event;

  private timer: ReturnType<typeof setTimeout> | undefined;
  private consecutiveErrors = 0;
  private stopped = false;
  private currentInterval = FAST_INTERVAL;
  private lastDataHash = '';

  // Cached once at start — DAG topology doesn't change during a run
  private stepOrder: string[] = [];
  private dagStepNames = new Set<string>();

  constructor(
    private readonly extensionPath: string,
    private readonly flowName: string,
    private readonly runId: string,
    private readonly flowFilePath?: string
  ) {}

  async start(): Promise<void> {
    this.stopped = false;

    // Compute topo order + pending-detection set once; amortises over all polls
    if (this.flowFilePath) {
      try {
        const dagScript = path.join(this.extensionPath, 'python', 'get_dag.py');
        const dag = await runPythonScript<DagShape>(dagScript, [this.flowFilePath], { timeoutMs: 10000 });
        this.stepOrder = bfsStepOrder(dag.nodes, dag.edges);
        this.dagStepNames = new Set(dag.nodes.map(n => n.id));
      } catch { /* no flowFilePath or parse error — use run order, skip pending */ }
    }

    await this.poll();
    this.scheduleNext();
  }

  stop(reason: MonitorStopReason = 'stopped'): void {
    if (this.stopped) { return; }
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this._onMonitorStopped.fire(reason);
  }

  dispose(): void {
    this.stop('disposed');
    this._onStatusUpdate.dispose();
    this._onMonitorStopped.dispose();
  }

  // setTimeout chain: next poll waits for current to finish → no concurrent polls,
  // no setInterval race when currentInterval changes mid-flight.
  private scheduleNext(): void {
    if (this.stopped) { return; }
    this.timer = setTimeout(async () => {
      await this.poll();
      this.scheduleNext();
    }, this.currentInterval);
  }

  private applyOrderAndPending(runSteps: Map<string, StepStatus>): StepStatusInfo[] {
    if (this.stepOrder.length > 0) {
      const seen = new Set<string>();
      const result: StepStatusInfo[] = [];
      for (const name of this.stepOrder) {
        seen.add(name);
        result.push({ name, status: runSteps.get(name) ?? 'pending' });
      }
      // Any run steps not in the DAG (shouldn't happen, but be safe)
      for (const [name, status] of runSteps) {
        if (!seen.has(name)) { result.push({ name, status }); }
      }
      return result;
    }
    // No DAG info — use run order as returned by Python
    return [...runSteps.entries()].map(([name, status]) => ({ name, status }));
  }

  private async poll(): Promise<void> {
    if (this.stopped) { return; }

    const scriptPath = path.join(this.extensionPath, 'python', 'get_run_status.py');

    try {
      // Python script only handles run queries — ordering and pending detection done here
      const raw = await runPythonScript<RunStatusData>(scriptPath, [this.flowName, this.runId], { timeoutMs: 10000 });
      if (this.stopped) { return; }

      this.consecutiveErrors = 0;

      // Merge run steps with DAG-pending steps, then apply cached topo order
      const runSteps = new Map(raw.steps.map(s => [s.name, s.status as StepStatus]));
      for (const name of this.dagStepNames) {
        if (!runSteps.has(name)) { runSteps.set(name, 'pending'); }
      }
      const data: RunStatusData = { ...raw, steps: this.applyOrderAndPending(runSteps) };

      // Only notify listeners when something actually changed
      const hash = JSON.stringify(data.steps) + String(data.finished);
      if (hash !== this.lastDataHash) {
        this.lastDataHash = hash;
        this._onStatusUpdate.fire(data);
      }

      this.currentInterval = data.steps.some(s => s.status === 'running') ? FAST_INTERVAL : SLOW_INTERVAL;

      if (data.finished) {
        this.stop(data.successful ? 'completed' : 'failed');
      }
    } catch {
      if (this.stopped) { return; }
      if (++this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        this.stop('error');
      }
    }
  }
}
