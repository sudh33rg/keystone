import { createHash } from "node:crypto";

export class IntelligenceIdFactory {
  create(prefix: string, ...parts: Array<string | number | undefined>): string {
    const canonical = parts.map((part) => String(part ?? "").normalize("NFC")).join("\u001f");
    return `${prefix}:${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
  }

  entity(repositoryId: string, fileId: string, type: string, qualifiedName: string, signature?: string): string {
    return this.create("entity", repositoryId, fileId, "typescript", type, qualifiedName, signature);
  }

  relationship(repositoryId: string, sourceId: string, targetId: string, type: string, ownerFileId: string, discriminator?: string): string {
    return this.create("relationship", repositoryId, sourceId, targetId, type, ownerFileId, discriminator);
  }
}
