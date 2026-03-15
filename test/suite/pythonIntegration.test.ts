import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as vscode from 'vscode';
import { spawn } from 'child_process';
import {
  getPythonPath, runPythonScript, isMetaflowInstalled, safeParseJson, isValidStatus,
} from './helpers';
import { MetaflowTreeProvider, CTX } from '../../src/metaflowTreeProvider';

suite('Python Integration — get_data.py', () => {
  const scriptPath = path.resolve(__dirname, '../../../python/get_data.py');
  let hasMetaflow: boolean;

  suiteSetup(async () => {
    hasMetaflow = await isMetaflowInstalled();
  });

  test('flows command returns valid JSON or metaflow error', async () => {
    const result = await runPythonScript(scriptPath, ['flows']);
    const parsed = safeParseJson(result.stdout);

    if (hasMetaflow) {
      assert.ok(parsed !== null, 'Output should be valid JSON when metaflow is installed');
      assert.ok(typeof parsed === 'object', 'Should return an object');
    } else {
      if (parsed !== null) {
        assert.ok((parsed as { error?: string }).error, 'Should return error JSON without metaflow');
      } else {
        assert.ok(result.stderr.includes('metaflow') || result.code !== 0,
          'Should fail gracefully when metaflow is missing');
      }
    }
  });

  test('flows command with filter returns valid JSON or metaflow error', async () => {
    const result = await runPythonScript(scriptPath, ['flows', 'successful']);
    const parsed = safeParseJson(result.stdout);

    if (hasMetaflow) {
      assert.ok(parsed !== null, 'Output should be valid JSON');
      assert.ok(typeof parsed === 'object', 'Should return an object');
    } else {
      assert.ok(parsed === null || (parsed as { error?: string }).error || result.code !== 0,
        'Should handle missing metaflow');
    }
  });

  test('unknown command returns error JSON when metaflow is available', async function () {
    if (!hasMetaflow) { this.skip(); return; }
    const result = await runPythonScript(scriptPath, ['nonexistent']);
    const parsed = safeParseJson(result.stdout);
    assert.ok(parsed !== null, 'Should produce JSON output');
    assert.ok((parsed as { error?: string }).error, 'Should return an error for unknown command');
    assert.strictEqual(typeof (parsed as { error: string }).error, 'string');
    assert.ok((parsed as { error: string }).error.length > 0, 'Error message should not be empty');
    assert.notStrictEqual(result.code, 0, 'Should exit with non-zero code');
  });

  test('steps with invalid pathspec returns error when metaflow is available', async function () {
    if (!hasMetaflow) { this.skip(); return; }
    const result = await runPythonScript(scriptPath, ['steps', 'NoSuchFlow/999999']);
    const parsed = safeParseJson(result.stdout);
    assert.ok(parsed !== null, 'Should produce JSON');
    assert.ok((parsed as { error?: string }).error, 'Should return error for invalid run pathspec');
  });

  test('tasks with invalid pathspec returns error when metaflow is available', async function () {
    if (!hasMetaflow) { this.skip(); return; }
    const result = await runPythonScript(scriptPath, ['tasks', 'NoSuchFlow/999999/fake_step']);
    const parsed = safeParseJson(result.stdout);
    assert.ok(parsed !== null, 'Should produce JSON');
    assert.ok((parsed as { error?: string }).error, 'Should return error for invalid step pathspec');
  });

  test('artifacts with invalid pathspec returns error when metaflow is available', async function () {
    if (!hasMetaflow) { this.skip(); return; }
    const result = await runPythonScript(scriptPath, ['artifacts', 'NoSuchFlow/999999/fake_step/0']);
    const parsed = safeParseJson(result.stdout);
    assert.ok(parsed !== null, 'Should produce JSON');
    assert.ok((parsed as { error?: string }).error, 'Should return error for invalid task pathspec');
  });

  test('script handles missing metaflow gracefully', async function () {
    if (hasMetaflow) { this.skip(); return; }
    const result = await runPythonScript(scriptPath, ['flows']);
    assert.ok(result.code !== null, 'Process should exit');
  });
});

