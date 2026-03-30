import * as assert from 'assert';
import * as path from 'path';
import { buildRunArgs, getParameters, ParameterInfo } from '../../src/runLauncher';
import { runPythonScript, safeParseJson } from './helpers';

// ── buildRunArgs — pure function tests ─────────────────────────────────────

suite('runLauncher — buildRunArgs', () => {
  test('empty params + local backend produces empty args', () => {
    const args = buildRunArgs([], 'local');
    assert.deepStrictEqual(args, []);
  });

  test('params with values become --<name> <value> pairs', () => {
    const args = buildRunArgs(
      [{ name: 'alpha', value: '0.01' }, { name: 'epochs', value: '10' }],
      'local'
    );
    assert.deepStrictEqual(args, ['--alpha', '0.01', '--epochs', '10']);
  });

  test('empty-string param value is skipped', () => {
    const args = buildRunArgs(
      [{ name: 'alpha', value: '' }, { name: 'epochs', value: '5' }],
      'local'
    );
    assert.deepStrictEqual(args, ['--epochs', '5']);
  });

  test('whitespace-only param value is skipped', () => {
    const args = buildRunArgs(
      [{ name: 'tag', value: '   ' }],
      'local'
    );
    assert.deepStrictEqual(args, []);
  });

  test('kubernetes backend appends --with kubernetes', () => {
    const args = buildRunArgs([], 'kubernetes');
    assert.deepStrictEqual(args, ['--with', 'kubernetes']);
  });

  test('batch backend appends --with batch', () => {
    const args = buildRunArgs([], 'batch');
    assert.deepStrictEqual(args, ['--with', 'batch']);
  });

  test('params + kubernetes backend produces combined args', () => {
    const args = buildRunArgs(
      [{ name: 'alpha', value: '0.5' }],
      'kubernetes'
    );
    assert.deepStrictEqual(args, ['--alpha', '0.5', '--with', 'kubernetes']);
  });

  test('params + batch backend produces combined args', () => {
    const args = buildRunArgs(
      [{ name: 'alpha', value: '0.1' }, { name: 'tag', value: 'v2' }],
      'batch'
    );
    assert.deepStrictEqual(args, ['--alpha', '0.1', '--tag', 'v2', '--with', 'batch']);
  });
});

// ── get_parameters.py — schema contract tests (no Metaflow required) ───────

suite('runLauncher — get_parameters.py schema', () => {
  const scriptPath = path.resolve(__dirname, '../../../python/get_parameters.py');
  const fixturesPath = path.resolve(__dirname, '../../../fixtures');
  let parsedParams: ParameterInfo[] | null = null;

  suiteSetup(async function () {
    this.timeout(10000);
    const flowFile = path.join(fixturesPath, 'parametrized_flow.py');
    const result = await runPythonScript(scriptPath, [flowFile]);
    if (result.code === 0) {
      parsedParams = safeParseJson(result.stdout) as ParameterInfo[];
    }
  });

  test('returns an array for a flow with no parameters', async function () {
    this.timeout(10000);
    const flowFile = path.join(fixturesPath, 'example_flow.py');
    const result = await runPythonScript(scriptPath, [flowFile]);
    assert.strictEqual(result.code, 0, `script exited non-zero: ${result.stderr}`);
    const data = safeParseJson(result.stdout);
    assert.ok(Array.isArray(data), 'output should be an array');
    assert.strictEqual((data as unknown[]).length, 0, 'example_flow has no parameters');
  });

  test('returns correct parameter count for parametrized_flow.py', function () {
    assert.ok(parsedParams, 'suiteSetup should have parsed parametrized_flow.py');
    assert.strictEqual(parsedParams!.length, 3, 'parametrized_flow defines 3 parameters');
  });

  test('each parameter has name, type, default keys', function () {
    assert.ok(parsedParams, 'suiteSetup should have parsed parametrized_flow.py');
    for (const param of parsedParams!) {
      assert.ok('name' in param, 'each param should have a name key');
      assert.ok('type' in param, 'each param should have a type key');
      assert.ok('default' in param, 'each param should have a default key');
      assert.strictEqual(typeof param.name, 'string', 'name should be a string');
    }
  });

  test('alpha parameter has correct name, type float, and default 0.01', function () {
    assert.ok(parsedParams, 'suiteSetup should have parsed parametrized_flow.py');
    const alpha = parsedParams!.find(p => p.name === 'alpha');
    assert.ok(alpha, 'alpha parameter should be present');
    assert.strictEqual(alpha!.type, 'float', 'alpha type should be float');
    assert.strictEqual(alpha!.default, 0.01, 'alpha default should be 0.01');
  });

  test('epochs parameter has type int and default 10', function () {
    assert.ok(parsedParams, 'suiteSetup should have parsed parametrized_flow.py');
    const epochs = parsedParams!.find(p => p.name === 'epochs');
    assert.ok(epochs, 'epochs parameter should be present');
    assert.strictEqual(epochs!.type, 'int', 'epochs type should be int');
    assert.strictEqual(epochs!.default, 10, 'epochs default should be 10');
  });

  test('tag parameter has type str and default experiment', function () {
    assert.ok(parsedParams, 'suiteSetup should have parsed parametrized_flow.py');
    const tag = parsedParams!.find(p => p.name === 'tag');
    assert.ok(tag, 'tag parameter should be present');
    assert.strictEqual(tag!.type, 'str', 'tag type should be str');
    assert.strictEqual(tag!.default, 'experiment', 'tag default should be experiment');
  });

  test('returns error object for non-existent file', async function () {
    this.timeout(10000);
    const result = await runPythonScript(scriptPath, ['/nonexistent/file.py']);
    assert.notStrictEqual(result.code, 0, 'should exit non-zero for missing file');
    const data = safeParseJson(result.stdout);
    assert.ok(
      data && typeof data === 'object' && 'error' in (data as object),
      'stdout should contain an error object'
    );
  });
});

// ── getParameters TypeScript wrapper — structural test ─────────────────────

suite('runLauncher — getParameters wrapper', () => {
  const extensionPath = path.resolve(__dirname, '../../..');
  const fixturesPath = path.resolve(__dirname, '../../../fixtures');

  test('returns ParameterInfo[] for example_flow.py (no params)', async function () {
    this.timeout(10000);
    const flowFile = path.join(fixturesPath, 'example_flow.py');
    const params = await getParameters(extensionPath, flowFile);
    assert.ok(Array.isArray(params), 'getParameters should return an array');
    assert.strictEqual(params.length, 0, 'example_flow has no parameters');
  });

  test('returns 3 params for parametrized_flow.py', async function () {
    this.timeout(10000);
    const flowFile = path.join(fixturesPath, 'parametrized_flow.py');
    const params = await getParameters(extensionPath, flowFile);
    assert.ok(Array.isArray(params), 'getParameters should return an array');
    assert.strictEqual(params.length, 3, 'parametrized_flow has 3 parameters');
  });

  test('rejects with Error for non-existent file', async function () {
    this.timeout(10000);
    try {
      await getParameters(extensionPath, '/nonexistent/file.py');
      assert.fail('Should have rejected for non-existent file');
    } catch (err: unknown) {
      assert.ok(err instanceof Error, 'Should reject with an Error instance');
      assert.ok(err.message.length > 0, 'Error message should not be empty');
    }
  });
});
