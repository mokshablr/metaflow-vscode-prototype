# Metaflow VS Code Extension

A TypeScript port of [metaflow-dev-vscode](https://github.com/outerbounds/metaflow-dev-vscode), laying the groundwork for a full-featured Metaflow IDE integration.

## Features

### Flow Execution

- **Run Flow** (`Ctrl+Alt+R`) — executes the current Metaflow flow in an integrated terminal
- **Spin Step** (`Ctrl+Alt+S`) — runs a single step in isolation for fast iteration; auto-detects the enclosing step from cursor position

The extension automatically saves the file before running and reuses a shared terminal session in the flow's working directory.

### Metaflow Explorer (Sidebar)

A hierarchical tree view in the Explorer panel showing:

- **Flows → Runs → Steps → Tasks → Artifacts**
- Lazy-loaded children with caching to avoid redundant Python invocations
- Status indicators (done / running / failed) on steps and tasks
- Artifact type labels and inline value previews (e.g. `int: 42`)

#### Artifact actions (right-click)

- **Filter Runs** — show all, successful-only, or failed-only runs
- **Sort Artifacts** — cycle through default, alphabetical, or type-based sorting
- **Copy Artifact Value** — copies artifact data to clipboard
- **Export Artifact as JSON** — saves artifact to a file

### Run Management

- **Delete Run** (`metaflow.deleteRun`) — permanently removes a run's directory from the local `.metaflow` metadata store, with a confirmation dialog (local metadata provider only)

### DAG Visualization

- **Show DAG** (`Ctrl+Alt+D`) — opens an interactive webview rendering the flow's directed acyclic graph
  - Color-coded nodes by type: start (green), end (red), split (orange), join (blue), foreach (purple), linear (gray)
  - Click a node to jump to that step's definition in the source file
  - Auto-refreshes (400 ms debounce) when the flow file is saved

## Installation (Development)

1. Clone this repository
2. Install dependencies:

   ```bash
   npm install
   ```

3. Open the folder in VS Code and press **F5** to launch the Extension Development Host

## Running Tests

```bash
npm test
```

Tests require VS Code's test runner and will download it automatically on first run via `@vscode/test-electron`. If Metaflow is not installed in the active Python environment, tests that require it are skipped automatically.

### Test coverage

| Suite | What's tested |
|-------|--------------|
| Extension Activation | Extension loads, all commands registered |
| MetaflowTreeProvider | Initialization, cache/event behavior, sort cycle, filter state, node properties (icons, labels, tooltips, context values), `sortArtifactEntries` pure function |
| DAG Viewer | `generateHtml` output, webview panel creation, Python script extraction, error handling for invalid/missing files |
| Run Deletion | `delete_run.py` removes directory and returns correct JSON; error on missing run |
| Step Navigation | Editor cursor navigation to step definitions in fixture flow |
| Python Integration | `get_data.py` and `get_dag.py` schema contracts (run fixture flow end-to-end, validate full Flow→Run→Step→Task→Artifact shape); error paths for invalid pathspecs and missing metaflow |
| Python Process Spawning | Large stdout buffering, stderr capture, timeout kill, ENOENT handling, empty output safety |

## Building a `.vsix` package

```bash
npm install -g @vscode/vsce
vsce package
code --install-extension metaflow-vscode-prototype-0.2.0.vsix
```

## Roadmap

- One-click debug configuration
- Run launcher with parameter and backend selection
- Remote / cloud execution support
- Inline code decorations and diagnostics