suite('Python Integration — get_dag.py', () => {
  const scriptPath = path.resolve(__dirname, '../../../python/get_dag.py');
  const fixturesPath = path.resolve(__dirname, '../../../fixtures');
  let hasMetaflow: boolean;
  let dagResult: { stdout: string; stderr: string; code: number | null } | null = null;

  suiteSetup(async () => {
    hasMetaflow = await isMetaflowInstalled();
    if (hasMetaflow) {
      dagResult = await runPythonScript(scriptPath, [path.join(fixturesPath, 'example_flow.py')]);
    }
  });

  test('extracts DAG from valid flow file when metaflow is available', async function () {
    if (!hasMetaflow) { this.skip(); return; }
    assert.strictEqual(dagResult!.code, 0, `Should exit 0, stderr: ${dagResult!.stderr}`);

    const parsed = JSON.parse(dagResult!.stdout);
    assert.ok(Array.isArray(parsed.nodes), 'Should have nodes array');
    assert.ok(Array.isArray(parsed.edges), 'Should have edges array');
    assert.ok(parsed.nodes.length > 0, 'Should have at least one node');
    assert.ok(parsed.edges.length > 0, 'Should have at least one edge');

    const nodeIds = parsed.nodes.map((n: { id: string }) => n.id);
    assert.ok(nodeIds.includes('start'), 'Should contain start node');
    assert.ok(nodeIds.includes('end'), 'Should contain end node');
    assert.ok(nodeIds.includes('step_a'), 'Should contain step_a node');
  });

  test('DAG nodes have required fields when metaflow is available', function () {
    if (!hasMetaflow) { this.skip(); return; }
    const parsed = JSON.parse(dagResult!.stdout);
    const VALID_DAG_TYPES = ['start', 'end', 'linear', 'split', 'join', 'foreach'];

    for (const node of parsed.nodes) {
      assert.ok(typeof node.id === 'string', 'Node should have string id');
      assert.ok(typeof node.type === 'string', 'Node should have string type');
      assert.ok(node.line === null || typeof node.line === 'number', 'Node line should be null or number');
      assert.ok(VALID_DAG_TYPES.includes(node.type), `Node type "${node.type}" should be a known type`);
    }
  });

  test('DAG edges have required fields when metaflow is available', function () {
    if (!hasMetaflow) { this.skip(); return; }
    const parsed = JSON.parse(dagResult!.stdout);

    for (const edge of parsed.edges) {
      assert.ok(typeof edge.from === 'string', 'Edge should have string from');
      assert.ok(typeof edge.to === 'string', 'Edge should have string to');
    }
  });

  test('returns error for non-existent file', async () => {
    const result = await runPythonScript(scriptPath, ['/tmp/no_such_file_12345.py']);
    const parsed = safeParseJson(result.stdout);
    if (parsed !== null) {
      assert.ok((parsed as { error?: string }).error, 'Should return error for missing file');
    }
    assert.notStrictEqual(result.code, 0, 'Should exit non-zero');
  });

  test('returns error for file without FlowSpec when metaflow is available', async function () {
    if (!hasMetaflow) { this.skip(); return; }
    const result = await runPythonScript(scriptPath, [path.join(fixturesPath, 'invalid_flow.py')]);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.error, 'Should return error when no FlowSpec found');
  });

  test('returns error for syntax error in file', async () => {
    const result = await runPythonScript(scriptPath, [path.join(fixturesPath, 'syntax_error.py')]);
    const parsed = safeParseJson(result.stdout);
    if (parsed !== null) {
      assert.ok((parsed as { error?: string }).error, 'Should return error for syntax error');
    }
    assert.notStrictEqual(result.code, 0, 'Should exit non-zero');
  });

  test('returns error when no arguments given', async () => {
    const result = await runPythonScript(scriptPath, []);
    const parsed = safeParseJson(result.stdout);
    if (parsed !== null) {
      assert.ok((parsed as { error?: string }).error, 'Should return usage error');
    }
    assert.notStrictEqual(result.code, 0, 'Should exit non-zero');
  });

  test('returns metaflow-not-installed error gracefully', async function () {
    if (hasMetaflow) { this.skip(); return; }
    const result = await runPythonScript(scriptPath, [path.join(fixturesPath, 'example_flow.py')]);
    const parsed = safeParseJson(result.stdout);
    if (parsed !== null) {
      assert.ok((parsed as { error?: string }).error?.toLowerCase().includes('metaflow'),
        'Error should mention metaflow');
    }
    assert.notStrictEqual(result.code, 0, 'Should exit non-zero');
  });
});

