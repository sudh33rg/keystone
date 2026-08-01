/**
 * Tests for multi-strategy risk scoring.
 */

import { describe, it, expect } from '../../../support/testkit';
import {
  computeRiskScores,
  getFilesByTier,
  getHighRiskFiles,
  getFilesByRisk,
} from '@core/workflow/quality/riskScoring';
import type { FileRiskData, FileRiskScore, RiskTier } from '@core/workflow/quality/riskScoring';

function makeFileRiskData(overrides: Partial<FileRiskData> = {}): FileRiskData {
  return {
    filePath: 'src/test.ts',
    churn: 0,
    coupling: 0,
    coverage: 1,
    authorConcentration: 0,
    testInstability: 0,
    ageDays: 100,
    ...overrides,
  };
}

describe('Risk Scoring', () => {
  it('should compute risk scores for files', () => {
    const files: FileRiskData[] = [
      makeFileRiskData({ churn: 0.8, coupling: 0.7, coverage: 0.3 }),
      makeFileRiskData({ churn: 0.2, coupling: 0.1, coverage: 0.9 }),
    ];

    const scores = computeRiskScores(files);

    expect(scores).toHaveLength(2);
    expect(scores[0].overallScore).toBeGreaterThan(scores[1].overallScore);
  });

  it('should classify risk tiers correctly', () => {
    const highRiskFile: FileRiskData[] = [
      makeFileRiskData({ churn: 1, coupling: 1, coverage: 0 }),
    ];

    const scores = computeRiskScores(highRiskFile);
    // High risk file should have medium or higher tier
    expect(['medium', 'high', 'critical'].includes(scores[0].tier)).toBe(true);

    const lowRiskFile: FileRiskData[] = [
      makeFileRiskData({ churn: 0, coupling: 0, coverage: 1 }),
    ];

    const lowScores = computeRiskScores(lowRiskFile);
    expect(lowScores[0].tier).toBe('none');
  });

  it('should identify risk factors', () => {
    const files: FileRiskData[] = [
      makeFileRiskData({ churn: 1, coupling: 1, coverage: 0, authorConcentration: 1, testInstability: 1 }),
    ];

    const scores = computeRiskScores(files);
    // At least some risk factors should be identified
    expect(scores[0].riskFactors.length).toBeGreaterThan(0);
  });

  it('should get files by tier', () => {
    const files: FileRiskData[] = [
      makeFileRiskData({ churn: 1, coupling: 1 }),
      makeFileRiskData({ churn: 0.1, coupling: 0.1 }),
      makeFileRiskData({ churn: 0.5, coupling: 0.5 }),
    ];

    const scores = computeRiskScores(files);
    const critical = getFilesByTier(scores, 'critical');
    const low = getFilesByTier(scores, 'low');

    expect(critical.length + low.length).toBeGreaterThan(0);
  });

  it('should get high risk files', () => {
    const files: FileRiskData[] = [
      makeFileRiskData({ churn: 1, coupling: 1, coverage: 0, authorConcentration: 1, testInstability: 1 }),
      makeFileRiskData({ churn: 0.1, coupling: 0.1 }),
    ];

    const scores = computeRiskScores(files);
    const highRisk = getHighRiskFiles(scores);

    // At least one high risk file should be identified
    expect(highRisk.length).toBeGreaterThanOrEqual(1);
    expect(highRisk[0].overallScore).toBeGreaterThanOrEqual(scores[1].overallScore);
  });

  it('should sort files by risk score', () => {
    const files: FileRiskData[] = [
      makeFileRiskData({ churn: 0.1, coupling: 0.1 }),
      makeFileRiskData({ churn: 0.9, coupling: 0.9 }),
      makeFileRiskData({ churn: 0.5, coupling: 0.5 }),
    ];

    const scores = computeRiskScores(files);
    const sorted = getFilesByRisk(scores);

    expect(sorted[0].overallScore).toBeGreaterThanOrEqual(sorted[1].overallScore);
    expect(sorted[1].overallScore).toBeGreaterThanOrEqual(sorted[2].overallScore);
  });

  it('should handle files with no risk', () => {
    const files: FileRiskData[] = [
      makeFileRiskData({ churn: 0, coupling: 0, coverage: 1 }),
    ];

    const scores = computeRiskScores(files);
    expect(scores[0].overallScore).toBeCloseTo(0, 1);
    expect(scores[0].tier).toBe('none');
  });

  it('should handle files with maximum risk', () => {
    const files: FileRiskData[] = [
      makeFileRiskData({ churn: 1, coupling: 1, coverage: 0, authorConcentration: 1, testInstability: 1 }),
    ];

    const scores = computeRiskScores(files);
    expect(scores[0].overallScore).toBeGreaterThan(0.3);
    expect(['medium', 'high', 'critical'].includes(scores[0].tier)).toBe(true);
  });
});
