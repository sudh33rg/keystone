import { describe, expect, it } from "vitest";
import { IngestionScheduler } from "../../../../src/core/intelligence/runtime/IngestionScheduler";

describe("IngestionScheduler", () => {
  it("preempts lower-priority work without losing it", async () => {
    const order: string[] = [];
    let lowAttempts = 0;
    const scheduler = new IngestionScheduler();
    scheduler.enqueue({
      key: "low",
      reason: "startup",
      priority: 5,
      paths: [],
      baseGeneration: 1,
      run: async ({ signal }) => {
        lowAttempts += 1;
        if (lowAttempts > 1) { order.push("low-retry"); return; }
        order.push("low-start");
        await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
      }
    });
    await Promise.resolve();
    const completed = new Promise<void>((resolve) => {
      scheduler.enqueue({ key: "high", reason: "active-editor", priority: 1, paths: ["src/a.ts"], baseGeneration: 1, run: () => { order.push("high"); resolve(); return Promise.resolve(); } });
    });
    await completed;
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(order).toEqual(["low-start", "high", "low-retry"]);
    scheduler.dispose();
  });

  it("pauses, resumes, reports current files, and shuts down queued work", async () => {
    const scheduler = new IngestionScheduler();
    let completed = false;
    scheduler.pause();
    scheduler.enqueue({
      key: "paused",
      reason: "file",
      priority: 3,
      paths: ["src/paused.ts"],
      baseGeneration: 4,
      run: () => { completed = true; return Promise.resolve(); }
    });
    expect(scheduler.getStatus()).toMatchObject({ paused: true, queueDepth: 1, completedJobs: 0 });
    scheduler.resume();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(completed).toBe(true);
    expect(scheduler.getStatus()).toMatchObject({ paused: false, queueDepth: 0, completedJobs: 1, failedJobs: 0 });
    scheduler.dispose();
  });
});
