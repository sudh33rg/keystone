import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

import { commands, extensions, workspace } from "vscode";

export async function run(): Promise<void> {
  const runStartedAt = Date.now();
  const extension = extensions.all.find((candidate) => candidate.packageJSON?.name === "keystone");
  assert.ok(extension, "Keystone VSCode extension should be discoverable by package name.");
  await extension.activate();

  const registeredCommands = await commands.getCommands(true);

  assert.ok(
    registeredCommands.includes("keystone.focusVscode"),
    "keystone.focusVscode should be registered."
  );
  assert.ok(
    registeredCommands.includes("keystone.indexRepo"),
    "keystone.indexRepo should be registered."
  );
  assert.ok(
    registeredCommands.includes("keystone.analyzeTask"),
    "keystone.analyzeTask should be registered."
  );

  const testWorkspace = process.env.KEYSTONE_TEST_WORKSPACE;
  if (testWorkspace) {
    assert.ok(
      workspace.workspaceFolders?.length,
      "The automatic-index test workspace should be open."
    );
    const manifest = path.join(testWorkspace, ".keystone", "intelligence", "manifest.json");
    const deadline = Date.now() + 20_000;
    const isFreshManifest = (): boolean => {
      if (!fs.existsSync(manifest)) return false;
      try {
        return Date.parse(JSON.parse(fs.readFileSync(manifest, "utf8")).updatedAt) >= runStartedAt;
      } catch {
        return false;
      }
    };
    while (!isFreshManifest() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assert.ok(
      isFreshManifest(),
      "Opening a repository should create fresh persisted intelligence without a manual command."
    );
    const workerOutputs = ["qa", "security", "performance", "modernization"].map((name) =>
      path.join(testWorkspace, ".keystone", "background", `${name}.json`)
    );
    const workersDeadline = Date.now() + 20_000;
    while (
      workerOutputs.some(
        (file) => !fs.existsSync(file) || fs.statSync(file).mtimeMs < runStartedAt
      ) &&
      Date.now() < workersDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    for (const file of workerOutputs)
      assert.ok(
        fs.existsSync(file) && fs.statSync(file).mtimeMs >= runStartedAt,
        `${path.basename(file)} should be produced by its repository-open worker.`
      );
    const secondWorkspace = process.env.KEYSTONE_SECOND_WORKSPACE;
    if (secondWorkspace) {
      assert.equal(
        workspace.workspaceFolders?.length,
        2,
        "Both folders in a multi-root workspace should be active."
      );
      const secondOutputs = [
        path.join(secondWorkspace, ".keystone", "intelligence", "manifest.json"),
        ...["qa", "security", "performance", "modernization"].map((name) =>
          path.join(secondWorkspace, ".keystone", "background", `${name}.json`)
        )
      ];
      const secondDeadline = Date.now() + 20_000;
      while (
        secondOutputs.some(
          (file) => !fs.existsSync(file) || fs.statSync(file).mtimeMs < runStartedAt
        ) &&
        Date.now() < secondDeadline
      )
        await new Promise((resolve) => setTimeout(resolve, 250));
      for (const file of secondOutputs)
        assert.ok(
          fs.existsSync(file) && fs.statSync(file).mtimeMs >= runStartedAt,
          `${file} should be generated independently for the second workspace root.`
        );
    }
    const flows = await commands.executeCommand<{
      qa: { mode: string; sources: number; tests: number; gaps: number };
      modernization: {
        coveragePercent: number;
        phases: number;
        specifications: number;
        decisionSource: string;
        taskWorkspaceCreated: boolean;
      };
    }>("keystone.__flowDiagnostics");
    assert.equal(flows.qa.mode, "quick", "Background QA should produce a quick-scan result.");
    assert.ok(flows.qa.sources > 0, "QA should inspect source files in the opened workspace.");
    assert.equal(
      flows.modernization.coveragePercent,
      100,
      "Modernization should cover the complete repository model."
    );
    assert.ok(
      flows.modernization.phases > 0,
      "Modernization should generate migration phases after acceptance."
    );
    assert.equal(
      flows.modernization.specifications,
      flows.modernization.phases,
      "Every modernization phase should have a detailed specification."
    );
    assert.equal(
      flows.modernization.decisionSource,
      "keystone-recommendation",
      "The diagnostic acceptance should be recorded."
    );
    assert.equal(
      flows.modernization.taskWorkspaceCreated,
      true,
      "Accepted modernization should materialize its complete numbered task workspace."
    );
    assert.ok(
      fs.existsSync(path.join(testWorkspace, ".keystone", "modernization", "proposal.json")),
      "Modernization proposal output should be persisted."
    );
    assert.ok(
      fs.existsSync(path.join(testWorkspace, ".keystone", "modernization", "plan.json")),
      "Modernization plan output should be persisted."
    );
    const lifecycle = await commands.executeCommand<{
      promptGrounded: boolean;
      activeFileIncluded: boolean;
      provider: string;
      delegated: boolean;
      copilotChatOpened: boolean;
      sessionRestored: boolean;
      checksumVerified: boolean;
      taskWorkspaceCreated: boolean;
      handoffExported: boolean;
      completedWorkspaceRemoved: boolean;
      restoredTaskWorkspaceCreated: boolean;
      restoredTaskReshared: boolean;
      route: string;
      securityRisk: string;
      performanceRisk: string;
      modernizationNotes: number;
      qaChecks: number;
    }>(
      "keystone.__lifecycleDiagnostics",
      process.env.KEYSTONE_TEST_INTENT,
      process.env.KEYSTONE_TEST_CURRENT_FILE
    );
    assert.equal(
      lifecycle.promptGrounded,
      true,
      "The delegated prompt should be grounded in repository Intelligence."
    );
    assert.equal(
      lifecycle.activeFileIncluded,
      true,
      "The explicitly active repository file should be included in the enhanced prompt context."
    );
    assert.ok(
      lifecycle.provider.length > 0,
      "Intent refinement should report the local provider or Copilot fallback."
    );
    assert.equal(
      lifecycle.delegated,
      true,
      "Approved delegation should place the exact grounded prompt on the Copilot handoff clipboard."
    );
    assert.equal(
      lifecycle.copilotChatOpened,
      true,
      "Approved delegation should open the VS Code Copilot Chat surface with the grounded query."
    );
    assert.equal(
      lifecycle.checksumVerified,
      true,
      "Shared session state should survive encryption with valid integrity."
    );
    assert.equal(
      lifecycle.sessionRestored,
      true,
      "Shared session state should restore into VS Code workspace state."
    );
    assert.equal(
      lifecycle.taskWorkspaceCreated,
      true,
      "Intent analysis should create an atomic numbered task workspace with no temporary files left behind."
    );
    assert.equal(
      lifecycle.handoffExported,
      true,
      "Handoff should copy task workspace artifacts into the target repository."
    );
    assert.equal(
      lifecycle.completedWorkspaceRemoved,
      true,
      "Completion should archive a tombstone and delete the temporary task folder."
    );
    assert.equal(
      lifecycle.restoredTaskWorkspaceCreated,
      true,
      "A verified handoff should become a numbered active task workspace."
    );
    assert.equal(
      lifecycle.restoredTaskReshared,
      true,
      "A restored task should be shareable again without losing its delegation artifacts."
    );
    assert.ok(
      ["copilot", "hybrid", "human-review"].includes(lifecycle.route),
      `The approved implementation should route to Copilot, hybrid, or human review; received ${lifecycle.route}.`
    );
    assert.ok(
      ["low", "medium", "high"].includes(lifecycle.securityRisk),
      "Intent analysis should produce a security result."
    );
    assert.ok(
      ["low", "medium", "high"].includes(lifecycle.performanceRisk),
      "Intent analysis should produce a performance result."
    );
    assert.ok(
      lifecycle.modernizationNotes > 0,
      "Intent analysis should produce modernization guidance."
    );
    assert.ok(lifecycle.qaChecks > 0, "Intent analysis should produce QA checks.");
  } else {
    assert.equal(
      workspace.workspaceFolders,
      undefined,
      "VSCode extension smoke test should run without an open workspace."
    );
  }

  for (const command of [
    "keystone.focusVscode",
    ...(testWorkspace ? [] : ["keystone.indexRepo"])
  ]) {
    await assert.doesNotReject(
      async () => commands.executeCommand(command),
      `${command} should return cleanly without an open workspace.`
    );
  }

  await commands.executeCommand("keystone.focusVscode");
  let diagnostics = await commands.executeCommand<{
    hasPanel: boolean;
    htmlLength: number;
    webviewReady: boolean;
  }>("keystone.__viewDiagnostics");
  const readyDeadline = Date.now() + 10_000;
  while (!diagnostics.webviewReady && Date.now() < readyDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    diagnostics = await commands.executeCommand("keystone.__viewDiagnostics");
  }
  assert.equal(
    diagnostics.hasPanel,
    true,
    "Opening Keystone should create the full editor-area application panel."
  );
  assert.ok(
    diagnostics.htmlLength > 500,
    "The resolved VS Code webview should receive the complete application HTML."
  );
  assert.equal(
    diagnostics.webviewReady,
    true,
    "The webview JavaScript should mount and report ready inside VS Code."
  );

  if (process.env.KEYSTONE_VISUAL_HOLD === "1") {
    await new Promise((resolve) => setTimeout(resolve, 20_000));
  }
}
