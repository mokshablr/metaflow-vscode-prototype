# Metaflow VS Code Extension

A TypeScript port of [metaflow-dev-vscode](https://github.com/outerbounds/metaflow-dev-vscode), laying the groundwork for a full-featured Metaflow IDE integration.

## Current Features

1. Develop a flow
2. Run the flow with **Ctrl + Alt + R**
3. Point at a step, edit it, and _spin_ it with **Ctrl + Alt + S** for quick results
4. Rinse and repeat 2–3

The extension automatically:

- Detects the enclosing function name (`def` or `async def`) above the cursor
- Saves the file before running
- Executes the command in the file's directory
- Reuses a shared terminal session

## Installation (Development)

1. Clone this repository
2. Install dependencies:

   ```bash
   npm install
   ```

3. Open the folder in VS Code and press **F5** to launch the Extension Development Host

## Building a `.vsix` package

```bash
npm install -g @vscode/vsce
vsce package
code --install-extension metaflow-vscode-prototype-0.1.0.vsix
```

## Roadmap

- Artifact browser — sidebar tree view of flows, runs, steps, tasks, and artifacts
- DAG visualization — interactive graph rendered from flow source
- One-click debug configuration
- Run launcher with parameter and backend selection
