import * as vscode from 'vscode';
import { RunStatusData } from './runMonitor';

export class RunMonitorView implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;

  private readonly _onDispose = new vscode.EventEmitter<void>();
  readonly onDispose: vscode.Event<void> = this._onDispose.event;

  show(flowName: string, runId: string): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'metaflowRunMonitor',
      `Monitor: ${flowName}/${runId}`,
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.webview.html = getMonitorHtml(flowName, runId);

    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this._onDispose.fire();
    });
  }

  update(data: RunStatusData): void {
    this.panel?.webview.postMessage({ command: 'updateStatus', data });
  }

  dispose(): void {
    this.panel?.dispose();
    this._onDispose.dispose();
  }
}

function getMonitorHtml(flowName: string, runId: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Run Monitor</title>
  <style>
    body {
      margin: 0;
      padding: 16px;
      font-family: var(--vscode-font-family, sans-serif);
      color: var(--vscode-foreground, #ccc);
      background: var(--vscode-editor-background, #1e1e1e);
    }
    h2 { margin: 0 0 4px 0; font-size: 16px; }
    .badge {
      display: inline-block;
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: bold;
      margin-bottom: 12px;
    }
    .badge-running  { background: #2196f3; color: #fff; }
    .badge-completed { background: #4caf50; color: #fff; }
    .badge-failed   { background: #f44336; color: #fff; }
    .badge-pending  { background: #9e9e9e; color: #fff; }
    table {
      width: 100%;
      border-collapse: collapse;
    }
    th, td {
      text-align: left;
      padding: 6px 12px;
      border-bottom: 1px solid var(--vscode-panel-border, #333);
    }
    th { font-size: 12px; text-transform: uppercase; opacity: 0.7; }
    .status-done    { color: #4caf50; }
    .status-running { color: #2196f3; }
    .status-pending { color: #9e9e9e; }
    .status-failed  { color: #f44336; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
    .status-running .symbol { animation: pulse 1.5s ease-in-out infinite; }
  </style>
</head>
<body>
  <h2>Run ${flowName}/${runId}</h2>
  <div id="overall-badge" class="badge badge-pending">Pending</div>
  <table>
    <thead><tr><th>Step</th><th>Status</th></tr></thead>
    <tbody id="steps-body"></tbody>
  </table>
  <script>
    const symbols = { done: '\\u2713', running: '\\u25CF', pending: '\\u25CB', failed: '\\u2717' };
    const labels = { done: 'Done', running: 'Running', pending: 'Pending', failed: 'Failed' };
    const prevState = new Map();
    const tbody = document.getElementById('steps-body');
    const badge = document.getElementById('overall-badge');

    function updateOverall(data) {
      if (data.finished && data.successful) {
        badge.className = 'badge badge-completed';
        badge.textContent = 'Completed';
      } else if (data.finished && !data.successful) {
        badge.className = 'badge badge-failed';
        badge.textContent = 'Failed';
      } else if (data.steps.some(s => s.status === 'running')) {
        badge.className = 'badge badge-running';
        badge.textContent = 'Running';
      } else {
        badge.className = 'badge badge-pending';
        badge.textContent = 'Pending';
      }
    }

    function updateSteps(steps) {
      for (const step of steps) {
        const prev = prevState.get(step.name);
        if (prev === step.status) continue;
        prevState.set(step.name, step.status);

        let row = document.getElementById('step-' + step.name);
        if (!row) {
          row = document.createElement('tr');
          row.id = 'step-' + step.name;
          row.innerHTML = '<td class="step-name"></td><td class="step-status"></td>';
          row.querySelector('.step-name').textContent = step.name;
          tbody.appendChild(row);
        }
        const cell = row.querySelector('.step-status');
        cell.className = 'step-status status-' + step.status;
        cell.innerHTML = '<span class="symbol">' + (symbols[step.status] || '?') + '</span> ' + (labels[step.status] || step.status);
      }
    }

    window.addEventListener('message', function(event) {
      const msg = event.data;
      if (msg.command === 'updateStatus') {
        updateOverall(msg.data);
        updateSteps(msg.data.steps);
      }
    });
  </script>
</body>
</html>`;
}
