import { parentPort } from "node:worker_threads";
import { ParserRegistry } from "./ParserRegistry";
import { TypeScriptJavaScriptParser } from "./TypeScriptJavaScriptParser";
import type { SemanticProjectRequest } from "./SemanticModel";

const registry = new ParserRegistry([new TypeScriptJavaScriptParser()]);
const parser = registry.forLanguage("typescript");
if (!parser) throw new Error("No TypeScript/JavaScript semantic parser is registered.");
const cancelled = new Set<number>();

parentPort?.on("message", async (message: unknown) => {
  if (
    !message ||
    typeof message !== "object" ||
    !("id" in message) ||
    typeof message.id !== "number" ||
    !("type" in message)
  )
    return;
  if (message.type === "cancel") {
    cancelled.add(message.id);
    return;
  }
  if (message.type !== "extract" || !("request" in message)) return;
  try {
    const result = await parser.extract(message.request as SemanticProjectRequest);
    if (!cancelled.delete(message.id))
      parentPort?.postMessage({ id: message.id, ok: true, result });
  } catch (cause) {
    parentPort?.postMessage({
      id: message.id,
      ok: false,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
});
