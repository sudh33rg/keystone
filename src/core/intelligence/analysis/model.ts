export type InsightSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface RepositoryInsight {
  id: string;
  category: string;
  severity: InsightSeverity;
  title: string;
  path: string;
  line: number;
  evidence: string;
  explanation: string;
  remediation: string;
  confidence: number;
}

export interface RepositoryInsightReport {
  kind: 'security' | 'performance';
  generatedAt: string;
  analyzedFiles: number;
  discoveryMode: 'unbounded-incremental';
  completedWithoutFileCap: boolean;
  riskScore: number;
  riskLevel: InsightSeverity;
  summary: { critical: number; high: number; medium: number; low: number };
  findings: RepositoryInsight[];
  hotspots: Array<{ path: string; score: number; findings: number }>;
  safeguards: Array<{ path: string; controls: string[] }>;
  skippedFiles: Array<{ path: string; reason: string }>;
  recommendations: string[];
  truncated: boolean;
}
