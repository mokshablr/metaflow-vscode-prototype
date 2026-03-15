import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import {
  MetaflowTreeProvider, RunNode, ArtifactNode, CTX,
  StepNode, TaskNode, sortArtifactEntries, ArtifactInfo,
} from '../../src/metaflowTreeProvider';

suite('MetaflowTreeProvider', () => {
  let provider: MetaflowTreeProvider;
  const extensionPath = path.resolve(__dirname, '../../..');

  setup(() => {
    provider = new MetaflowTreeProvider(extensionPath);
  });

  test('provider initializes without error', () => {
    assert.ok(provider, 'Provider should be created');
    assert.ok(typeof provider.getChildren === 'function', 'getChildren should exist');
    assert.ok(typeof provider.getTreeItem === 'function', 'getTreeItem should exist');
  });

  test('provider implements TreeDataProvider interface', () => {
    assert.ok(provider.onDidChangeTreeData, 'Should have onDidChangeTreeData event');
  });

  test('refresh clears caches and fires event', () => {
    let eventFired = false;
    provider.onDidChangeTreeData(() => {
      eventFired = true;
    });
    provider.refresh();
    assert.ok(eventFired, 'onDidChangeTreeData should fire on refresh');
  });

  test('cycleSortMode fires change event', () => {
    let eventFired = false;
    provider.onDidChangeTreeData(() => {
      eventFired = true;
    });
    provider.cycleSortMode();
    assert.ok(eventFired, 'onDidChangeTreeData should fire on sort change');
  });

  test('setRunFilter fires change event for new filter', () => {
    let eventFired = false;
    provider.onDidChangeTreeData(() => {
      eventFired = true;
    });
    provider.setRunFilter('successful');
    assert.ok(eventFired, 'Should fire event when filter changes');
  });

  test('setRunFilter does not fire for same filter', () => {
    let eventCount = 0;
    provider.onDidChangeTreeData(() => {
      eventCount++;
    });
    provider.setRunFilter('all');
    assert.strictEqual(eventCount, 0, 'Should not fire when filter is same');
  });

  test('getChildren returns items for root (handles Python errors gracefully)', async () => {
    const children = await provider.getChildren(undefined);
    assert.ok(Array.isArray(children), 'Root children should be an array');
    assert.ok(children.length > 0, 'Should return at least one node (flow or error)');
  });

  test('getTreeItem returns the element itself', () => {
    const item = new vscode.TreeItem('test');
    assert.strictEqual(provider.getTreeItem(item), item, 'Should return same item');
  });

  test('RunNode has correct properties', () => {
    const node = new RunNode('TestFlow', '12345');
    assert.strictEqual(node.flowName, 'TestFlow');
    assert.strictEqual(node.runId, '12345');
    assert.strictEqual(node.contextValue, CTX.RUN);
    assert.strictEqual(node.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
  });

  test('ArtifactNode has correct properties', () => {
    const info = { type: 'int', preview: '42', raw: '42' };
    const node = new ArtifactNode('my_var', info);
    assert.strictEqual(node.artifactName, 'my_var');
    assert.deepStrictEqual(node.info, info);
    assert.strictEqual(node.contextValue, CTX.ARTIFACT);
    assert.strictEqual(node.collapsibleState, vscode.TreeItemCollapsibleState.None);
    assert.strictEqual(node.description, 'int');
    assert.ok(node.label?.toString().includes('my_var'), 'Label should contain artifact name');
    assert.ok(node.label?.toString().includes('42'), 'Label should contain preview');
  });

  // --- CTX constants regression ---

  test('CTX constants have correct string values', () => {
    assert.strictEqual(CTX.FLOW, 'flow');
    assert.strictEqual(CTX.RUN, 'run');
    assert.strictEqual(CTX.STEP, 'step');
    assert.strictEqual(CTX.TASK, 'task');
    assert.strictEqual(CTX.ARTIFACT, 'artifact');
    assert.strictEqual(CTX.ERROR, 'error');
  });

  // --- StepNode property regression ---

  test('StepNode done — no icon, no description', () => {
    const node = new StepNode('ExampleFlow/1/myStep', { name: 'myStep', status: 'done' });
    assert.strictEqual(node.iconPath, undefined, 'Done step should have no icon');
    assert.strictEqual(node.description, undefined, 'Done step should have no description');
    assert.strictEqual(node.contextValue, CTX.STEP);
    assert.strictEqual(node.label, 'myStep');
    assert.strictEqual(node.pathspec, 'ExampleFlow/1/myStep');
  });

  test('StepNode failed — error icon, description="failed"', () => {
    const node = new StepNode('ExampleFlow/1/myStep', { name: 'myStep', status: 'failed' });
    assert.ok(node.iconPath instanceof vscode.ThemeIcon, 'Failed step should have ThemeIcon');
    assert.strictEqual((node.iconPath as vscode.ThemeIcon).id, 'error');
    assert.strictEqual(node.description, 'failed');
  });

  test('StepNode running — loading~spin icon, no description', () => {
    const node = new StepNode('ExampleFlow/1/myStep', { name: 'myStep', status: 'running' });
    assert.ok(node.iconPath instanceof vscode.ThemeIcon, 'Running step should have ThemeIcon');
    assert.strictEqual((node.iconPath as vscode.ThemeIcon).id, 'loading~spin');
    assert.strictEqual(node.description, undefined);
  });

  // --- TaskNode property regression ---

  test('TaskNode done — no icon, no description', () => {
    const node = new TaskNode('ExampleFlow/1/myStep/0', { id: '0', status: 'done' });
    assert.strictEqual(node.iconPath, undefined, 'Done task should have no icon');
    assert.strictEqual(node.description, undefined);
    assert.strictEqual(node.contextValue, CTX.TASK);
  });

  test('TaskNode failed — error icon, description="failed"', () => {
    const node = new TaskNode('ExampleFlow/1/myStep/0', { id: '0', status: 'failed' });
    assert.ok(node.iconPath instanceof vscode.ThemeIcon);
    assert.strictEqual((node.iconPath as vscode.ThemeIcon).id, 'error');
    assert.strictEqual(node.description, 'failed');
    assert.strictEqual(node.contextValue, CTX.TASK);
  });

  // --- ArtifactNode label/tooltip regression ---

  test('ArtifactNode label is "name = preview"', () => {
    const node = new ArtifactNode('my_var', { type: 'int', preview: '42', raw: '42' });
    assert.strictEqual(node.label, 'my_var = 42');
  });

  test('ArtifactNode tooltip is MarkdownString containing name, type, preview', () => {
    const node = new ArtifactNode('my_var', { type: 'int', preview: '42', raw: '42' });
    assert.ok(node.tooltip instanceof vscode.MarkdownString, 'Tooltip should be MarkdownString');
    const val = (node.tooltip as vscode.MarkdownString).value;
    assert.ok(val.includes('my_var'), 'Tooltip should contain name');
    assert.ok(val.includes('int'), 'Tooltip should contain type');
    assert.ok(val.includes('42'), 'Tooltip should contain preview');
  });

  // --- ErrorNode via broken provider ---

  test('ErrorNode returned by broken provider has contextValue="error" and warning icon', async () => {
    const brokenProvider = new MetaflowTreeProvider('/nonexistent_path_xyz');
    const children = await brokenProvider.getChildren(undefined) as vscode.TreeItem[];
    assert.ok(children.length > 0, 'Should return at least one node');
    assert.strictEqual(children[0].contextValue, CTX.ERROR);
    assert.ok((children[0].iconPath as vscode.ThemeIcon).id === 'warning');
  });

  // --- Sort cycle ---

  test('cycleSortMode cycles default → name → type → default', () => {
    assert.strictEqual(provider.getSortMode(), 'default');
    provider.cycleSortMode();
    assert.strictEqual(provider.getSortMode(), 'name');
    provider.cycleSortMode();
    assert.strictEqual(provider.getSortMode(), 'type');
    provider.cycleSortMode();
    assert.strictEqual(provider.getSortMode(), 'default');
  });

  // --- sortArtifactEntries pure function ---

  test('sortArtifactEntries name mode sorts alphabetically by name', () => {
    const entries: [string, ArtifactInfo][] = [
      ['z_var', { type: 'str', preview: 'z', raw: 'z' }],
      ['a_var', { type: 'str', preview: 'a', raw: 'a' }],
      ['m_var', { type: 'str', preview: 'm', raw: 'm' }],
    ];
    const sorted = sortArtifactEntries(entries, 'name');
    assert.strictEqual(sorted[0][0], 'a_var');
    assert.strictEqual(sorted[1][0], 'm_var');
    assert.strictEqual(sorted[2][0], 'z_var');
  });

  test('sortArtifactEntries type mode sorts alphabetically by type', () => {
    const entries: [string, ArtifactInfo][] = [
      ['a', { type: 'str', preview: '', raw: '' }],
      ['b', { type: 'int', preview: '', raw: '' }],
      ['c', { type: 'float', preview: '', raw: '' }],
    ];
    const sorted = sortArtifactEntries(entries, 'type');
    assert.strictEqual(sorted[0][1].type, 'float');
    assert.strictEqual(sorted[1][1].type, 'int');
    assert.strictEqual(sorted[2][1].type, 'str');
  });

  test('sortArtifactEntries default mode preserves insertion order', () => {
    const entries: [string, ArtifactInfo][] = [
      ['b_var', { type: 'str', preview: 'b', raw: 'b' }],
      ['a_var', { type: 'str', preview: 'a', raw: 'a' }],
    ];
    const sorted = sortArtifactEntries(entries, 'default');
    assert.strictEqual(sorted[0][0], 'b_var');
    assert.strictEqual(sorted[1][0], 'a_var');
  });

  // --- setRunFilter stored value ---

  test('setRunFilter stores the new filter value', () => {
    provider.setRunFilter('failed');
    assert.strictEqual(provider.getRunFilter(), 'failed');
    provider.setRunFilter('successful');
    assert.strictEqual(provider.getRunFilter(), 'successful');
    provider.setRunFilter('all');
    assert.strictEqual(provider.getRunFilter(), 'all');
  });

  // --- Cache concurrency ---

  test('concurrent getChildren(undefined) returns same promise reference', () => {
    const p1 = provider.getChildren(undefined);
    const p2 = provider.getChildren(undefined);
    const p3 = provider.getChildren(undefined);
    assert.strictEqual(p1, p2, 'Second call should return same promise');
    assert.strictEqual(p2, p3, 'Third call should return same promise');
    return p1; // wait for it to resolve so teardown is clean
  });
});
