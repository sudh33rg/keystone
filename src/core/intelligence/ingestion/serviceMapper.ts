import path from "node:path";

import type { ServiceNode } from "../../domain/types";
import { isTestPath } from "./testMapper";

export function mapService(filePath: string): ServiceNode | undefined {
  if (isTestPath(filePath)) return undefined;
  const lower = filePath.toLowerCase();
  if (!/(service|controller|handler|repository|client|adapter)/.test(lower)) {
    return undefined;
  }
  const name = path.posix.basename(filePath).replace(/\.[^.]+$/, "");
  const hints = lower.split(/[\/._-]/).filter((part) =>
    ["service", "controller", "handler", "repository", "client", "adapter", "payment", "audit", "user", "auth"].includes(part)
  );
  return { name, filePath, hints };
}
