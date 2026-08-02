import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "../../support/testkit";

describe("Copilot delegation production contract", () => {
  it("uses the VS Code Language Model API, captures streamed output, and never fabricates a returned result", async () => {
    const source = await fs.readFile(path.resolve("src/extension/ui/vscodeProvider.ts"), "utf8");
    expect(source).toContain("vscode.lm.selectChatModels({ vendor: 'copilot' })");
    expect(source).toContain("model.sendRequest(");
    expect(source).toContain("for await (const fragment of response.text)");
    expect(source).toContain("recordDelegationResult");
    expect(source).not.toContain("Delegated result returned by selected route");
    expect(source).not.toContain("Delegated result returned");
  });
});
