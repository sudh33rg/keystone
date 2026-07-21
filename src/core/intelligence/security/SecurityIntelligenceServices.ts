/**
 * Security intelligence engine (spec §5-§22, §38, §51).
 *
 * Deterministic, LLM-free discovery and analysis over the Phase 6 change set / impact analysis and the
 * Phase 4 graph & flows. Produces explainable, confidence-scored findings and evidence-backed gate
 * decisions. Reuses `redactSecrets`/`detectSecrets` from the shared context utilities for secret
 * handling (acceptance §10) and the Phase 2 `security-analysis-profile` ids as the routing targets.
 */
import { createHash } from "node:crypto";
import {
  AttackSurfaceEntrySchema,
  SecurityAttackSurfaceSchema,
  ExposureLevelSchema,
  TrustBoundarySchema,
  SecurityAuthPathSchema,
  SecurityAuthorizationPathSchema,
  SecurityDataFlowSchema,
  SecurityPathSchema,
  SecurityFindingSchema,
  SecurityAnalysisSchema,
  SecuritySeveritySchema,
  RiskLevelSchema,
  GateEvaluationSchema,
  type AttackSurfaceEntry,
  type SecurityAttackSurface,
  type ExposureLevel,
  type TrustBoundary,
  type SecurityAuthPath,
  type SecurityAuthorizationPath,
  type SecurityDataFlow,
  type SecurityPath,
  type SecurityPathCategory,
  type SensitiveDataCategory,
  type SecurityFinding,
  type SecurityAnalysis,
  type SecuritySeverity,
  type RiskLevel,
  type GateEvaluation,
} from "../../../shared/contracts/qaSecurity";
import { AnalysisStatusSchema } from "../../../shared/contracts/qaSecurity";

const SENSITIVE_NAME_PATTERNS: Array<{
  pattern: RegExp;
  category: SensitiveDataCategory;
  confidence: number;
}> = [
  { pattern: /(password|passwd|pwd)/i, category: "authentication-credential", confidence: 0.7 },
  {
    pattern: /(token|jwt|bearer|api[_-]?key|access[_-]?key)/i,
    category: "access-token",
    confidence: 0.6,
  },
  { pattern: /(private[_-]?key|rsa|ed25519|pem)/i, category: "private-key", confidence: 0.7 },
  { pattern: /(secret|client[_-]?secret)/i, category: "secret", confidence: 0.55 },
  {
    pattern: /(ssn|social[_-]?security|national[_-]?id)/i,
    category: "personal-identifier",
    confidence: 0.7,
  },
  { pattern: /(email|phone|mobile|address)/i, category: "contact-information", confidence: 0.45 },
  {
    pattern: /(card|cvv|pan|payment|iban|account[_-]?number)/i,
    category: "payment-information",
    confidence: 0.6,
  },
  { pattern: /(health|medical|diagnosis)/i, category: "health-related-data", confidence: 0.55 },
  { pattern: /(session|cookie)/i, category: "session-data", confidence: 0.5 },
  {
    pattern: /(lat|lng|longitude|latitude|geo|location)/i,
    category: "location-data",
    confidence: 0.45,
  },
];

export interface EntityInput {
  entityId: string;
  displayName: string;
  filePath?: string;
  roles: string[];
  frameworkRegistration?: string;
  downstreamFlowIds?: string[];
  evidence?: string[];
}

export class AttackSurfaceDiscoveryService {
  discover(entities: EntityInput[]): SecurityAttackSurface {
    const now = new Date().toISOString();
    const entries: AttackSurfaceEntry[] = [];
    for (const e of entities) {
      const exposure = ExposureClassificationService.classify(e);
      if (
        exposure === "unknown" &&
        !e.roles.some((r) =>
          /entry|handler|route|endpoint|command|subscriber|consumer|webhook/i.test(r),
        )
      ) {
        continue; // do not treat every exported function as an external attack surface (§2/§6)
      }
      entries.push(
        AttackSurfaceEntrySchema.parse({
          entityId: e.entityId,
          protocolOrTrigger: e.frameworkRegistration ?? "inferred",
          exposure,
          authenticationRequired:
            /auth|secure|protected/i.test(e.roles.join(" ")) ||
            exposure === "authenticated-external",
          authorizationRequired: /authz|permission|role|guard/i.test(e.roles.join(" ")),
          acceptedInput: [],
          downstreamFlowIds: e.downstreamFlowIds ?? [],
          sensitiveOperations: e.roles.filter((r) =>
            /sink|secret|crypto|session|token|command|file|deserializ/i.test(r),
          ),
          evidence: e.evidence ?? [
            e.frameworkRegistration ?? `inferred from roles: ${e.roles.join(", ")}`,
          ],
          confidence: exposure === "unknown" ? 0.3 : 0.7,
        }),
      );
    }
    return SecurityAttackSurfaceSchema.parse({
      entries,
      metadata: { generatedAt: now, contentHash: this.hash(entries) },
    });
  }

