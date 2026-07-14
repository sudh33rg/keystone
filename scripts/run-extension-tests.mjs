import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  await runTests({
    version: "1.95.0",
    extensionDevelopmentPath: projectRoot,
    extensionTestsPath: path.join(projectRoot, "dist", "extension-tests", "index.js"),
    launchArgs: [
      "--disable-extensions",
      "--skip-welcome",
      "--skip-release-notes",
      "--user-data-dir=/tmp/keystone-vscode-test-user-data"
    ]
  });
} catch (error) {
  console.error("Keystone Extension Host tests failed.", error);
  process.exitCode = 1;
}
