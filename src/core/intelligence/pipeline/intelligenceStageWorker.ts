import { parentPort } from "node:worker_threads";
import { runIntelligenceStage, type SerializedStageContext } from "./pipeline";

if (!parentPort) throw new Error("Intelligence stage worker requires a parent port.");

parentPort.once(
  "message",
  async (message: { stageId: string; context: SerializedStageContext }) => {
    try {
      const result = await runIntelligenceStage(message.stageId, message.context);
      parentPort!.postMessage({ ok: true, result });
    } catch (error) {
      parentPort!.postMessage({
        ok: false,
        error: error instanceof Error ? (error.stack ?? error.message) : String(error)
      });
    } finally {
      parentPort!.close();
    }
  }
);
