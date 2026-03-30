import * as assert from 'assert';
import * as vscode from 'vscode';
import { EXTENSION_ID, ensureExtensionActive } from './helpers';

suite('Extension Activation', () => {
  test('extension is present in installed extensions', () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, 'Extension should be installed');
  });

  test('extension activates successfully', async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, 'Extension should be installed');
    if (!ext.isActive) {
      await ext.activate();
    }
    assert.ok(ext.isActive, 'Extension should be active');
  });

  test('all commands are registered', async () => {
    await ensureExtensionActive();

    const allCommands = await vscode.commands.getCommands(true);

    const expectedCommands = [
      'metaflow.runFlow',
      'metaflow.spinStep',
      'metaflow.refreshExplorer',
      'metaflow.cycleSortArtifacts',
      'metaflow.filterRuns',
      'metaflow.copyArtifactValue',
      'metaflow.exportArtifactJson',
      'metaflow.deleteRun',
      'metaflow.showDAG',
      'metaflow.monitorRun',
      'metaflow.debugStep',
      'metaflow.debugStepDirect',
      'metaflow.debugStepFromEditor',
      'metaflow.showRunDAG',
      'metaflow.launchRun',
    ];

    for (const cmd of expectedCommands) {
      assert.ok(
        allCommands.includes(cmd),
        `Command "${cmd}" should be registered`
      );
    }
  });
});
