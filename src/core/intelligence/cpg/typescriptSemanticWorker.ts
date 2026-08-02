import { parentPort } from "node:worker_threads";
import { analyzeTypeScriptProject } from "./typescriptSemantic";

if (!parentPort) throw new Error("TypeScript semantic worker requires a parent port.");

parentPort.once("message", (message: { workspaceRoot: string; sourcePaths: string[] }) => {
  try {
    const result = analyzeTypeScriptProject(
      message.workspaceRoot,
      message.sourcePaths,
      (progress) => parentPort!.postMessage({ type: "progress", message: progress })
    );
    parentPort!.postMessage({ ok: true, result });
  } catch (error) {
    parentPort!.postMessage({
      ok: false,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error)
    });
  } finally {
    parentPort!.close();
  }
});
