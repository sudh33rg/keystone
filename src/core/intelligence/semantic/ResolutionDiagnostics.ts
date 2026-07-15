import type { IntelligenceDiagnostic, SourceRange } from "../../../shared/contracts/intelligence";
import { IntelligenceIdFactory } from "./IntelligenceIdFactory";

export class ResolutionDiagnostics {
  private readonly values = new Map<string, IntelligenceDiagnostic>();
  constructor(private readonly ids = new IntelligenceIdFactory()) {}

  add(code: string, message: string, ownerFileId: string, workspaceRootId: string, relativePath: string, range?: SourceRange, entityId?: string, severity: IntelligenceDiagnostic["severity"] = "warning"): void {
    const id = this.ids.create("diagnostic", code, ownerFileId, range?.startLine, range?.startColumn, entityId);
    this.values.set(id, {
      id,
      code,
      severity,
      message,
      ownerFileId,
      workspaceRootId,
      relativePath,
      ...(range ? { range } : {}),
      ...(entityId ? { entityId } : {}),
      extractorId: "keystone.typescript"
    });
  }

  all(): IntelligenceDiagnostic[] { return [...this.values.values()]; }
}
