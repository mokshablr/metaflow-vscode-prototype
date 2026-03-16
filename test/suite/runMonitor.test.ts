import * as assert from 'assert';
import * as path from 'path';
import { parseRunId, parseFlowName } from '../../src/runner';
import { ensureExtensionActive, isMetaflowInstalled, runPythonScript, safeParseJson } from './helpers';

suite('Run Monitor', () => {

  // --- Flow name parsing ---

  suite('parseFlowName', () => {
    test('extracts flow name from "executing X for user:"', () => {
      assert.strictEqual(parseFlowName('Metaflow 2.12.0 executing LinearFlow for user:arjun'), 'LinearFlow');
    });

    test('extracts flow name with version prefix', () => {
      assert.strictEqual(parseFlowName('Metaflow 2.9.1 executing MyPipelineFlow for user:ci'), 'MyPipelineFlow');
    });

    test('returns null when no match', () => {
      assert.strictEqual(parseFlowName('Workflow starting (run-id 123):'), null);
      assert.strictEqual(parseFlowName(''), null);
    });

    test('does not match lowercase class names', () => {
      assert.strictEqual(parseFlowName('executing myflow for user:x'), null);
    });
  });

  // --- Run ID regex ---

  suite('parseRunId', () => {
    test('matches "run-id 123"', () => {
      assert.strictEqual(parseRunId('Workflow starting (run-id 123):'), '123');
    });

    test('matches "Run ID: 456"', () => {
      assert.strictEqual(parseRunId('Run ID: 456'), '456');
    });

    test('matches "run id 789"', () => {
      assert.strictEqual(parseRunId('run id 789'), '789');
    });

    test('matches "run-id 1840392213" in longer line', () => {
      assert.strictEqual(
        parseRunId('2024-01-01 Workflow starting (run-id 1840392213): some text'),
        '1840392213'
      );
    });

    test('returns null for lines with no run ID', () => {
      assert.strictEqual(parseRunId('Step start is starting.'), null);
      assert.strictEqual(parseRunId(''), null);
      assert.strictEqual(parseRunId('running some process'), null);
    });

    test('handles case insensitivity', () => {
      assert.strictEqual(parseRunId('RUN-ID 999'), '999');
      assert.strictEqual(parseRunId('Run-Id: 111'), '111');
    });
  });

  // --- Python script schema ---

  suite('get_run_status.py schema', () => {
    const scriptPath = path.resolve(__dirname, '../../../python/get_run_status.py');

    test('returns error for invalid pathspec', async function () {
      const hasMf = await isMetaflowInstalled();
      if (!hasMf) { this.skip(); return; }

      const result = await runPythonScript(scriptPath, ['NonExistentFlow', '99999999']);
      const parsed = safeParseJson(result.stdout);
      assert.ok(parsed && typeof parsed === 'object' && 'error' in parsed,
        'Should return an error object for invalid pathspec');
      assert.strictEqual(result.code, 1);
    });

    test('returns error with no arguments', async () => {
      const result = await runPythonScript(scriptPath, []);
      const parsed = safeParseJson(result.stdout);
      assert.ok(parsed && typeof parsed === 'object' && 'error' in parsed,
        'Should return an error for missing arguments');
      assert.strictEqual(result.code, 1);
    });
  });

  // --- Streamed run ID detection ---

  suite('Streamed run ID detection', () => {
    test('parseRunId works on partial/chunked lines', () => {
      // Simulate chunked output processing
      const chunks = ['Workflow star', 'ting (run-id 555', '): done'];
      let lineBuffer = '';
      let detectedId: string | null = null;

      for (const chunk of chunks) {
        lineBuffer += chunk;
        const lines = lineBuffer.split('\n');
        lineBuffer = lines.pop()!;
        for (const line of lines) {
          const id = parseRunId(line);
          if (id) { detectedId = id; }
        }
      }
      // Process remaining buffer
      if (lineBuffer) {
        const id = parseRunId(lineBuffer);
        if (id) { detectedId = id; }
      }

      assert.strictEqual(detectedId, '555');
    });

    test('detects run ID in multi-line output', () => {
      const output = 'Metaflow 2.12.0\nValidating flow...\nWorkflow starting (run-id 42):\nStep start\n';
      const lines = output.split('\n');
      let detectedId: string | null = null;
      for (const line of lines) {
        const id = parseRunId(line);
        if (id && !detectedId) { detectedId = id; }
      }
      assert.strictEqual(detectedId, '42');
    });
  });

  // --- Command registration ---

  suite('Command registration', () => {
    test('metaflow.monitorRun is registered', async () => {
      await ensureExtensionActive();
      const allCommands = await (await import('vscode')).commands.getCommands(true);
      assert.ok(allCommands.includes('metaflow.monitorRun'),
        'Command "metaflow.monitorRun" should be registered');
    });
  });
});