suite('Python Integration — delete_run.py', () => {
  const scriptPath = path.resolve(__dirname, '../../../python/delete_run.py');

  test('returns error for non-existent run', async () => {
    const result = await runPythonScript(scriptPath, ['FakeFlow', 'fake_run_99999']);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.error, 'Should return error for non-existent run');
    assert.ok(parsed.error.includes('Run not found'), 'Error should mention run not found');
  });
});

suite('Schema Contracts — Fixture Run', () => {
  const scriptPath = path.resolve(__dirname, '../../../python/get_data.py');
  const fixturesPath = path.resolve(__dirname, '../../../fixtures');
  const extensionPath = path.resolve(__dirname, '../../..');
  let hasMetaflow: boolean;
  let tmpHome: string;
  let firstRunId: string | undefined;
  let firstStepName: string | undefined;
  let firstTaskId: string | undefined;
  let fixtureEnv: NodeJS.ProcessEnv;

  suiteSetup(async function () {
    this.timeout(60000);
    hasMetaflow = await isMetaflowInstalled();
    if (!hasMetaflow) { return; }

    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mf-test-'));
    fixtureEnv = { ...process.env, METAFLOW_HOME: tmpHome };

    // Run the fixture flow into the isolated temp dir
    await new Promise<void>((resolve, reject) => {
      const child = spawn(getPythonPath(), [
        path.join(fixturesPath, 'example_flow.py'), 'run',
      ], {
        cwd: fixturesPath,
        env: fixtureEnv,
      });
      child.on('close', code => code === 0 ? resolve() : reject(new Error(`Flow run failed with code ${code}`)));
      child.on('error', reject);
    });

    // Discover run ID, then cache step/task pathspec so tests don't re-fetch
    const flowsResult = await runPythonScript(scriptPath, ['flows'], undefined, fixtureEnv);
    const flows = safeParseJson(flowsResult.stdout) as Record<string, string[]> | null;
    if (!flows || !flows['ExampleFlow']?.length) { return; }
    firstRunId = flows['ExampleFlow'][0];

    const stepsResult = await runPythonScript(scriptPath, ['steps', `ExampleFlow/${firstRunId}`], undefined, fixtureEnv);
    const steps = safeParseJson(stepsResult.stdout) as { name: string }[] | null;
    if (!Array.isArray(steps) || steps.length === 0) { return; }
    firstStepName = steps[0].name;

    const tasksResult = await runPythonScript(scriptPath, ['tasks', `ExampleFlow/${firstRunId}/${firstStepName}`], undefined, fixtureEnv);
    const tasks = safeParseJson(tasksResult.stdout) as { id: string }[] | null;
    if (!Array.isArray(tasks) || tasks.length === 0) { return; }
    firstTaskId = tasks[0].id;
  });

  suiteTeardown(() => {
    if (tmpHome) {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test('flows response — values are string arrays', async function () {
    if (!hasMetaflow) { this.skip(); return; }
    const result = await runPythonScript(scriptPath, ['flows'], undefined, fixtureEnv);
    const parsed = safeParseJson(result.stdout);
    assert.ok(parsed !== null, 'Should return valid JSON');
    assert.ok(typeof parsed === 'object' && !Array.isArray(parsed), 'Should be a plain object');
    assert.ok(!('error' in (parsed as object)), 'Should not have error field');
    for (const v of Object.values(parsed as Record<string, unknown>)) {
      assert.ok(Array.isArray(v), 'Each value should be an array');
      for (const s of v as unknown[]) {
        assert.strictEqual(typeof s, 'string', 'Each run ID should be a string');
      }
    }
  });

  test('steps response — array of {name:string, status:enum}', async function () {
    if (!hasMetaflow || !firstRunId) { this.skip(); return; }
    const result = await runPythonScript(scriptPath, ['steps', `ExampleFlow/${firstRunId}`], undefined, fixtureEnv);
    const parsed = safeParseJson(result.stdout) as unknown[];
    assert.ok(Array.isArray(parsed), 'Steps should be an array');
    assert.ok(parsed.length > 0, 'Should have at least one step');
    for (const step of parsed as { name: unknown; status: unknown }[]) {
      assert.strictEqual(typeof step.name, 'string', 'Step name should be string');
      assert.ok(isValidStatus(step.status), `Step status "${step.status}" should be a valid status`);
    }
  });

  test('tasks response — array of {id:string, status:enum}', async function () {
    if (!hasMetaflow || !firstRunId || !firstStepName) { this.skip(); return; }
    const result = await runPythonScript(scriptPath, ['tasks', `ExampleFlow/${firstRunId}/${firstStepName}`], undefined, fixtureEnv);
    const parsed = safeParseJson(result.stdout) as unknown[];
    assert.ok(Array.isArray(parsed), 'Tasks should be an array');
    assert.ok(parsed.length > 0, 'Should have at least one task');
    for (const task of parsed as { id: unknown; status: unknown }[]) {
      assert.strictEqual(typeof task.id, 'string', 'Task id should be string');
      assert.ok(isValidStatus(task.status), `Task status "${task.status}" should be a valid status`);
    }
  });

  test('artifacts response — each value has type, preview, raw as strings', async function () {
    if (!hasMetaflow || !firstRunId || !firstStepName || !firstTaskId) { this.skip(); return; }
    const taskPathspec = `ExampleFlow/${firstRunId}/${firstStepName}/${firstTaskId}`;
    const result = await runPythonScript(scriptPath, ['artifacts', taskPathspec], undefined, fixtureEnv);
    const parsed = safeParseJson(result.stdout) as Record<string, unknown>;
    assert.ok(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed), 'Artifacts should be an object');
    for (const [, info] of Object.entries(parsed)) {
      const artifact = info as { type?: unknown; preview?: unknown; raw?: unknown };
      assert.strictEqual(typeof artifact.type, 'string', 'artifact.type should be string');
      assert.strictEqual(typeof artifact.preview, 'string', 'artifact.preview should be string');
      assert.strictEqual(typeof artifact.raw, 'string', 'artifact.raw should be string');
    }
  });

  test('tree hierarchy — FlowNode→RunNode→StepNode→TaskNode→ArtifactNode', async function () {
    if (!hasMetaflow || !firstRunId) { this.skip(); return; }
    this.timeout(30000);

    // Set METAFLOW_HOME so the tree provider's spawned processes see fixture data
    const prevHome = process.env.METAFLOW_HOME;
    process.env.METAFLOW_HOME = tmpHome;
    try {
      const provider = new MetaflowTreeProvider(extensionPath);

      // Level 0: root → FlowNodes
      const flowNodes = await provider.getChildren(undefined) as vscode.TreeItem[];
      assert.ok(flowNodes.length > 0, 'Should have flow nodes');
      const flowNode = flowNodes.find(n => n.contextValue === CTX.FLOW);
      assert.ok(flowNode, 'Should find a FlowNode');

      // Level 1: FlowNode → RunNodes
      const runNodes = await provider.getChildren(flowNode) as vscode.TreeItem[];
      assert.ok(runNodes.length > 0, 'Should have run nodes');
      const runNode = runNodes.find(n => n.contextValue === CTX.RUN);
      assert.ok(runNode, 'Should find a RunNode');

      // Level 2: RunNode → StepNodes
      const stepNodes = await provider.getChildren(runNode) as vscode.TreeItem[];
      assert.ok(stepNodes.length > 0, 'Should have step nodes');
      const stepNode = stepNodes.find(n => n.contextValue === CTX.STEP);
      assert.ok(stepNode, 'Should find a StepNode');

      // Level 3: StepNode → TaskNodes
      const taskNodes = await provider.getChildren(stepNode) as vscode.TreeItem[];
      assert.ok(taskNodes.length > 0, 'Should have task nodes');
      const taskNode = taskNodes.find(n => n.contextValue === CTX.TASK);
      assert.ok(taskNode, 'Should find a TaskNode');

      // Level 4: TaskNode → ArtifactNodes (or error if no artifacts, which is also valid)
      const artifactNodes = await provider.getChildren(taskNode) as vscode.TreeItem[];
      assert.ok(artifactNodes.length > 0, 'Should have artifact or error nodes');
    } finally {
      if (prevHome === undefined) {
        delete process.env.METAFLOW_HOME;
      } else {
        process.env.METAFLOW_HOME = prevHome;
      }
    }
  });
});

suite('Python Process Spawning', () => {
  test('stdout buffering works for large output', async () => {
    const result = await new Promise<{ stdout: string; code: number | null }>((resolve, reject) => {
      const child = spawn(getPythonPath(), ['-c', 'import json; print(json.dumps({"data": "x" * 10000}))']);
      const out: string[] = [];
      child.stdout?.on('data', (c: Buffer) => out.push(c.toString()));
      child.on('close', (code) => resolve({ stdout: out.join(''), code }));
      child.on('error', reject);
    });
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.data.length === 10000, 'Should handle large stdout correctly');
  });

  test('stderr is captured', async () => {
    const result = await new Promise<{ stderr: string; code: number | null }>((resolve, reject) => {
      const child = spawn(getPythonPath(), ['-c', 'import sys; sys.stderr.write("test error\\n"); sys.exit(1)']);
      const err: string[] = [];
      child.stderr?.on('data', (c: Buffer) => err.push(c.toString()));
      child.on('close', (code) => resolve({ stderr: err.join(''), code }));
      child.on('error', reject);
    });
    assert.ok(result.stderr.includes('test error'), 'Should capture stderr');
    assert.strictEqual(result.code, 1, 'Should capture exit code');
  });

  test('timeout kills long-running process', async () => {
    const start = Date.now();
    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn(getPythonPath(), ['-c', 'import time; time.sleep(60)']);
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error('Timed out'));
        }, 2000);
        child.on('close', () => {
          clearTimeout(timer);
          resolve();
        });
        child.on('error', (e) => {
          clearTimeout(timer);
          reject(e);
        });
      });
      assert.fail('Should have timed out');
    } catch (err: unknown) {
      const elapsed = Date.now() - start;
      assert.ok(err instanceof Error && err.message === 'Timed out', 'Should throw timeout error');
      assert.ok(elapsed < 5000, 'Should timeout within reasonable time');
    }
  });

  test('spawn with invalid binary path surfaces ENOENT, not unhandled rejection', (done) => {
    const child = spawn('/nonexistent/python_xyz', ['-c', 'print("hello")']);
    let finished = false;
    child.on('error', (err: NodeJS.ErrnoException) => {
      if (finished) { return; }
      finished = true;
      assert.strictEqual(err.code, 'ENOENT', 'Should surface ENOENT error');
      done();
    });
    child.on('close', () => {
      if (finished) { return; }
      finished = true;
      done(new Error('Should not close normally without first emitting an error event'));
    });
  });

  test('empty stdout is handled gracefully (no JSON parse exception)', () => {
    assert.doesNotThrow(() => {
      const result = safeParseJson('');
      assert.strictEqual(result, null, 'Empty string should parse as null');
    });
  });
});