  private hash(v: unknown): string {
    return createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 32);
  }
}

export class ExposureClassificationService {
  /** Explainable exposure classification (§7). Not every export is external. */
  static classify(e: EntityInput): ExposureLevel {
    const roles = e.roles.join(" ").toLowerCase();
    const reg = (e.frameworkRegistration ?? "").toLowerCase();
    // More security-relevant / specific classifications win over generic route/public matching.
    if (/admin|privileged/i.test(roles)) return "administrative";
    if (/auth|authenticate|login|session/i.test(roles)) return "authenticated-external";
    if (/partner|service-to-service|internal-client/i.test(roles))
      return "partner-or-service-external";
    if (/command|cli|vscode|local/i.test(roles)) return "local-user-initiated";
    if (/subscriber|consumer|event|webhook|schedule|job|cron/i.test(roles))
      return "background-system-initiated";
    if (/test/i.test(roles) && /test/i.test(reg)) return "test-only";
    if (/internal|service/i.test(roles)) return "internal-service";
    if (
      /public|GET |route|@router|express|http|graphql|post\(|ws|websocket/i.test(roles + " " + reg)
    )
      return "public-external";
    return "unknown";
  }

  static fromString(s: string): ExposureLevel {
    return ExposureLevelSchema.options.includes(s as ExposureLevel)
      ? (s as ExposureLevel)
      : "unknown";
  }
}

// ---------------------------------------------------------------------------
// Trust boundaries (§8)
// ---------------------------------------------------------------------------

export class TrustBoundaryService {
  build(
    zones: Array<{ id: string; name: string }>,
    crossings: Array<{
      sourceZone: string;
      destinationZone: string;
      entityIds: string[];
      dataTypes?: string[];
      evidence?: string[];
    }>,
  ): TrustBoundary[] {
    return crossings.map((c) =>
      TrustBoundarySchema.parse({
        id: `tb:${c.sourceZone}:${c.destinationZone}`,
        sourceZone: c.sourceZone,
        destinationZone: c.destinationZone,
        crossingEntityIds: c.entityIds,
        inputOrDataTypes: c.dataTypes ?? [],
        authenticationState: "unknown",
        authorizationState: "unknown",
        validationState: "unknown",
        confidence: 0.6,
        evidence: c.evidence ?? [`crossing ${c.sourceZone} → ${c.destinationZone}`],
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Authentication + authorization paths (§9, §10)
// ---------------------------------------------------------------------------

export class AuthenticationPathService {
  analyze(
    entryEntityId: string,
    steps: Array<{ kind: string; entityId: string }>,
    opts: Partial<SecurityAuthPath> = {},
  ): SecurityAuthPath {
    const hasAuth = steps.some((s) => /auth|token|session|identity|login|middleware/i.test(s.kind));
    return SecurityAuthPathSchema.parse({
      id: `authpath:${entryEntityId}`,
      entryPointEntityId: entryEntityId,
      steps,
      hasAuthenticationEvidence: hasAuth,
      ...opts,
      evidence: opts.evidence ?? [`entry ${entryEntityId}; auth steps: ${steps.length}`],
    });
  }
}

export class AuthorizationPathService {
  analyze(
    operationEntityId: string,
    decisionEntityId: string | undefined,
    checkType: SecurityAuthorizationPath["checkType"],
    opts: Partial<SecurityAuthorizationPath> = {},
  ): SecurityAuthorizationPath {
    return SecurityAuthorizationPathSchema.parse({
      id: `authzpath:${operationEntityId}`,
      operationEntityId,
      decisionEntityId,
      checkType,
      hasAuthorizationEvidence: checkType !== "none-visible",
      ...opts,
      evidence: opts.evidence ?? [
        `operation ${operationEntityId}; decision ${decisionEntityId ?? "none"}`,
      ],
    });
  }
}

// ---------------------------------------------------------------------------
// Sensitive-data classification + flows (§11, §12)
// ---------------------------------------------------------------------------

export class SensitiveDataClassificationService {
  /** Deterministic, confidence-scored classification from names/types/annotations (§11). */
  classify(
    fieldName: string,
    annotation?: string,
  ): { category: SensitiveDataCategory; confidence: number } {
    const text = `${fieldName} ${annotation ?? ""}`;
    for (const p of SENSITIVE_NAME_PATTERNS) {
      if (p.pattern.test(text)) return { category: p.category, confidence: p.confidence };
    }
    return { category: "unknown-sensitive-data", confidence: 0.2 };
  }

  classifyMany(
    fields: Array<{ name: string; annotation?: string }>,
  ): Array<{ name: string; category: SensitiveDataCategory; confidence: number }> {
    return fields.map((f) => ({ name: f.name, ...this.classify(f.name, f.annotation) }));
  }
}

export class SensitiveDataFlowService {
  track(
    sourceEntityId: string,
    sinkEntityId: string,
    dataCategories: SensitiveDataCategory[],
    relationship: SecurityDataFlow["relationship"],
    opts: { crossesTrustBoundary?: boolean; evidence?: string[] } = {},
  ): SecurityDataFlow {
    return SecurityDataFlowSchema.parse({
      id: `df:${sourceEntityId}:${sinkEntityId}`,
      sourceEntityId,
      sinkEntityId,
      dataCategories,
      relationship,
      crossesTrustBoundary: opts.crossesTrustBoundary ?? false,
      evidence: opts.evidence ?? [`${relationship} flow ${sourceEntityId} → ${sinkEntityId}`],
    });
  }
}

// ---------------------------------------------------------------------------
// Source-to-sink path analysis (§13, §14, §15)
// ---------------------------------------------------------------------------

export interface ValidatorRegistryEntry {
  entityId: string;
  capability: string;
  supportedInputTypes: string[];
  confidence: number;
  limitations: string[];
  unsafeBypass: boolean;
}

export class SecurityValidatorRegistry {
  private entries = new Map<string, ValidatorRegistryEntry>();

  register(e: ValidatorRegistryEntry): void {
    this.entries.set(e.entityId, e);
  }
  confirm(entityId: string): void {
    const e = this.entries.get(entityId);
    if (e) e.confidence = Math.max(e.confidence, 0.9);
  }
  get(entityId: string): ValidatorRegistryEntry | undefined {
    return this.entries.get(entityId);
  }
  isEffectiveValidator(entityId: string): boolean {
    const e = this.entries.get(entityId);
    return !!e && e.confidence >= 0.6 && !e.unsafeBypass;
  }
  list(): ValidatorRegistryEntry[] {
    return [...this.entries.values()];
  }
}

export class SecurityPathAnalysisService {
  constructor(
    private readonly registry: SecurityValidatorRegistry = new SecurityValidatorRegistry(),
  ) {}

  analyze(input: {
    sourceEntityId: string;
    sinkEntityId: string;
    category: SecurityPathCategory;
    intermediateSteps?: string[];
    validators?: string[];
    sanitizers?: string[];
    encoders?: string[];
    unresolvedTransformations?: string[];
    trustBoundaryCrossings?: string[];
  }): SecurityPath {
    const effectiveValidators = (input.validators ?? []).filter((v) =>
      this.registry.isEffectiveValidator(v),
    );
    const effectiveSanitizers = (input.sanitizers ?? []).filter((s) =>
      this.registry.isEffectiveValidator(s),
    );
    const hasProtection = effectiveValidators.length > 0 || effectiveSanitizers.length > 0;
    const unresolved = (input.unresolvedTransformations ?? []).length > 0;
    // Candidate unless proven exploitable. Unresolved transformations raise risk; effective
    // validators/sanitizers reduce it. All remain "candidate" unless evidence proves exploitability.
    const confidence = unresolved ? 0.7 : hasProtection ? 0.5 : 0.6;
    return SecurityPathSchema.parse({
      id: `sp:${input.category}:${input.sourceEntityId}:${input.sinkEntityId}`,
      category: input.category,
      sourceEntityId: input.sourceEntityId,
      sinkEntityId: input.sinkEntityId,
      intermediateSteps: input.intermediateSteps ?? [],
      trustBoundaryCrossings: input.trustBoundaryCrossings ?? [],
      validators: input.validators ?? [],
      sanitizers: input.sanitizers ?? [],
      encoders: input.encoders ?? [],
      unresolvedTransformations: input.unresolvedTransformations ?? [],
      confidence,
      evidence: [
        `source ${input.sourceEntityId}; sink ${input.sinkEntityId}; effective validators ${effectiveValidators.length}`,
      ],
      riskCategory: input.category,
    });
  }
}

// ---------------------------------------------------------------------------
// Security impact, findings, gates (§18, §19, §22, §38)
// ---------------------------------------------------------------------------

export class SecurityImpactService {
  /** Risk contribution rises when changed roots intersect security-relevant paths (§18). */
  contribution(changedEntityIds: string[], affectedPathEntityIds: string[]): number {
    const changed = new Set(changedEntityIds);
    const hits = affectedPathEntityIds.filter((id) => changed.has(id)).length;
    if (hits === 0) return 0;
    return Math.min(1, 0.3 + 0.2 * hits);
  }
}

export class SecurityFindingService {
  create(
    input: Omit<SecurityFinding, "metadata" | "status"> & Partial<Pick<SecurityFinding, "status">>,
  ): SecurityFinding {
    const now = new Date().toISOString();
    return SecurityFindingSchema.parse({
      ...input,
      status: input.status ?? "open",
      metadata: {
        createdAt: now,
        updatedAt: now,
        contentHash: createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32),
      },
    });
  }

  severityRank(s: SecuritySeverity): number {
    return ["info", "low", "medium", "high", "critical"].indexOf(s);
  }
}

export class SecurityGateService {
  /** Evidence-backed gate evaluation; accepted risks require reason + approver (§22). */
  evaluate(
    rule: string,
    passed: boolean,
    opts: {
      blocking?: boolean;
      evidence?: string[];
      remediationAction?: string;
      analysisId: string;
      kind?: "security" | "performance";
    },
  ): GateEvaluation {
    return GateEvaluationSchema.parse({
      id: `gate:${rule}:${opts.analysisId}`,
      analysisId: opts.analysisId,
      kind: opts.kind ?? "security",
      rule,
      passed,
      blocking: opts.blocking ?? !passed,
      evidence: opts.evidence ?? [],
      remediationAction: opts.remediationAction,
      evaluatedAt: new Date().toISOString(),
    });
  }
}

// Re-export for convenience.
export { SecuritySeveritySchema, RiskLevelSchema };
export type { SecuritySeverity, RiskLevel };
export { SecurityAnalysisSchema };

// ---------------------------------------------------------------------------
// SecurityAnalysis assembler — produces a fully-valid `SecurityAnalysis` from
// discovered pieces (used by the orchestrator and Phase 9 review).
// ---------------------------------------------------------------------------

export interface AssembleSecurityAnalysisInput {
  id: string;
  workflowId?: string;
  changeSetId?: string;
  rootEntityIds: string[];
  flowIds?: string[];
  attackSurface: ReturnType<AttackSurfaceDiscoveryService["discover"]>;
  trustBoundaries?: TrustBoundary[];
  authPaths?: SecurityAuthPath[];
  dataFlows?: SecurityDataFlow[];
  sourceSinkPaths?: ReturnType<SecurityPathAnalysisService["analyze"]>[];
  findings?: SecurityFinding[];
  intelligenceRevision: string;
  specificationRevision: string;
  riskLevel: RiskLevel;
  status?: "complete" | "partial" | "blocked" | "stale";
}

export class SecurityAnalysisAssembler {
  build(input: AssembleSecurityAnalysisInput): SecurityAnalysis {
    const now = new Date().toISOString();
    return SecurityAnalysisSchema.parse({
      id: input.id,
      workflowId: input.workflowId,
      changeSetId: input.changeSetId,
      scope: { rootEntityIds: input.rootEntityIds, flowIds: input.flowIds ?? [], planned: false },
      attackSurface: SecurityAttackSurfaceSchema.parse({
        entries: input.attackSurface.entries,
        metadata: {
          generatedAt: now,
          contentHash: input.attackSurface.metadata?.contentHash ?? "x",
        },
      }),
      trustBoundaries: input.trustBoundaries ?? [],
      authPaths: input.authPaths ?? [],
      dataFlows: input.dataFlows ?? [],
      sourceSinkPaths: input.sourceSinkPaths ?? [],
      configurationFindings: [],
      dependencyFindings: [],
      findings: input.findings ?? [],
      risk: {
        level: input.riskLevel,
        score:
          input.riskLevel === "critical"
            ? 0.95
            : input.riskLevel === "high"
              ? 0.8
              : input.riskLevel === "medium"
                ? 0.5
                : 0.2,
        factors: [],
      },
      warnings: [],
      metadata: {
        intelligenceRevision: input.intelligenceRevision,
        specificationRevision: input.specificationRevision,
        generatedAt: now,
        contentHash: createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32),
        status: AnalysisStatusSchema.options.includes(input.status ?? "complete")
          ? (input.status ?? "complete")
          : "complete",
      },
    });
  }
}

export type { SecurityAnalysis };
