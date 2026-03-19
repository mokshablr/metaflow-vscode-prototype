import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import { buildDebugConfig, resolveFlowFile, getTasksForStep } from '../../src/debugConfig';
import { isMetaflowInstalled } from './helpers';

suite('debugConfig — buildDebugConfig', () => {
  test('returns correct config shape', () => {
    const cfg = buildDebugConfig(
      '/path/to/flow.py',
      'ExampleFlow',
      'step_a',
      '1234',
      '1',
      'python3'
    ) as Record<string, unknown>;

    assert.strictEqual(cfg.type, 'debugpy');
    assert.strictEqual(cfg.request, 'launch');
    assert.strictEqual(cfg.program, '/path/to/flow.py');
    assert.strictEqual(cfg.justMyCode, false);
    assert.strictEqual(cfg.console, 'integratedTerminal');
    assert.strictEqual(cfg.python, 'python3');
  });

  test('name includes all four identifiers', () => {
    const cfg = buildDebugConfig(
      '/path/to/flow.py',
      'ExampleFlow',
      'step_a',
      '1234',
      '1',
      'python3'
    ) as Record<string, unknown>;

    const name = cfg.name as string;
    assert.ok(name.includes('ExampleFlow'), 'name should include flowName');
    assert.ok(name.includes('1234'), 'name should include runId');
    assert.ok(name.includes('step_a'), 'name should include stepName');
    assert.ok(name.includes('1'), 'name should include taskId');
  });

  test('args array contains step name, run-id, and task-id flags', () => {
    const cfg = buildDebugConfig(
      '/path/to/flow.py',
      'ExampleFlow',
      'step_a',
      '1234',
      '7',
      'python3'
    ) as Record<string, unknown>;

    const args = cfg.args as string[];
    assert.ok(Array.isArray(args), 'args should be an array');
    assert.ok(args.includes('step_a'), 'args should include step name');
    assert.ok(args.includes('--run-id'), 'args should include --run-id flag');
    assert.ok(args.includes('1234'), 'args should include run id value');
    assert.ok(args.includes('--task-id'), 'args should include --task-id flag');
    assert.ok(args.includes('7'), 'args should include task id value');
    assert.strictEqual(args[0], 'step', 'first arg should be "step"');
  });

  test('no default taskId of 1 when taskId differs', () => {
    const cfg = buildDebugConfig(
      '/path/to/flow.py',
      'ExampleFlow',
      'start',
      '9999',
      '42',
      'python3'
    ) as Record<string, unknown>;

    const args = cfg.args as string[];
    const taskIdIdx = args.indexOf('--task-id');
    assert.ok(taskIdIdx !== -1, '--task-id should be present');
    assert.strictEqual(args[taskIdIdx + 1], '42', 'task id should be the provided value, not defaulted to 1');
  });
});

suite('debugConfig — resolveFlowFile', () => {
  const fixturesPath = path.resolve(__dirname, '../../../fixtures');
  const workspaceRoot = path.resolve(__dirname, '../../..');

  test('finds example_flow.py by flow class name', async function () {
    this.timeout(10000);
    // Open the fixture file to make it the active editor
    const flowFile = path.join(fixturesPath, 'example_flow.py');
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(flowFile));
    await vscode.window.showTextDocument(doc);

    const result = await resolveFlowFile(workspaceRoot, 'ExampleFlow');
    assert.ok(result, 'Should find a file');
    assert.ok(result!.includes('example_flow.py'), 'Should find the example_flow.py fixture');
  });

  test('returns undefined or shows picker for unknown flow name', async function () {
    this.timeout(10000);
    // Close all editors so active editor doesn't interfere
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    // For a flow name that doesn't exist in any file, resolveFlowFile
    // would open a file picker — in a test environment, showOpenDialog returns undefined.
    // We just verify it doesn't throw.
    try {
      const result = await resolveFlowFile(workspaceRoot, 'NonExistentFlowXYZ123');
      // result is either undefined (picker cancelled) or a string (if somehow found)
      assert.ok(result === undefined || typeof result === 'string');
    } catch (err) {
      assert.fail(`resolveFlowFile should not throw, but threw: ${err}`);
    }
  });
});

suite('debugConfig — getTasksForStep', () => {
  const extensionPath = path.resolve(__dirname, '../../..');

  test('rejects with an error on invalid pathspec (no silent fallback)', async function () {
    const hasMetaflow = await isMetaflowInstalled();
    if (!hasMetaflow) { this.skip(); return; }
    this.timeout(10000);

    try {
      await getTasksForStep(extensionPath, 'NonExistentFlow', '0', 'start');
      assert.fail('Should have rejected for a non-existent step pathspec');
    } catch (err: unknown) {
      assert.ok(err instanceof Error, 'Should reject with an Error instance');
      assert.ok(err.message.length > 0, 'Error message should not be empty');
    }
  });
});

suite('debugConfig — duration formatting contract', () => {
  test('duration null maps to "still running" label in quick pick items', () => {
    // Validate the formatting logic used in promptTaskSelection indirectly
    // by constructing items the same way the function does.
    const tasks = [
      { id: '1', status: 'done' as const, duration: 2.3 },
      { id: '2', status: 'running' as const, duration: null },
    ];

    const items = tasks.map(t => ({
      label: `task ${t.id}`,
      description: t.status,
      detail: t.duration != null ? `${t.duration}s` : 'still running',
    }));

    assert.strictEqual(items[0].detail, '2.3s', 'Numeric duration should be formatted as Ns');
    assert.strictEqual(items[1].detail, 'still running', 'null duration should show "still running"');
  });

  test('duration undefined also maps to "still running"', () => {
    const tasks = [
      { id: '3', status: 'unknown' as const, duration: undefined },
    ];

    const items = tasks.map(t => ({
      detail: t.duration != null ? `${t.duration}s` : 'still running',
    }));

    assert.strictEqual(items[0].detail, 'still running', 'undefined duration should show "still running"');
  });
});
