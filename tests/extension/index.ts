import assert from "node:assert/strict";
import * as vscode from "vscode";

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension("keystone-dev.keystone");
  assert.ok(extension, "Keystone extension should be discoverable in the Extension Development Host");

  const startedAt = performance.now();
  await extension.activate();
  const activationDurationMs = performance.now() - startedAt;

  assert.equal(extension.isActive, true, "Keystone extension should activate successfully");
  assert.ok(activationDurationMs < 500, `Keystone activation should remain under 500 ms; measured ${activationDurationMs.toFixed(1)} ms`);

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("keystone.open"), "Keystone open command should be registered");
  assert.ok(commands.includes("keystone.showLogs"), "Keystone logs command should be registered");
}
