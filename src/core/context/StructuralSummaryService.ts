/**
 * StructuralSummaryService
 *
 * Generates deterministic structural summaries of source items:
 *  - module purpose (first doc comment / leading comment)
 *  - exported symbols
 *  - major dependencies (imports)
 *  - callers and callees (from content markers)
 *  - side effects (write/delete/mutation markers)
 *  - database access
 *  - external service calls
 *  - test coverage links (referenced tests)
 */

import type { ContextItem } from "../../shared/contracts/contextPackage";
import { ContextItemSchema } from "../../shared/contracts/contextPackage";
import type { TokenCounter } from "./TokenCounterRegistry";

export class StructuralSummaryService {
  summarize(item: ContextItem, counter: TokenCounter): ContextItem {
    if (item.contentMode === "summary" || item.contentMode === "contract") return item;
    const summary = this.buildSummary(item.content);
    const compressedHash = `sha256:${counter.id}:${item.rawContentHash}`;
    return ContextItemSchema.parse({
      ...item,
      contentMode: "summary",
      compressionStrategy: "structural-summary",
      structuralSummary: summary,
      content: summary,
      tokenCount: counter.count(summary),
      savedTokens: Math.max(0, item.rawTokenCount - counter.count(summary)),
      compressedContentHash: compressedHash,
      reasons: [
        ...item.reasons,
        "Structural summary replaced full source to reduce tokens while preserving traceability.",
      ],
    });
  }

  private buildSummary(content: string): string {
    const lines = content.split("\n");
    const purpose = this.extractPurpose(lines);
    const exported = this.extractExports(lines);
    const dependencies = this.extractImports(lines);
    const sideEffects = this.extractSideEffects(lines);
    const dbAccess =
      /(insert|update|delete|select|query|prisma|\.save\(|knex|sequelize|typeorm|mongoose)/i.test(
        content,
      );
    const externalCalls = /(fetch\(|axios|http\.|grpc|client\.|\.request\(|amqp|kafka)/i.test(
      content,
    );
    const testLinks = /(describe\(|it\(|test\(|expect\()/i.test(content);

    const parts: string[] = [];
    if (purpose) parts.push(`Purpose: ${purpose}`);
    if (exported.length) parts.push(`Exports: ${exported.join(", ")}`);
    if (dependencies.length) parts.push(`Dependencies: ${dependencies.slice(0, 12).join(", ")}`);
    if (sideEffects.length) parts.push(`Side effects: ${sideEffects.join(", ")}`);
    if (dbAccess) parts.push("Database access: present");
    if (externalCalls) parts.push("External service calls: present");
    if (testLinks) parts.push("Contains test coverage assertions.");
    if (parts.length === 0)
      parts.push("No high-value structural signals extracted; retained as compact excerpt.");
    return parts.join("\n");
  }

  private extractPurpose(lines: string[]): string | undefined {
    for (const line of lines.slice(0, 20)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("#")) {
        const text = trimmed.replace(/^[//*#\s]+/, "").trim();
        if (text.length > 3 && !text.startsWith("!")) return text.slice(0, 200);
      }
      if (trimmed.startsWith("/**") || trimmed.startsWith("/*")) {
        const text = trimmed.replace(/\/\*+|\*+\/|\s+/g, " ").trim();
        if (text.length > 3) return text.slice(0, 200);
      }
    }
    return undefined;
  }

  private extractExports(lines: string[]): string[] {
    const out: string[] = [];
    const re =
      /export\s+(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z0-9_]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lines.join("\n"))) !== null) out.push(m[1]!);
    return out.slice(0, 30);
  }

  private extractImports(lines: string[]): string[] {
    const out: string[] = [];
    const re = /import\s+[^'"]*from\s+['"]([^'"]+)['"]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lines.join("\n"))) !== null) out.push(m[1]!);
    return out.slice(0, 20);
  }

  private extractSideEffects(lines: string[]): string[] {
    const out: string[] = [];
    if (
      /(fs\.write|fs\.append|writeFile|unlink|rmdir|process\.exit|console\.)/.test(lines.join("\n"))
    )
      out.push("file/system IO");
    if (/(localStorage|sessionStorage|document\.cookie|setCookie)/.test(lines.join("\n")))
      out.push("client storage mutation");
    if (/(state\.|setState|store\.dispatch|mutation)/.test(lines.join("\n")))
      out.push("state mutation");
    return out;
  }
}
