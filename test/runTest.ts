import * as path from 'path';
import * as os from 'os';
import { runTests } from '@vscode/test-electron';

async function main() {
  try {
    const extensionDevelopmentPath = path.resolve(__dirname, '../../');
    const extensionTestsPath = path.resolve(__dirname, './suite/index');
    const testWorkspace = path.resolve(__dirname, '../../fixtures');

    // Use a short temp path for user-data to avoid IPC socket path length limits
    const userDataDir = path.join(os.tmpdir(), 'mf-vsc-test');

    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        testWorkspace,
        '--disable-extensions',
        `--user-data-dir=${userDataDir}`,
      ],
    });
  } catch (err) {
    console.error('Failed to run tests:', err);
    process.exit(1);
  }
}

main();
