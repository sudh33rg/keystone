import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '../../../support/testkit';
import { indexRepository } from '@core/intelligence/ingestion/repoIndexer';
import type { SemanticEnrichmentProvider } from '@core/intelligence/languages/semanticEnrichment';

const provider: SemanticEnrichmentProvider = {
  async enrich(request) {
    return {
      provider: 'test-language-service',
      providerLanguageId: request.languageId,
      capabilities: { documentSymbols: true, definitions: true, references: true, implementations: true, callHierarchy: true },
      symbols: [{ name: 'SemanticRun', kind: 'function', filePath: request.relativePath, line: 1, exportStatus: 'exported', evidence: { source: 'language-service', confidence: 0.99, evidencePath: request.relativePath, evidenceLine: 1, extractorVersion: 'test-language-service' } }],
      calls: [{ filePath: request.relativePath, caller: 'SemanticRun', callee: 'helper', line: 1, evidence: { source: 'language-service', confidence: 0.99, evidencePath: request.relativePath, evidenceLine: 1, extractorVersion: 'test-language-service' } }],
      referenceCount: 3,
      warnings: []
    };
  }
};

describe('language semantic enrichment', () => {
  it('merges installed language-service semantics without replacing deterministic evidence', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-language-service-'));
    await fs.writeFile(path.join(root, 'sample.py'), 'def deterministic_run():\n    return helper()\n', 'utf8');
    const result = await indexRepository(root, { persist: false, semanticEnricher: provider });
    expect(result.symbols.some(symbol => symbol.name === 'SemanticRun' && symbol.evidence?.source === 'language-service')).toBe(true);
    expect(result.symbols.some(symbol => symbol.name === 'deterministic_run')).toBe(true);
    const support = result.languageSupport?.find(item => item.id === 'python');
    expect(support?.semanticProvider).toBe('vscode-language-service');
    expect(support?.semanticFiles).toBe(1);
    expect(support?.capabilities.definitions).toBe(true);
  });

  it('indexes unknown text extensions through the universal frontend', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-universal-text-'));
    await fs.writeFile(path.join(root, 'workflow.customlang'), 'function execute() {\n  result = source\n}\n', 'utf8');
    const result = await indexRepository(root, { persist: false });
    expect(result.files.map(file => file.path)).toContain('workflow.customlang');
    expect(result.files.find(file => file.path === 'workflow.customlang')?.language).toBe('unknown');
    expect(result.symbols.some(symbol => symbol.filePath === 'workflow.customlang' && symbol.name === 'execute')).toBe(true);
    expect(result.languageSupport?.find(item => item.id === 'unknown')?.baseline).toBe('universal-text');
  });
  it('reuses unchanged semantic intelligence and enriches only changed files incrementally', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-incremental-semantics-'));
    const source = path.join(root, 'sample.py');
    await fs.writeFile(source, 'def run():\n    return helper()\n', 'utf8');
    let calls = 0;
    const countingProvider: SemanticEnrichmentProvider = {
      async enrich(request) {
        calls += 1;
        return {
          provider: 'counting-language-service', providerLanguageId: request.languageId,
          capabilities: { documentSymbols: true, definitions: true, references: true, implementations: true, callHierarchy: true },
          symbols: [{ name: `SemanticRun${calls}`, kind: 'function', filePath: request.relativePath, line: 1, exportStatus: 'exported', evidence: { source: 'language-service', confidence: 0.99, evidencePath: request.relativePath, evidenceLine: 1, extractorVersion: 'counting-language-service' } }],
          calls: [], referenceCount: 1, warnings: [],
        };
      },
    };
    const first = await indexRepository(root, { persist: true, semanticEnricher: countingProvider });
    expect(calls).toBe(1);
    expect(first.incrementalStats?.analyzedFiles).toBe(1);
    const second = await indexRepository(root, { persist: true, semanticEnricher: countingProvider });
    expect(calls).toBe(1);
    expect(second.incrementalStats?.reusedFiles).toBe(1);
    expect(second.incrementalStats?.analyzedFiles).toBe(0);
    await new Promise(resolve => setTimeout(resolve, 5));
    await fs.writeFile(source, 'def run():\n    value = helper()\n    return value\n', 'utf8');
    const third = await indexRepository(root, { persist: true, semanticEnricher: countingProvider });
    expect(calls).toBe(2);
    expect(third.incrementalStats?.analyzedFiles).toBe(1);
  });

});
