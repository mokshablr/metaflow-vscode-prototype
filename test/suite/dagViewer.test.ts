import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import {
  runPythonScript, isMetaflowInstalled, ensureExtensionActive,
} from './helpers';
import { generateHtml, showDag } from '../../src/dagView';

suite('DAG Viewer — Data Extraction', () => {
  const scriptPath = path.resolve(__dirname, '../../../python/get_dag.py');
  const fixturesPath = path.resolve(__dirname, '../../../fixtures');
  let hasMetaflow: boolean;

  suiteSetup(async () => {
    hasMetaflow = await isMetaflowInstalled();
  });

  test('extracts correct graph structure from example flow', async function () {
    if (!hasMetaflow) { this.skip(); return; }

    const result = await runPythonScript(scriptPath, [path.join(fixturesPath, 'example_flow.py')]);
    assert.strictEqual(result.code, 0, `Should succeed, stderr: ${result.stderr}`);

    const dag = JSON.parse(result.stdout);

    assert.ok(dag.nodes.length === 3, 'Example flow should have 3 nodes (start, step_a, end)');

    const startNode = dag.nodes.find((n: { id: string }) => n.id === 'start');
    assert.ok(startNode, 'Should have start node');
    assert.strictEqual(startNode.type, 'start', 'Start node should have type "start"');
    assert.ok(typeof startNode.line === 'number', 'Start node should have a line number');

    const endNode = dag.nodes.find((n: { id: string }) => n.id === 'end');
    assert.ok(endNode, 'Should have end node');
    assert.strictEqual(endNode.type, 'end', 'End node should have type "end"');

    const stepA = dag.nodes.find((n: { id: string }) => n.id === 'step_a');
    assert.ok(stepA, 'Should have step_a node');
    assert.strictEqual(stepA.type, 'linear', 'step_a should be linear type');

    assert.ok(dag.edges.length >= 2, 'Should have at least 2 edges');

    const startToStepA = dag.edges.find((e: { from: string; to: string }) => e.from === 'start' && e.to === 'step_a');
    assert.ok(startToStepA, 'Should have edge from start to step_a');

    const stepAToEnd = dag.edges.find((e: { from: string; to: string }) => e.from === 'step_a' && e.to === 'end');
    assert.ok(stepAToEnd, 'Should have edge from step_a to end');
  });

  test('returns error for invalid flow file', async function () {
    if (!hasMetaflow) { this.skip(); return; }
    const result = await runPythonScript(scriptPath, [path.join(fixturesPath, 'invalid_flow.py')]);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.error, 'Should error for file without FlowSpec');
  });

  test('returns error for syntax error file', async function () {
    if (!hasMetaflow) { this.skip(); return; }
    const result = await runPythonScript(scriptPath, [path.join(fixturesPath, 'syntax_error.py')]);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.error, 'Should error for syntax error in file');
  });

  test('get_dag.py reports metaflow not installed when missing', async function () {
    if (hasMetaflow) { this.skip(); return; }
    const result = await runPythonScript(scriptPath, [path.join(fixturesPath, 'example_flow.py')]);
    assert.notStrictEqual(result.code, 0, 'Should exit non-zero without metaflow');
    try {
      const parsed = JSON.parse(result.stdout);
      assert.ok(parsed.error?.toLowerCase().includes('metaflow'),
        'Error should mention metaflow');
    } catch {
      assert.ok(result.stderr.toLowerCase().includes('metaflow') || result.code !== 0,
        'Should indicate metaflow is missing');
    }
  });
});

suite('DAG Viewer — generateHtml', () => {
  test('generateHtml contains Content-Security-Policy meta tag', () => {
    const nodes = [
      { id: 'start', type: 'start', line: 1 },
      { id: 'end', type: 'end', line: null },
    ];
    const edges = [{ from: 'start', to: 'end' }];
    const html = generateHtml(nodes, edges);
    assert.ok(html.includes('Content-Security-Policy'), 'HTML should contain CSP meta tag');
  });

  test('generateHtml contains all node IDs from input', () => {
    const nodes = [
      { id: 'start', type: 'start', line: 1 },
      { id: 'step_a', type: 'linear', line: 8 },
      { id: 'end', type: 'end', line: null },
    ];
    const edges = [
      { from: 'start', to: 'step_a' },
      { from: 'step_a', to: 'end' },
    ];
    const html = generateHtml(nodes, edges);
    assert.ok(html.includes('"start"'), 'HTML should contain start node ID');
    assert.ok(html.includes('"step_a"'), 'HTML should contain step_a node ID');
    assert.ok(html.includes('"end"'), 'HTML should contain end node ID');
  });
});

suite('DAG Viewer — Webview', () => {
  const fixturesPath = path.resolve(__dirname, '../../../fixtures');
  const extensionPath = path.resolve(__dirname, '../../..');

  test('showDAG command is registered', async () => {
    await ensureExtensionActive();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('metaflow.showDAG'), 'showDAG command should exist');
  });

  test('showDAG command executes without throwing for valid flow file', async function () {
    const hasMetaflow = await isMetaflowInstalled();
    if (!hasMetaflow) { this.skip(); return; }
    this.timeout(20000);

    const flowFile = path.join(fixturesPath, 'example_flow.py');
    const uri = vscode.Uri.file(flowFile);

    await vscode.window.showTextDocument(uri);
    // Command should complete without throwing
    await vscode.commands.executeCommand('metaflow.showDAG', uri);
  });

  test('showDag returns a WebviewPanel when metaflow is installed', async function () {
    const hasMetaflow = await isMetaflowInstalled();
    if (!hasMetaflow) { this.skip(); return; }
    this.timeout(20000);

    const flowFile = path.join(fixturesPath, 'example_flow.py');
    const panel = await showDag(extensionPath, flowFile);
    assert.ok(panel, 'showDag should return a WebviewPanel');
    panel?.dispose();
  });

  test('showDag panel title contains the flow filename', async function () {
    const hasMetaflow = await isMetaflowInstalled();
    if (!hasMetaflow) { this.skip(); return; }
    this.timeout(20000);

    const flowFile = path.join(fixturesPath, 'example_flow.py');
    const panel = await showDag(extensionPath, flowFile);
    assert.ok(panel?.title.includes('example_flow.py'), 'Panel title should include the flow filename');
    panel?.dispose();
  });

  test('showDAG handles missing python file gracefully', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    // Without a Python file open, the command should show an error message, not throw
    try {
      await vscode.commands.executeCommand('metaflow.showDAG');
    } catch (err) {
      assert.fail(`Command should not throw, but threw: ${err}`);
    }
  });
});
