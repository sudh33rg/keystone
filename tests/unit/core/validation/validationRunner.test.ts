import { describe, expect, it } from '../../../support/testkit';

import { runValidationCommand } from "@core/workflow/validation/validationRunner";

describe("runValidationCommand", () => {
  it("returns passed for zero exit code", async () => {
    await expect(
      runValidationCommand("npm test", "/repo", 1000, async () => ({
        exitCode: 0,
        stdout: "Tests  4 passed",
        stderr: ""
      }))
    ).resolves.toMatchObject({
      status: "passed",
      command: "npm test",
      stdout: "Tests  4 passed",
      summary: { testsPassed: 4 }
    });
  });

  it("returns failed for non-zero exit code", async () => {
    await expect(
      runValidationCommand("npm test", "/repo", 1000, async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "fail"
      }))
    ).resolves.toMatchObject({ status: "failed", exitCode: 1, stderr: "fail" });
  });
});
