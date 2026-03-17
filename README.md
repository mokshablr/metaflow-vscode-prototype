# Metaflow VS Code Extension

A prototype VS Code extension for Metaflow that adds visual tooling on top of the existing [metaflow-dev-vscode](https://github.com/outerbounds/metaflow-dev-vscode) extension (which only had two keyboard shortcuts). The goal was to see how much of the Metaflow workflow (running flows, browsing artifacts, visualizing DAGs, monitoring runs) could be brought into the editor without switching to a browser or terminal.

## Features

### Flow Execution

- **Run Flow** (`Ctrl+Alt+R`): runs the current flow file in an output channel
- **Spin Step** (`Ctrl+Alt+S`): runs a single step; detects which step the cursor is in automatically

Saves the file before running. The run output is parsed line-by-line to pick up the run ID as soon as it appears, which is what kicks off automatic monitoring.

### Metaflow Explorer (Sidebar)

Tree view in the Explorer panel showing Flows → Runs → Steps → Tasks → Artifacts. Children are loaded on demand and cached so expanding/collapsing doesn't re-fetch. Each node shows status (done/running/failed) and artifacts show an inline type + value preview.

Right-click actions on artifacts: copy value, export as JSON. Right-click on a run: delete (with confirmation).

You can also filter runs (all / successful / failed) and sort artifacts (default / alphabetical / by type).

### DAG Visualization

- **Show DAG** (`Ctrl+Alt+D`): opens a webview with the flow rendered as an interactive graph
  - Nodes are color-coded by step type (start, end, split, join, foreach, linear)
  - Click a node to jump to that step's definition in the source file
  - Auto-refreshes 400 ms after saving the flow file
  - When a run is being monitored, node colors update live to reflect step progress

### Live Run Monitor

- **Monitor Run** (`Ctrl+Alt+M`): opens a status panel showing each step as the run progresses
  - Polls every 2 s while a step is running, slows to 5 s when nothing is active
  - Shows steps in topological order (BFS from `start`), including pending steps that haven't started yet
  - Stops automatically when the run finishes

---

## Design Decisions

Notes on some of the non-obvious choices made while building this.

### Python bridge: subprocess + JSON

The extension talks to Metaflow through small Python helper scripts in `python/`. Each script is called as a subprocess and writes JSON to stdout. Errors come back as `{"error": "..."}` objects rather than non-zero exit codes, which made error handling on the TypeScript side much cleaner.

I considered keeping a persistent Python server running in the background instead, but it felt like overkill. You'd need to handle startup, crashes, port conflicts, and cleanup. The subprocess-per-call approach is simpler and the scripts are easy to test in isolation by just running them from the command line.

The main downside is Python startup time on each call (~200–400 ms). For user-initiated actions like expanding a tree node this is fine, but it would be a problem for anything that needs to feel instant.

### Running flows: `spawn` instead of a VS Code terminal

The original extension ran flows by sending commands to a VS Code terminal. I switched to `child_process.spawn` writing to an OutputChannel instead.

The reason is monitoring: to auto-start the run monitor, the extension needs to detect the run ID from Metaflow's output (it appears in a line like `run-id: 1234`). With a terminal you can't read stdout programmatically. With `spawn` you can scan each line as it arrives and fire the `onRunStarted` event as soon as the run ID shows up, before the flow has even finished its first step.

### DAG parsed from AST, not by importing the flow

`get_dag.py` parses the flow file with Python's `ast` module to find step definitions and their edges. It never imports or runs the flow.

I tried the import approach first (it's simpler) but it broke on any flow that had missing dependencies or side effects at import time. Parsing the AST is a bit more work but it's safe, fast, and doesn't care whether the user's environment has everything installed.

### Cytoscape.js for the DAG view

I looked at D3, Mermaid, and Cytoscape before picking one.

Mermaid was the quickest to get something on screen, but it renders a static diagram from a string and doesn't expose click events on individual nodes. For the "click to navigate to step" feature I'd have had to overlay invisible HTML elements on top of an SVG, which felt fragile.

D3 is more flexible but it's a general visualization library, so building a proper directed graph layout with it means writing a lot of code that Cytoscape already has. I didn't want to spend the whole project on graph layout math.

Cytoscape has a plugin (cytoscape-dagre) that produces the top-to-bottom ranked layout that matches how Metaflow DAGs look naturally. Click events work directly on nodes, and updating node styles for live run status is just adding/removing CSS classes on elements. It does what I needed without much ceremony.

### One DAG panel, updated in place

Only one DAG panel exists at a time. Calling `Show DAG` again reveals the existing panel and sends the new data via `postMessage` instead of rebuilding the HTML.

Rebuilding the HTML reloads the whole webview context, which means re-fetching Cytoscape from unpkg and re-initializing the graph. Sending a message updates the graph in place. This also means the live run status updates use the exact same code path as switching between flow files, which kept things simpler.

### `setTimeout` chain for polling

The run monitor uses a `setTimeout` chain (each poll schedules the next one after it finishes) rather than `setInterval`.

`setInterval` fires on a fixed wall-clock schedule regardless of whether the previous call is done. If a Metaflow metadata query takes longer than the interval, you end up with overlapping requests and out-of-order state updates. The `setTimeout` chain waits for each poll to complete before scheduling the next one. It also makes it easy to change the interval on the fly (2 s when something is running, 5 s otherwise) without stopping and restarting a timer.

### Lazy loading + caching in the tree

Children in the tree are loaded on demand and the result is cached by pathspec (e.g. `LinearFlow/1234/start`). The cache is cleared when the user explicitly refreshes.

Without caching, rapidly expanding and collapsing a node would spawn duplicate Python processes. What I actually cache is the `Promise`, not the result, so if VS Code calls `getChildren` twice in quick succession for the same node (which it can do), they both wait on the same in-flight request rather than starting two.

---

## Installation (Development)

1. Clone this repository
2. `npm install`
3. Open in VS Code and press **F5** to launch the Extension Development Host

## Running Tests

```bash
npm test
```

Uses `@vscode/test-electron` (downloaded automatically on first run). Tests that require Metaflow are skipped if it's not installed.

### Test coverage

| Suite | What's tested |
|-------|--------------|
| Extension Activation | Extension loads, all commands registered |
| MetaflowTreeProvider | Cache/event behavior, sort cycle, filter state, node properties (icons, labels, tooltips, context values), `sortArtifactEntries` |
| DAG Viewer | `generateHtml` output, webview panel creation, Python script extraction, error handling |
| Run Deletion | `delete_run.py` removes directory correctly; error on missing run |
| Step Navigation | Cursor navigation to step definitions |
| Python Integration | `get_data.py` and `get_dag.py` schema validation end-to-end; error paths for invalid inputs |
| Python Process Spawning | Large stdout buffering, stderr capture, timeout, ENOENT handling |
| Run Monitor | Polling logic, adaptive intervals, completion detection, error cap |

## Building a `.vsix` package

```bash
npm install -g @vscode/vsce
vsce package
code --install-extension metaflow-vscode-prototype-0.2.0.vsix
```

## Roadmap

- One-click debug configuration (auto-generate `.vscode/launch.json` for any step)
- Run launcher with parameter and backend selection (local / Kubernetes / AWS Batch)
- Inline card preview
