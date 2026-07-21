import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { IntelligenceStore } from "../../../src/core/persistence/IntelligenceStore";
import { intelligenceSnapshot } from "./fixtures";
import { WorkerPoolManager } from "../../../src/core/intelligence/runtime/WorkerPoolManager";

describe("IntelligenceStore", () => {
  const directories: string[] = [];
  afterEach(async () =>
    Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))),
  );

  it("atomically persists and reloads the complete snapshot", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-intelligence-"));
    directories.push(root);
    const store = new IntelligenceStore(root);
    await store.save(intelligenceSnapshot());

    const restored = new IntelligenceStore(root);
    expect((await restored.initialize())?.files[0]?.relativePath).toBe("src/index.ts");
    expect(restored.getSnapshot()?.relationships).toHaveLength(1);
    expect(
      JSON.parse(await readFile(join(root, "intelligence", "current.json"), "utf8")),
    ).toMatchObject({ generation: 1, directory: "000001" });
    expect(
      JSON.parse(
        await readFile(
          join(root, "intelligence", "generations", "000001", "manifest.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({ generation: 1 });
  });

  it("retains the last complete snapshot when publication becomes stale", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-intelligence-"));
    directories.push(root);
    const store = new IntelligenceStore(root);
    await store.save(intelligenceSnapshot(1));
    await expect(
      store.save(intelligenceSnapshot(2), () => {
        throw new Error("stale scan");
      }),
    ).rejects.toMatchObject({ code: "INTELLIGENCE_ATOMIC_WRITE_FAILED" });
    expect(store.getSnapshot()?.manifest.generation).toBe(1);
    expect((await new IntelligenceStore(root).initialize())?.manifest.generation).toBe(1);
  });

  it("serializes overlapping immutable generation publications", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-intelligence-"));
    directories.push(root);
    const store = new IntelligenceStore(root);
    await Promise.all([store.save(intelligenceSnapshot(1)), store.save(intelligenceSnapshot(2))]);
    expect(store.getSnapshot()?.manifest.generation).toBe(2);
    expect((await readdir(join(root, "intelligence", "generations"))).sort()).toEqual([
      "000001",
      "000002",
    ]);
    store.dispose();
  });

  it("rejects entities whose evidence supports a different subject", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-intelligence-"));
    directories.push(root);
    const snapshot = intelligenceSnapshot();
    snapshot.evidence[1]!.subjectId = "file:somewhere-else";
    await expect(new IntelligenceStore(root).save(snapshot)).rejects.toThrow(/does not support/);
  });

  it("retains immutable generations and recovers from a corrupt current pointer", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-intelligence-"));
    directories.push(root);
    const store = new IntelligenceStore(root);
    await store.save(intelligenceSnapshot(1));
    await store.save(intelligenceSnapshot(2));
    expect((await readdir(join(root, "intelligence", "generations"))).sort()).toEqual([
      "000001",
      "000002",
    ]);
    await writeFile(join(root, "intelligence", "current.json"), "not-json", "utf8");

    const recovered = new IntelligenceStore(root);
    expect((await recovered.initialize())?.manifest.generation).toBe(2);
    expect(
      JSON.parse(await readFile(join(root, "intelligence", "current.json"), "utf8")),
    ).toMatchObject({ generation: 2, directory: "000002" });
    recovered.dispose();
  });

  it("keeps the last generation readable and reports manual intelligence deletion", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-intelligence-"));
    directories.push(root);
    const store = new IntelligenceStore(root);
    await store.initialize();
    await store.save(intelligenceSnapshot(1));
    const deleted = new Promise<void>((resolve) => store.onDidDelete(resolve));

    await rm(join(root, "intelligence"), { recursive: true, force: true });
    await Promise.race([
      deleted,
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("Intelligence deletion was not observed.")), 2_000),
      ),
    ]);

    expect(store.getSnapshot()?.manifest.generation).toBe(1);
    store.dispose();
  });

  it("reports a missing active shard as damaged while retaining the in-memory generation", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-intelligence-"));
    directories.push(root);
    const store = new IntelligenceStore(root);
    await store.initialize();
    await store.save(intelligenceSnapshot(1));
    const damaged = new Promise<void>((resolve) => store.onDidDelete(resolve));
    await rm(join(root, "intelligence", "generations", "000001", "files.json.gz"));

    const health = await store.checkHealth();
    expect(health.status).toBe("damaged");
    expect(health.message).toContain("files.json.gz");
    await damaged;
    expect(store.getSnapshot()?.manifest.generation).toBe(1);
    store.dispose();
  });

  it("detects corruption of an active compressed shard", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-intelligence-"));
    directories.push(root);
    const store = new IntelligenceStore(root);
    await store.initialize();
    await store.save(intelligenceSnapshot(1));
    await writeFile(
      join(root, "intelligence", "generations", "000001", "evidence.json.gz"),
      "corrupt",
      "utf8",
    );
    await expect(store.checkHealth()).resolves.toMatchObject({ status: "damaged" });
    expect(store.getSnapshot()?.evidence.length).toBeGreaterThan(0);
    store.dispose();
  });

  it("cleans interrupted pending generations and hard-links unchanged shards", async () => {
    const root = await mkdtemp(join(tmpdir(), "keystone-intelligence-"));
    directories.push(root);
    const workers = new WorkerPoolManager(1, 1);
    const store = new IntelligenceStore(root, undefined, workers, 3);
    await store.save(intelligenceSnapshot(1));
    await store.save(intelligenceSnapshot(2));
    const first = await stat(
      join(root, "intelligence", "generations", "000001", "diagnostics.json.gz"),
    );
    const second = await stat(
      join(root, "intelligence", "generations", "000002", "diagnostics.json.gz"),
    );
    expect(second.ino).toBe(first.ino);
    await mkdir(join(root, "intelligence", "generations", "000003.pending"));
    store.dispose();

    const restored = new IntelligenceStore(root, undefined, workers, 3);
    await restored.initialize();
    expect(await readdir(join(root, "intelligence", "generations"))).not.toContain(
      "000003.pending",
    );
    restored.dispose();
    await workers.dispose();
  });
});
