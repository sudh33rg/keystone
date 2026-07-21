/**
 * ContractExtractionService
 *
 * Extracts public contracts from source items deterministically:
 *  - function signatures
 *  - interfaces
 *  - DTOs / schemas
 *  - API routes
 *  - database entities
 *  - configuration contracts
 *  - error contracts
 *  - test expectations
 *
 * Used for `signature`/`contract` content modes instead of full source.
 */

import type { ContextItem } from "../../shared/contracts/contextPackage";
import { ContextItemSchema } from "../../shared/contracts/contextPackage";
import type { TokenCounter } from "./TokenCounterRegistry";

export class ContractExtractionService {
  extract(item: ContextItem, mode: "signature" | "contract", counter: TokenCounter): ContextItem {
    if (item.contentMode === "signature" || item.contentMode === "contract") return item;
    const extracted =
      mode === "signature"
        ? this.extractSignatures(item.content)
        : this.extractContracts(item.content);
    if (extracted.length === 0) return item;
    const text = extracted.join("\n");
    return ContextItemSchema.parse({
      ...item,
      contentMode: mode,
      compressionStrategy: "contract-extraction",
      structuralSummary: text,
      content: text,
      tokenCount: counter.count(text),
      savedTokens: Math.max(0, item.rawTokenCount - counter.count(text)),
      compressedContentHash: `sha256:${mode}:${item.rawContentHash}`,
      reasons: [
        ...item.reasons,
        `Contract extraction (${mode}) preserved signatures/contracts, reducing full-source tokens.`,
      ],
    });
  }

  private extractSignatures(content: string): string[] {
    const out: string[] = [];
    const source = content;
    const sigRe =
      /(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const)\s+([A-Za-z0-9_]+)[^\n{;]*[;{]?/g;
    let m: RegExpExecArray | null;
    while ((m = sigRe.exec(source)) !== null) {
      const line = source
        .slice(m.index)
        .split("\n")[0]!
        .trim()
        .replace(/\{\s*$/, "")
        .replace(/;$/, "");
      if (line.length > 0) out.push(line);
    }
    // Method signatures inside classes.
    const methodRe =
      /(?:public|private|protected|static)?\s*(?:async\s+)?[A-Za-z0-9_]+\s*\([^)]*\)\s*(?::\s*[^{]+)?\s*\{?/g;
    let m2: RegExpExecArray | null;
    while ((m2 = methodRe.exec(source)) !== null) {
      const line = source
        .slice(m2.index)
        .split("\n")[0]!
        .trim()
        .replace(/\{\s*$/, "");
      if (line.length > 0 && /\(/.test(line)) out.push(line);
    }
    return dedupe(out).slice(0, 40);
  }

  private extractContracts(content: string): string[] {
    const out = this.extractSignatures(content);
    const source = content;
    const routeRe =
      /(?:@(Get|Post|Put|Delete|Patch)|app\.(get|post|put|delete|patch)|router\.(get|post|put|delete|patch))\s*\(\s*['"`]([^'"`]+)['"`]/g;
    let m: RegExpExecArray | null;
    while ((m = routeRe.exec(source)) !== null) out.push(`Route: ${m[2]}`);
    const schemaRe =
      /(?:@Entity|@Table|@Schema|model\s+[A-Za-z0-9_]+|interface\s+[A-Za-z0-9_]+Schema)/g;
    let m2: RegExpExecArray | null;
    while ((m2 = schemaRe.exec(source)) !== null)
      out.push(source.slice(m2.index).split("\n")[0]!.trim());
    const errorRe = /class\s+[A-Za-z0-9_]*Error\b|throw\s+new\s+[A-Za-z0-9_]+/g;
    let m3: RegExpExecArray | null;
    while ((m3 = errorRe.exec(source)) !== null)
      out.push(source.slice(m3.index).split("\n")[0]!.trim().slice(0, 200));
    const configRe = /\b(config|Config|options|Settings)\b\s*[:=]\s*\{/g;
    let m4: RegExpExecArray | null;
    while ((m4 = configRe.exec(source)) !== null)
      out.push(source.slice(m4.index).split("\n")[0]!.trim().slice(0, 200));
    return dedupe(out).slice(0, 60);
  }
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}
