import { createHash } from "node:crypto";
import type { CpgEdge, CpgEdgeType, CpgNode, CpgNodeKind } from "../../../shared/contracts/cpg";
import type { SourceRange } from "../../../shared/contracts/intelligence";

export class CpgNodeFactory {
  create(input: Omit<CpgNode, "id"> & { identity: string }): CpgNode {
    const { identity, ...node } = input;
    return { ...node, id: stable("cpg-node", input.scopeId, input.kind, identity) };
  }
}

export class CpgEdgeFactory {
  create(input: Omit<CpgEdge, "id"> & { discriminator?: string }): CpgEdge {
    const { discriminator, ...edge } = input;
    return {
      ...edge,
      id: stable(
        "cpg-edge",
        input.scopeId,
        input.type,
        input.sourceId,
        input.targetId,
        discriminator,
      ),
    };
  }
}

export function cpgStableId(prefix: string, ...parts: Array<string | number | undefined>): string {
  return stable(prefix, ...parts);
}

export function compactCode(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 500);
}

export function containsRange(outer: SourceRange, inner: SourceRange): boolean {
  return (
    comparePosition(outer.startLine, outer.startColumn, inner.startLine, inner.startColumn) <= 0 &&
    comparePosition(outer.endLine, outer.endColumn, inner.endLine, inner.endColumn) >= 0
  );
}

function comparePosition(aLine: number, aColumn: number, bLine: number, bColumn: number): number {
  return aLine - bLine || aColumn - bColumn;
}
function stable(prefix: string, ...parts: Array<string | number | undefined>): string {
  return `${prefix}:${createHash("sha256")
    .update(parts.map((item) => String(item ?? "").normalize("NFC")).join("\u001f"))
    .digest("hex")
    .slice(0, 32)}`;
}

export function isCfgEdge(type: CpgEdgeType): boolean {
  return type.startsWith("CFG_");
}
export function isDataFlowEdge(type: CpgEdgeType): boolean {
  return [
    "DEFINES",
    "USES",
    "REACHING_DEFINITION",
    "FLOWS_TO",
    "ARGUMENT_TO_PARAMETER",
    "RETURN_TO_CALL",
    "RECEIVER_TO_CALL",
  ].includes(type);
}
export function isAstKind(kind: CpgNodeKind): boolean {
  return (
    kind !== "ENTRY" &&
    kind !== "EXIT" &&
    kind !== "MERGE" &&
    kind !== "UNKNOWN_VALUE" &&
    kind !== "EXTERNAL_CALL" &&
    kind !== "UNRESOLVED_TARGET"
  );
}
