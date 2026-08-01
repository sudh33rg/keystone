/**
 * Multi-Strategy Risk Scoring
 *
 * Computes impact scores using multiple strategies:
 * - Churn score (recent change frequency)
 * - Coupling score (co-change frequency with other files)
 * - Coverage gap score (files with no test coverage)
 * - Author concentration (single-author files are riskier)
 * - Test instability (flaky tests increase risk)
 * - New file boost (new files get higher risk)
 *
 * Formula: 0.35*churn + 0.25*coupling + 0.15*coverage_gap + 0.10*coverage_depth + 0.10*author_concentration + 0.05*test_instability
 *
 * Inspired by Chisel's risk scoring formula and TDAD-TS's 5-strategy scoring.
 */

import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Risk score for a file */
export interface FileRiskScore {
  /** File path */
  filePath: string;

  /** Overall risk score (0.0 - 1.0) */
  overallScore: number;

  /** Risk tier */
  tier: RiskTier;

  /** Individual strategy scores */
  churnScore: number;
  couplingScore: number;
  coverageGapScore: number;
  coverageDepthScore: number;
  authorConcentrationScore: number;
  testInstabilityScore: number;
  newFileBoost: number;

  /** Risk factors */
  riskFactors: string[];

  /** Last updated timestamp */
  lastUpdated: number;
}

/** Risk tier classification */
export type RiskTier = 'critical' | 'high' | 'medium' | 'low' | 'none';

/** Configuration for risk scoring */
export interface RiskScoringConfig {
  /** Weights for each strategy */
  weights?: RiskWeights;

  /** Churn decay constant (days) */
  churnDecayDays?: number;

  /** Coverage gap threshold (0-1) */
  coverageGapThreshold?: number;

  /** Author concentration threshold (0-1) */
  authorConcentrationThreshold?: number;

  /** Test instability threshold (0-1) */
  testInstabilityThreshold?: number;

  /** New file age threshold (days) */
  newFileAgeDays?: number;
}

/** Weights for each risk strategy */
export interface RiskWeights {
  churn: number;
  coupling: number;
  coverageGap: number;
  coverageDepth: number;
  authorConcentration: number;
  testInstability: number;
  newFileBoost: number;
}

/** Default weights matching Chisel's formula */
const DEFAULT_WEIGHTS: RiskWeights = {
  churn: 0.35,
  coupling: 0.25,
  coverageGap: 0.15,
  coverageDepth: 0.10,
  authorConcentration: 0.10,
  testInstability: 0.05,
  newFileBoost: 0.05,
};

// ---------------------------------------------------------------------------
// Risk Score Computation
// ---------------------------------------------------------------------------

/**
 * Compute risk scores for all files.
 */
export function computeRiskScores(
  files: FileRiskData[],
  config: RiskScoringConfig = {}
): FileRiskScore[] {
  const weights = config.weights ?? DEFAULT_WEIGHTS;
  const churnDecayDays = config.churnDecayDays ?? 30;
  const coverageGapThreshold = config.coverageGapThreshold ?? 0.5;
  const authorConcentrationThreshold = config.authorConcentrationThreshold ?? 0.8;
  const testInstabilityThreshold = config.testInstabilityThreshold ?? 0.2;
  const newFileAgeDays = config.newFileAgeDays ?? 30;

  return files.map((file) => {
    // Compute individual strategy scores
    const churnScore = computeChurnScore(file.churn, churnDecayDays);
    const couplingScore = computeCouplingScore(file.coupling, weights.coupling);
    const coverageGapScore = computeCoverageGapScore(file.coverage, coverageGapThreshold);
    const coverageDepthScore = computeCoverageDepthScore(file.coverage, weights.coverageDepth);
    const authorConcentrationScore = computeAuthorConcentrationScore(file.authorConcentration, authorConcentrationThreshold);
    const testInstabilityScore = computeTestInstabilityScore(file.testInstability, testInstabilityThreshold);
    const newFileBoost = computeNewFileBoost(file.ageDays, newFileAgeDays);

    // Compute overall score
    const overallScore =
      weights.churn * churnScore +
      weights.coupling * couplingScore +
      weights.coverageGap * coverageGapScore +
      weights.coverageDepth * coverageDepthScore +
      weights.authorConcentration * authorConcentrationScore +
      weights.testInstability * testInstabilityScore +
      weights.newFileBoost * newFileBoost;

    // Determine risk tier
    const tier = classifyRiskTier(overallScore);

    // Collect risk factors
    const riskFactors: string[] = [];
    if (churnScore > 0.7) riskFactors.push('high_churn');
    if (couplingScore > 0.7) riskFactors.push('high_coupling');
    if (coverageGapScore > 0.7) riskFactors.push('low_coverage');
    if (authorConcentrationScore > 0.7) riskFactors.push('single_author');
    if (testInstabilityScore > 0.7) riskFactors.push('flaky_tests');
    if (newFileBoost > 0.7) riskFactors.push('new_file');

    return {
      filePath: file.filePath,
      overallScore,
      tier,
      churnScore,
      couplingScore,
      coverageGapScore,
      coverageDepthScore,
      authorConcentrationScore,
      testInstabilityScore,
      newFileBoost,
      riskFactors,
      lastUpdated: Date.now(),
    };
  });
}

