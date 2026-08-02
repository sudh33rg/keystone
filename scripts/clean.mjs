import { rm } from "node:fs/promises";
await Promise.all(
  ["dist", "out", ".runtime-check", ".test-dist"].map((path) =>
    rm(path, { recursive: true, force: true })
  )
);
