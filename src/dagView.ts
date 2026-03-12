import * as vscode from 'vscode';
import * as path from 'path';
import { runPythonScript } from './pythonRunner';

let currentPanel: vscode.WebviewPanel | undefined;
let currentFlowFile: string | undefined;
let saveListener: vscode.Disposable | undefined;
let refreshTimer: ReturnType<typeof setTimeout> | undefined;

interface DagNode {
  id: string;
  type: string;
  line: number | null;
}

interface DagData {
  nodes: DagNode[];
  edges: { from: string; to: string }[];
}

function runDagScript(extensionPath: string, flowFilePath: string): Promise<DagData> {
  const scriptPath = path.join(extensionPath, 'python', 'get_dag.py');
  return runPythonScript<DagData>(scriptPath, [flowFilePath], { timeoutMs: 10000 });
}

async function refreshDag(extensionPath: string, flowFilePath: string): Promise<void> {
  if (!currentPanel) { return; }
  try {
    const data = await runDagScript(extensionPath, flowFilePath);
    currentPanel.webview.postMessage({ command: 'updateDag', data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`DAG refresh failed: ${msg}`);
  }
}

function navigateToStep(flowFilePath: string, line: number): void {
  const uri = vscode.Uri.file(flowFilePath);
  vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One }).then(editor => {
    const zeroLine = line - 1;
    const range = new vscode.Range(zeroLine, 0, zeroLine, 0);
    editor.selection = new vscode.Selection(range.start, range.start);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
  }, () => {
    vscode.window.showErrorMessage(`Could not open ${flowFilePath}`);
  });
}

function getWebviewContent(data: DagData): string {
  const nodesJson = JSON.stringify(data.nodes);
  const edgesJson = JSON.stringify(data.edges);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; script-src https://unpkg.com 'unsafe-inline'; style-src 'unsafe-inline';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Metaflow DAG</title>
  <style>
    body { margin: 0; padding: 0; overflow: hidden; background: var(--vscode-editor-background, #1e1e1e); }
    #cy { width: 100vw; height: 100vh; }
    #loading {
      position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
      color: var(--vscode-foreground, #ccc); font-family: var(--vscode-font-family, sans-serif);
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div id="loading">Loading DAG...</div>
  <div id="cy"></div>
  <script src="https://unpkg.com/cytoscape@3/dist/cytoscape.min.js"></script>
  <script src="https://unpkg.com/dagre@0.8/dist/dagre.min.js"></script>
  <script src="https://unpkg.com/cytoscape-dagre@2/cytoscape-dagre.js"></script>
  <script>
    const vscode = acquireVsCodeApi();

    const typeColors = {
      start:   '#4caf50',
      end:     '#f44336',
      split:   '#ff9800',
      join:    '#2196f3',
      foreach: '#9c27b0',
      linear:  '#9e9e9e'
    };

    let cy = null;

    function buildGraph(nodes, edges) {
      document.getElementById('loading').style.display = 'none';

      if (cy) { cy.destroy(); }

      const elements = [];
      for (const n of nodes) {
        elements.push({
          data: { id: n.id, label: n.id, type: n.type, line: n.line },
        });
      }
      for (const e of edges) {
        elements.push({
          data: { source: e.from, target: e.to },
        });
      }

      cy = cytoscape({
        container: document.getElementById('cy'),
        elements: elements,
        style: [
          {
            selector: 'node',
            style: {
              'label': 'data(label)',
              'text-valign': 'center',
              'text-halign': 'center',
              'background-color': function(ele) { return typeColors[ele.data('type')] || '#9e9e9e'; },
              'color': '#fff',
              'font-size': '12px',
              'font-weight': 'bold',
              'width': 'label',
              'height': 30,
              'padding': '12px',
              'shape': 'round-rectangle',
              'text-wrap': 'none',
              'border-width': 0,
              'cursor': 'pointer',
            }
          },
          {
            selector: 'edge',
            style: {
              'width': 2,
              'line-color': '#666',
              'target-arrow-color': '#666',
              'target-arrow-shape': 'triangle',
              'curve-style': 'bezier',
              'arrow-scale': 1.2,
            }
          },
          {
            selector: 'node.hover',
            style: {
              'border-width': 3,
              'border-color': '#fff',
            }
          },
          {
            selector: 'edge.hover',
            style: {
              'line-color': '#fff',
              'target-arrow-color': '#fff',
              'width': 3,
            }
          }
        ],
        layout: {
          name: 'dagre',
          rankDir: 'TB',
          rankSep: 80,
          nodeSep: 50,
          edgeSep: 20,
          animate: false,
        },
        minZoom: 0.3,
        maxZoom: 3,
      });

      // Hover highlight
      cy.on('mouseover', 'node', function(e) {
        const node = e.target;
        node.addClass('hover');
        node.connectedEdges().addClass('hover');
        node.neighborhood('node').addClass('hover');
      });
      cy.on('mouseout', 'node', function(e) {
        const node = e.target;
        node.removeClass('hover');
        node.connectedEdges().removeClass('hover');
        node.neighborhood('node').removeClass('hover');
      });

      // Click to navigate
      cy.on('tap', 'node', function(e) {
        const data = e.target.data();
        if (data.line != null) {
          vscode.postMessage({ command: 'navigateToStep', stepName: data.id, line: data.line });
        }
      });
    }

    // Initial render
    buildGraph(${nodesJson}, ${edgesJson});

    // Listen for updates from extension
    window.addEventListener('message', function(event) {
      const msg = event.data;
      if (msg.command === 'updateDag') {
        buildGraph(msg.data.nodes, msg.data.edges);
      }
    });
  </script>
</body>
</html>`;
}

export async function showDag(extensionPath: string, flowFilePath: string): Promise<void> {
  let data: DagData;
  try {
    data = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Extracting DAG...' },
      () => runDagScript(extensionPath, flowFilePath)
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    vscode.window.showErrorMessage(`Failed to extract DAG: ${msg}`);
    return;
  }

  if (!currentPanel) {
    currentPanel = vscode.window.createWebviewPanel(
      'metaflowDag',
      '',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    currentPanel.webview.onDidReceiveMessage((msg) => {
      if (msg.command === 'navigateToStep' && currentFlowFile && msg.line != null) {
        navigateToStep(currentFlowFile, msg.line);
      }
    });

    currentPanel.onDidDispose(() => {
      currentPanel = undefined;
      currentFlowFile = undefined;
      saveListener?.dispose();
      saveListener = undefined;
      clearTimeout(refreshTimer);
    });

    // First creation — must set HTML to load Cytoscape scripts
    currentFlowFile = flowFilePath;
    currentPanel.title = `DAG: ${path.basename(flowFilePath)}`;
    currentPanel.webview.html = getWebviewContent(data);
  } else {
    currentPanel.reveal(vscode.ViewColumn.Beside);
    currentFlowFile = flowFilePath;
    currentPanel.title = `DAG: ${path.basename(flowFilePath)}`;
    // Reuse existing webview — send data via message to avoid CDN re-fetch
    currentPanel.webview.postMessage({ command: 'updateDag', data });
  }

  // Set up debounced live refresh on save
  saveListener?.dispose();
  saveListener = vscode.workspace.onDidSaveTextDocument((doc) => {
    if (currentFlowFile && doc.uri.fsPath === currentFlowFile) {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => refreshDag(extensionPath, currentFlowFile!), 400);
    }
  });
}
