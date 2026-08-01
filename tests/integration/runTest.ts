import path from "node:path";

import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, "..", "..", "..", "..");
  const extensionTestsPath = path.resolve(__dirname, "suite", "index");

  const workspacePath = process.env.KEYSTONE_TEST_LAUNCH_PATH ?? process.env.KEYSTONE_TEST_WORKSPACE;
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: ["--disable-extensions", ...(workspacePath ? [workspacePath] : [])]
  });
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
