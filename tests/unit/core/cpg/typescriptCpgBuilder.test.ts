import { describe, expect, it } from '../../../support/testkit';

import { buildTypeScriptCpg } from '@core/intelligence/cpg';

describe('buildTypeScriptCpg', () => {
  it('builds stable AST and evaluation-order layers with honest capabilities', () => {
    const input = {
      sourcePath: 'src/example.ts',
      content: 'export function double(value: number) {\n  const result = value * 2;\n  return result;\n}\n'
    };
    const first = buildTypeScriptCpg(input);
    const second = buildTypeScriptCpg(input);

    expect(first.capabilities).toEqual({
      ast: true,
      eog: true,
      cfg: true,
      dfg: true,
      cdg: true,
      typeResolution: false
    });
    expect(first.nodes.map(node => node.id)).toEqual(second.nodes.map(node => node.id));
    expect(first.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ syntaxKind: 'FunctionDeclaration', name: 'double' }),
      expect.objectContaining({ syntaxKind: 'Parameter', name: 'value' }),
      expect.objectContaining({ syntaxKind: 'VariableDeclaration', name: 'result' })
    ]));
    expect(first.edges.some(edge => edge.kind === 'ast')).toBe(true);
    expect(first.edges.some(edge => edge.kind === 'eog')).toBe(true);
    expect(first.edges.some(edge => edge.kind === 'cfg')).toBe(true);
    expect(first.edges.some(edge => edge.kind === 'dfg' && edge.metadata.variable === 'result')).toBe(true);
    expect(first.nodes.every(node => node.location.startLine >= 1)).toBe(true);
  });

  it('adds control dependence for conditional branches', () => {
    const graph = buildTypeScriptCpg({ sourcePath: 'src/branch.ts', content: 'function choose(ok: boolean) { if (ok) { return 1; } else { return 2; } }' });
    const branches = graph.edges.filter(edge => edge.kind === 'cdg').map(edge => edge.metadata.branch);
    expect(branches).toEqual(expect.arrayContaining(['true', 'false']));
  });

  it('selects JavaScript language and JSX parsing from the extension', () => {
    const graph = buildTypeScriptCpg({ sourcePath: 'src/view.jsx', content: 'const View = () => <div />;' });
    expect(graph.language).toBe('javascript');
    expect(graph.nodes.some(node => node.syntaxKind === 'JsxElement' || node.syntaxKind === 'JsxSelfClosingElement')).toBe(true);
  });
});
