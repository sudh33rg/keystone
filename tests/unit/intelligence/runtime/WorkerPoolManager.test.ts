import { afterEach, describe, expect, it } from "vitest";
import { WorkerPoolManager } from "../../../../src/core/intelligence/runtime/WorkerPoolManager";

describe("WorkerPoolManager", () => {
  const pools: WorkerPoolManager[] = [];
  afterEach(async () => { await Promise.all(pools.splice(0).map((pool) => pool.dispose())); });

  it("keeps persistent worker capacity for hashing and JSON parsing", async () => {
    const pool = new WorkerPoolManager(2, 1);
    pools.push(pool);
    expect(pool.getStatus().capacity).toBe(3);
    expect(await pool.sha256(new TextEncoder().encode("keystone"))).toMatch(/^sha256:[a-f0-9]{64}$/);
    await expect(pool.parseJson('{"generation":2}')).resolves.toEqual({ generation: 2 });
    expect(pool.getStatus()).toMatchObject({ active: 0, queued: 0, capacity: 3 });
  });

  it("cancels active work and replaces failed workers without reducing capacity", async () => {
    const pool = new WorkerPoolManager(1, 1);
    pools.push(pool);
    const controller = new AbortController();
    const delayed = pool.delayForTest(5_000, { signal: controller.signal, priority: 3 });
    await new Promise<void>((resolve) => setImmediate(resolve));
    controller.abort();
    await expect(delayed).rejects.toMatchObject({ name: "AbortError" });
    await expect(pool.simulateFailureForTest()).rejects.toThrow(/exited|worker/i);
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(pool.getStatus()).toMatchObject({ capacity: 2, failedRestarts: 1 });
    await expect(pool.sha256(new TextEncoder().encode("recovered"))).resolves.toMatch(/^sha256:/);
  });

  it("keeps the host turn responsive during heavy hashing and shuts down cleanly", async () => {
    const pool = new WorkerPoolManager(1, 1);
    pools.push(pool);
    let hostTurnRan = false;
    const hashing = pool.sha256(new Uint8Array(8 * 1024 * 1024));
    await new Promise<void>((resolve) => setImmediate(() => { hostTurnRan = true; resolve(); }));
    expect(hostTurnRan).toBe(true);
    await hashing;

    const delayed = pool.delayForTest(5_000);
    const disposal = pool.dispose();
    await expect(delayed).rejects.toThrow(/disposed/);
    await disposal;
    expect(pool.getStatus()).toMatchObject({ active: 0, queued: 0, capacity: 0 });
    pools.splice(pools.indexOf(pool), 1);
  });
});