/**
 * Compute churn score based on change frequency.
 * Formula: sum(1 / (1 + days_since_commit))
 */
function computeChurnScore(churn: number, decayDays: number): number {
  if (churn === 0) return 0;
  // Normalize churn to 0-1 range using exponential decay
  return 1 - Math.exp(-churn / decayDays);
}

/**
 * Compute coupling score based on co-change frequency.
 */
function computeCouplingScore(coupling: number, weight: number): number {
  if (coupling === 0) return 0;
  // Use sigmoid function to normalize
  return 1 / (1 + Math.exp(-coupling * 2));
}

/**
 * Compute coverage gap score.
 */
function computeCoverageGapScore(coverage: number, threshold: number): number {
  if (coverage >= threshold) return 0;
  // Inverse of coverage (lower coverage = higher risk)
  return 1 - coverage / threshold;
}

/**
 * Compute coverage depth score.
 */
function computeCoverageDepthScore(coverage: number, weight: number): number {
  if (coverage >= 0.9) return 0;
  // Penalize low coverage more
  return Math.pow(1 - coverage, 2);
}

/**
 * Compute author concentration score.
 */
function computeAuthorConcentrationScore(concentration: number, threshold: number): number {
  if (concentration < threshold) return 0;
  // Higher concentration = higher risk
  return (concentration - threshold) / (1 - threshold);
}

/**
 * Compute test instability score.
 */
function computeTestInstabilityScore(instability: number, threshold: number): number {
  if (instability < threshold) return 0;
  // Higher instability = higher risk
  return (instability - threshold) / (1 - threshold);
}

/**
 * Compute new file boost.
 */
function computeNewFileBoost(ageDays: number, thresholdDays: number): number {
  if (ageDays > thresholdDays) return 0;
  // Higher boost for newer files
  return 1 - ageDays / thresholdDays;
}

/**
 * Classify risk tier based on overall score.
 */
function classifyRiskTier(score: number): RiskTier {
  if (score >= 0.8) return 'critical';
  if (score >= 0.6) return 'high';
  if (score >= 0.4) return 'medium';
  if (score >= 0.2) return 'low';
  return 'none';
}

// ---------------------------------------------------------------------------
// Input Data Types
// ---------------------------------------------------------------------------

/** Input data for risk scoring */
export interface FileRiskData {
  /** File path */
  filePath: string;

  /** Change frequency (0-1) */
  churn: number;

  /** Coupling score (0-1) */
  coupling: number;

  /** Coverage ratio (0-1) */
  coverage: number;

  /** Author concentration (0-1) */
  authorConcentration: number;

  /** Test instability (0-1) */
  testInstability: number;

  /** File age in days */
  ageDays: number;
}

// ---------------------------------------------------------------------------
// Utility Functions
// ---------------------------------------------------------------------------

/**
 * Get files by risk tier.
 */
export function getFilesByTier(scores: FileRiskScore[], tier: RiskTier): FileRiskScore[] {
  return scores.filter((s) => s.tier === tier);
}

/**
 * Get critical/high risk files.
 */
export function getHighRiskFiles(scores: FileRiskScore[]): FileRiskScore[] {
  return scores.filter((s) => s.tier === 'critical' || s.tier === 'high');
}

/**
 * Get files sorted by risk score (descending).
 */
export function getFilesByRisk(scores: FileRiskScore[]): FileRiskScore[] {
  return [...scores].sort((a, b) => b.overallScore - a.overallScore);
}
