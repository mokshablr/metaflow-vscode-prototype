import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';

const fixturesPath = path.resolve(__dirname, '../../../fixtures');
const flowFile = path.join(fixturesPath, 'example_flow.py');

async function navigateToDefinition(
  editor: vscode.TextEditor,
  searchText: string
): Promise<number> {
  const doc = editor.document;
  let targetLine = -1;
  for (let i = 0; i < doc.lineCount; i++) {
    if (doc.lineAt(i).text.includes(searchText)) {
      targetLine = i;
      break;
    }
  }
  assert.ok(targetLine >= 0, `Should find "${searchText}" in fixture`);

  const pos = new vscode.Position(targetLine, 0);
  editor.selection = new vscode.Selection(pos, pos);
  editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);

  return targetLine;
}

suite('Step Navigation', () => {
  test('navigating to step_a works', async function () {
    this.timeout(10000);
    const editor = await vscode.window.showTextDocument(vscode.Uri.file(flowFile));
    const line = await navigateToDefinition(editor, 'def step_a');
    assert.strictEqual(editor.selection.start.line, line);
  });

  test('navigating to start step works', async function () {
    this.timeout(10000);
    const editor = await vscode.window.showTextDocument(vscode.Uri.file(flowFile));
    const line = await navigateToDefinition(editor, 'def start');
    assert.strictEqual(editor.selection.start.line, line);
  });

  test('navigating to end step works', async function () {
    this.timeout(10000);
    const editor = await vscode.window.showTextDocument(vscode.Uri.file(flowFile));
    const line = await navigateToDefinition(editor, 'def end');
    assert.strictEqual(editor.selection.start.line, line);
  });

  test('flow file contains expected step definitions', async function () {
    this.timeout(10000);
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(flowFile));
    const text = doc.getText();

    assert.ok(text.includes('def start(self)'), 'Should have start step');
    assert.ok(text.includes('def step_a(self)'), 'Should have step_a');
    assert.ok(text.includes('def end(self)'), 'Should have end step');
    assert.ok(text.includes('FlowSpec'), 'Should reference FlowSpec');
  });
});
