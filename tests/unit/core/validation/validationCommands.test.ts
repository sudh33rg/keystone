import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '../../../support/testkit';
import { detectValidationCommands } from '@core/workflow/validation/validationCommands';

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-validation-'));
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }
  return root;
}

describe('detectValidationCommands', () => {
  it('aggregates validation commands for a polyglot workspace', async () => {
    const root = await fixture({
      'package.json': JSON.stringify({ scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' } }),
      'pyproject.toml': '[project]\nname="poly"',
      'tests/test_app.py': 'def test_ok(): assert True',
      'go.mod': 'module example.test/poly\n',
      'example.sln': '',
      'Package.swift': '// swift-tools-version: 5.9\n'
    });
    const result = await detectValidationCommands(root);
    expect(result.all).toEqual(expect.arrayContaining(['npm run typecheck', 'npm run test', 'python -m pytest', 'go test ./...', 'dotnet test', 'swift test']));
    expect(result.ecosystem).toContain('node:npm');
    expect(result.ecosystem).toContain('python');
    expect(result.ecosystem).toContain('dotnet');
  });

  it('uses framework-specific commands only when repository markers support them', async () => {
    const root = await fixture({
      'composer.json': JSON.stringify({ 'require-dev': { 'phpunit/phpunit': '^11' } }),
      'phpunit.xml': '<phpunit/>',
      'mix.exs': 'defmodule Demo.MixProject do end',
      'build.sbt': 'scalaVersion := "3.5.0"',
      'tests/unit.Tests.ps1': 'Describe "unit" {}',
      'test/basic.bats': '#!/usr/bin/env bats\n@test "ok" { true; }'
    });
    const result = await detectValidationCommands(root);
    expect(result.all).toEqual(expect.arrayContaining([
      'vendor/bin/phpunit',
      'mix test',
      'sbt test',
      'pwsh -NoProfile -Command "Invoke-Pester -CI"',
      'bats test'
    ]));
  });

  it('does not invent a validation command for an unmarked repository', async () => {
    const root = await fixture({ 'README.md': '# docs only' });
    await expect(detectValidationCommands(root)).resolves.toEqual({ all: [], impacted: [], ecosystem: 'unknown' });
  });
});
