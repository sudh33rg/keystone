import { randomUUID } from "node:crypto";
import { open, mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { KeystoneError } from "../../shared/errors/KeystoneError";

export interface AtomicFileOperations {
  mkdir(path: string): Promise<void>;
  writeAndSync(path: string, value: AsyncIterable<string | Uint8Array>): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  syncDirectory(path: string): Promise<void>;
}

const nodeOperations: AtomicFileOperations = {
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  },
  async writeAndSync(path, value) {
    const handle = await open(path, "wx", 0o600);
    try {
      for await (const chunk of value) {
        if (typeof chunk === "string") await handle.writeFile(chunk, "utf8");
        else await handle.writeFile(chunk);
      }
      await handle.sync();
    } finally {
      await handle.close();
    }
  },
  async rename(from, to) {
    await rename(from, to);
  },
  async remove(path) {
    await rm(path, { force: true });
  },
  async syncDirectory(path) {
    try {
      const handle = await open(path, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch {
      // Some platforms do not permit fsync on directory handles.
    }
  }
};

export class AtomicFileWriter {
  constructor(private readonly operations: AtomicFileOperations = nodeOperations) {}

  async writeJson(path: string, value: unknown, beforeCommit?: () => void): Promise<void> {
    await this.write(path, serializeJsonYielding(value), beforeCommit);
  }

  async write(path: string, value: AsyncIterable<string | Uint8Array>, beforeCommit?: () => void): Promise<void> {
    const directory = dirname(path);
    const temporaryPath = `${path}.${randomUUID()}.pending`;
    await this.operations.mkdir(directory);
    try {
      await this.operations.writeAndSync(temporaryPath, value);
      beforeCommit?.();
      await this.operations.rename(temporaryPath, path);
      await this.operations.syncDirectory(directory);
    } catch (cause) {
      await this.operations.remove(temporaryPath).catch(() => undefined);
      throw new KeystoneError({
        code: "INTELLIGENCE_ATOMIC_WRITE_FAILED",
        category: "PERSISTENCE",
        message: "Keystone could not atomically publish repository intelligence.",
        technicalDetails: cause instanceof Error ? cause.message : String(cause),
        operation: "intelligence.store.write",
        recoverable: true,
        recommendedAction: "Check extension storage permissions and retry the repository scan.",
        retryable: true,
        cause
      });
    }
  }
}

async function* serializeJsonYielding(value: unknown): AsyncGenerator<string> {
  let visited = 0;
  async function* visit(item: unknown): AsyncGenerator<string> {
    visited += 1;
    if (visited % 200 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    if (Array.isArray(item)) {
      yield "[";
      for (let index = 0; index < item.length; index++) {
        if (index > 0) yield ",";
        yield* visit(item[index]);
      }
      yield "]";
      return;
    }
    if (item && typeof item === "object") {
      yield "{";
      let first = true;
      for (const [key, child] of Object.entries(item)) {
        if (child === undefined || typeof child === "function" || typeof child === "symbol") continue;
        if (!first) yield ",";
        first = false;
        yield JSON.stringify(key);
        yield ":";
        yield* visit(child);
      }
      yield "}";
      return;
    }
    const serialized = JSON.stringify(item);
    yield serialized === undefined ? "null" : serialized;
  }
  yield* visit(value);
}
