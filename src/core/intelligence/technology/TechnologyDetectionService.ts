/**
 * TechnologyDetectionService — detects frameworks, ORMs, databases, and
 * external services from manifest/config file contents. It is deterministic and
 * manifest/keyword driven only: no filesystem, no network, no LLM.
 *
 * The service is INERT by default (`enabled = false`). `RepositoryIndexService`
 * invokes it only when enabled, so the rest of the intelligence pipeline is
 * unaffected until an operator opts in. Detection results are emitted as
 * first-class `IntelligenceSymbolRecord`s with distinct stable-id namespaces
 * (`framework`, `orm-entity`, `db-table`, `ext-service`) and `sourceKind`s
 * (`manifest`, `framework-rule`, `database`, `infrastructure`), so they never
 * collide with Phase A (tree-sitter) or existing document-symbol output.
 */

import type { IntelligenceDiagnostic } from "../../../shared/contracts/intelligence";
import {
  detectComposeServices,
  detectFromDependencies,
  parseManifestDependencies,
  type Detection,
  type TechnologyKind,
  TECHNOLOGY_EXTRACTOR_ID,
  TECHNOLOGY_EXTRACTOR_VERSION,
} from "./TechnologyRegistry";

export interface TechnologySymbolRecord {
  id: string;
  repositoryId: string;
  fileId: string;
  type: string;
  name: string;
  qualifiedName: string;
  language: string;
  range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
  evidenceIds: string[];
  confidence: number;
  generation: number;
}

export interface TechnologyRelationshipRecord {
  id: string;
  repositoryId: string;
  sourceId: string;
  targetId: string;
  type: string;
  ownerFileId: string;
  targetFileId: string;
  resolution: "framework" | "external" | "exact" | "convention";
  evidenceIds: string[];
  derivation: "framework-rule" | "extracted";
  confidence: number;
  generation: number;
}

export interface TechnologyDetectionResult {
  available: boolean;
  parseStatus: "parsed" | "unsupported" | "partial";
  extractorId: string;
  extractorVersion: string;
  symbols: TechnologySymbolRecord[];
  relationships: TechnologyRelationshipRecord[];
  diagnostics: IntelligenceDiagnostic[];
}

/** Stable-id + evidence emission contract supplied by RepositoryIndexService. */
export interface TechnologyIdProvider {
  readonly repositoryId: string;
  readonly fileId: string;
  readonly generation: number;
  /** Canonical symbol id (namespace chosen by kind on the provider side). */
  entity(kind: TechnologyKind, name: string, discriminator: string): Promise<string>;
  relationship(
    sourceId: string,
    targetId: string,
    type: string,
    discriminator: string,
  ): Promise<string>;
  evidence(subjectId: string, relativePath: string, line: number): Promise<string>;
}

const KIND_TO_TYPE: Record<TechnologyKind, string> = {
  framework: "keystone.core.Framework",
  orm: "keystone.core.ORM",
  database: "keystone.core.Database",
  "external-service": "keystone.core.ExternalService",
};

export class TechnologyDetectionService {
  enabled = false;

  /**
   * Detect technologies for a single manifest/config file.
   *
   * @param relativePath file path used to select the manifest parser.
   * @param content decoded UTF-8 file content.
   * @param idProvider deterministic id + evidence emitter.
   */
  async detect(
    relativePath: string,
    content: string,
    idProvider: TechnologyIdProvider,
  ): Promise<TechnologyDetectionResult> {
    const diagnostics: IntelligenceDiagnostic[] = [];
    let detections: Detection[] = [];
    try {
      if (isManifestFile(relativePath)) {
        const deps = parseManifestDependencies(relativePath, content);
        detections = detectFromDependencies(deps);
        if (relativePath.toLowerCase().includes("docker-compose")) {
          detections = detections.concat(detectComposeServices(content));
        }
      }
    } catch (cause) {
      diagnostics.push({
        code: "TECHNOLOGY_DETECTION_FAILED",
        severity: "warning",
        message: `Technology detection failed for ${relativePath}: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    }

    if (detections.length === 0) {
      return {
        available: true,
        parseStatus: "parsed",
        extractorId: TECHNOLOGY_EXTRACTOR_ID,
        extractorVersion: TECHNOLOGY_EXTRACTOR_VERSION,
        symbols: [],
        relationships: [],
        diagnostics,
      };
    }

    const symbols: TechnologySymbolRecord[] = [];
    for (const detection of dedupeByName(detections)) {
      const id = await idProvider.entity(detection.kind, detection.name, detection.source);
      symbols.push({
        id,
        repositoryId: idProvider.repositoryId,
        fileId: idProvider.fileId,
        type: KIND_TO_TYPE[detection.kind],
        name: detection.name,
        qualifiedName: detection.name,
        language: "configuration",
        range: zeroRange(),
        evidenceIds: [], // filled by RepositoryIndexService.addTechnologySymbols
        confidence: detection.confidence,
        generation: idProvider.generation,
      });
    }

    return {
      available: true,
      parseStatus: "parsed",
      extractorId: TECHNOLOGY_EXTRACTOR_ID,
      extractorVersion: TECHNOLOGY_EXTRACTOR_VERSION,
      symbols,
      relationships: [],
      diagnostics,
    };
  }
}

function isManifestFile(relativePath: string): boolean {
  const lower = relativePath.toLowerCase();
  return (
    lower.endsWith("package.json") ||
    lower.endsWith("requirements.txt") ||
    lower.endsWith("pyproject.toml") ||
    lower.endsWith("go.mod") ||
    lower.endsWith("cargo.toml") ||
    lower.endsWith("pom.xml") ||
    lower.endsWith("build.gradle") ||
    lower.endsWith("build.gradle.kts") ||
    lower.endsWith("gemfile") ||
    lower.endsWith("mix.exs") ||
    lower.endsWith("composer.json") ||
    lower.endsWith(".csproj") ||
    lower.endsWith(".fsproj") ||
    lower.endsWith("package.swift") ||
    lower.endsWith("pubspec.yaml") ||
    lower.endsWith("pubspec.yml") ||
    lower.endsWith("docker-compose.yml") ||
    lower.endsWith("docker-compose.yaml") ||
    lower.endsWith(".tf") ||
    lower.endsWith(".tfvars")
  );
}

function dedupeByName(detections: Detection[]): Detection[] {
  const byName = new Map<string, Detection>();
  for (const d of detections) if (!byName.has(d.name)) byName.set(d.name, d);
  return [...byName.values()];
}

function zeroRange(): { startLine: number; startColumn: number; endLine: number; endColumn: number } {
  return { startLine: 0, startColumn: 0, endLine: 0, endColumn: 0 };
}
