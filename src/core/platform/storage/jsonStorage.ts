import fs from "node:fs/promises";
import path from "node:path";

export class JsonStorage<T> {
  constructor(
    private readonly workspaceRoot: string,
    private readonly relativePath: string,
    private readonly fallback: T
  ) {}

  async read(): Promise<T> {
    const absolutePath = path.join(this.workspaceRoot, this.relativePath);
    try {
      const raw = await fs.readFile(absolutePath, "utf8");
      try {
        return JSON.parse(raw) as T;
      } catch {
        // Corrupted file — return fallback (the read() contract is to return a valid result).
        return this.fallback;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return this.fallback;
      }
      throw error;
    }
  }

  async write(value: T): Promise<void> {
    const absolutePath = path.join(this.workspaceRoot, this.relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
}

export async function ensureKeystoneDirectory(workspaceRoot: string): Promise<void> {
  await fs.mkdir(path.join(workspaceRoot, ".keystone"), { recursive: true });
}
