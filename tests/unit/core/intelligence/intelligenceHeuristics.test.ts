import { describe, expect, it } from '../../../support/testkit';

import { detectPerformanceSensitivePath } from '@core/intelligence/ingestion/performancePathDetector';
import { detectSecuritySensitiveArea } from '@core/intelligence/ingestion/securityZoneDetector';
import { analyzeLanguageFile } from '@core/intelligence/languages/languageAnalysis';

describe('repository intelligence heuristics', () => {
  it('does not classify ordinary language substrings as security or performance risks', () => {
    const source = 'export async function filterUsers() { return events.sort(); }';
    expect(detectSecuritySensitiveArea('src/list.ts', source)).toEqual([]);
    expect(detectPerformanceSensitivePath('src/list.ts', source)).toEqual([]);
  });

  it('retains specific security and performance evidence', () => {
    const source = 'const credential = readSecret(); const rows = database.query({ pagination: true });';
    expect(detectSecuritySensitiveArea('src/auth.ts', source)).toEqual(expect.arrayContaining(['auth', 'credential', 'secret']));
    expect(detectPerformanceSensitivePath('src/store.ts', source)).toEqual(expect.arrayContaining(['database', 'query', 'pagination']));
  });

  it('does not emit control-flow keywords as method symbols', () => {
    const symbols = analyzeLanguageFile('src/example.ts', 'if (ready) {\nfor (const item of items) {\nrun() { return true; }').symbols;
    expect(symbols.map((symbol) => symbol.name)).toEqual(['run']);
  });

  it('represents repeated imports of the same target as one graph edge', () => {
    const source = "import type { Config } from './types';\nimport { createConfig } from './types';";
    expect(analyzeLanguageFile('src/config.ts', source).dependencies).toEqual([
      { from: 'src/config.ts', to: 'src/types', kind: 'local' }
    ]);
  });
});
