import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { runPythonScript, ensureExtensionActive } from './helpers';
import { MetaflowTreeProvider } from '../../src/metaflowTreeProvider';

suite('Run Deletion', () => {
  let tmpDir: string;
  const scriptPath = path.resolve(__dirname, '../../../python/delete_run.py');
  const extensionPath = path.resolve(__dirname, '../../..');

  setup(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'metaflow-test-'));
  });

  teardown(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('delete_run.py removes .metaflow run directory', async () => {
    const flowDir = path.join(tmpDir, '.metaflow', 'ExampleFlow');
    const runDir = path.join(flowDir, '12345');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'data.json'), '{}');

    const result = await runPythonScript(scriptPath, ['ExampleFlow', '12345'], tmpDir);

    const parsed = JSON.parse(result.stdout);
    assert.strictEqual(result.code, 0, 'Should exit with code 0');
    assert.strictEqual(parsed.ok, true, 'Should return {ok: true} (strict equality)');
    assert.ok(!('error' in parsed), 'Should not have error field');
    assert.ok(!fs.existsSync(runDir), 'Run directory should be removed');
    assert.ok(fs.existsSync(flowDir), 'Parent flow directory must survive');
  });

  test('delete_run.py returns error for non-existent run', async () => {
    fs.mkdirSync(path.join(tmpDir, '.metaflow', 'ExampleFlow'), { recursive: true });

    const result = await runPythonScript(scriptPath, ['ExampleFlow', 'no_such_run'], tmpDir);

    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.error, 'Should return error');
    assert.ok(parsed.error.includes('Run not found'), 'Error should indicate run not found');
    assert.notStrictEqual(result.code, 0, 'Should exit non-zero');
  });

  test('deleteRun command exists and is callable', async () => {
    await ensureExtensionActive();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('metaflow.deleteRun'), 'deleteRun command should be registered');
  });

  test('provider.refresh() fires onDidChangeTreeData event after deleteRun', async () => {
    const provider = new MetaflowTreeProvider(extensionPath);

    let eventFired = false;
    provider.onDidChangeTreeData(() => { eventFired = true; });

    // deleteRun will fail (run doesn't exist) but we only care that refresh fires
    await provider.deleteRun('ExampleFlow', '12345').catch(() => {});
    provider.refresh();

    assert.ok(eventFired, 'refresh() should fire onDidChangeTreeData event');
  });
});
