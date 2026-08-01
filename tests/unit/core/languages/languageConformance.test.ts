import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '../../../support/testkit';
import { LANGUAGE_DEFINITIONS, LanguageCapabilityRegistry } from '@core/intelligence/languages/languageRegistry';
import { analyzeLanguageFile } from '@core/intelligence/languages/languageAnalysis';
import { buildUniversalCpg } from '@core/intelligence/cpg/universalCpgBuilder';
import { buildRepositoryIntelligence } from '@core/intelligence/pipeline';
import { OkfSnapshotStore } from '@core/intelligence/okf/store';
import { CpgShardStore } from '@core/intelligence/cpg/shardStore';

const samples: Record<string, { path: string; content: string }> = {
  typescript: { path: 'src/sample.ts', content: "import { helper } from './helper';\nexport class Child extends Base implements Contract { run(){ const value = helper(); return value; } }" },
  javascript: { path: 'src/sample.js', content: "import helper from './helper.js';\nexport class Child extends Base { run(){ const value = helper(); return value; } }" },
  python: { path: 'src/sample.py', content: "import os\nclass Child(Base):\n    def run(self):\n        value = helper()\n        return value" },
  java: { path: 'src/Sample.java', content: 'import java.util.List;\npublic class Child extends Base implements Contract { public void run(){ helper(); } }' },
  csharp: { path: 'src/Sample.cs', content: 'using System;\npublic class Child : Base, IContract { public void Run(){ Helper(); } }' },
  go: { path: 'src/sample.go', content: 'package sample\nimport "fmt"\nfunc Run(){ value := helper(); fmt.Println(value) }' },
  rust: { path: 'src/sample.rs', content: 'use std::fmt;\ntrait Contract {}\nstruct Child {}\nimpl Contract for Child { fn run(){ let value = helper(); } }' },
  kotlin: { path: 'src/Sample.kt', content: 'import sample.Helper\nclass Child : Base(), Contract { fun run(){ val value = helper() } }' },
  c: { path: 'src/sample.c', content: '#include <stdio.h>\nint run(){ int value = helper(); return value; }' },
  cpp: { path: 'src/sample.cpp', content: '#include <vector>\nclass Child : public Base { public: int run(){ int value = helper(); return value; } };' },
  php: { path: 'src/sample.php', content: "<?php require 'helper.php'; class Child extends Base implements Contract { public function run(){ $value = helper(); } }" },
  ruby: { path: 'src/sample.rb', content: "require './helper'\nclass Child < Base\n def run\n  value = helper()\n end\nend" },
  swift: { path: 'src/Sample.swift', content: 'import Foundation\nclass Child: Base, Contract { func run(){ let value = helper() } }' },
  scala: { path: 'src/Sample.scala', content: 'import sample.Helper\nclass Child extends Base with Contract { def run() = helper() }' },
  dart: { path: 'src/sample.dart', content: "import 'helper.dart';\nclass Child extends Base implements Contract { void run(){ var value = helper(); } }" },
  'objective-c': { path: 'src/Sample.m', content: '#import <Foundation/Foundation.h>\n@interface Child : Base\n- (void)run;\n@end' },
  lua: { path: 'src/sample.lua', content: "local helper = require('helper')\nfunction run()\n local value = helper()\nend" },
  groovy: { path: 'src/Sample.groovy', content: 'import sample.Helper\nclass Child extends Base { def run(){ def value = helper() } }' },
  elixir: { path: 'src/sample.ex', content: 'defmodule Child do\n def run do\n  value = helper()\n end\nend' },
  erlang: { path: 'src/sample.erl', content: '-module(sample).\n-export([run/0]).\nrun() -> Value = helper(), Value.' },
  haskell: { path: 'src/Sample.hs', content: 'import Data.List\nrun value = helper value' },
  r: { path: 'src/sample.R', content: 'library(stats)\nrun <- function() { value <- helper; value }' },
  julia: { path: 'src/sample.jl', content: 'using JSON\nfunction run()\n value = helper()\nend' },
  perl: { path: 'src/sample.pl', content: 'use strict;\nsub run { my $value = helper(); return $value; }' },
  shell: { path: 'scripts/sample.sh', content: '#!/bin/sh\nsource ./helper.sh\nrun() { value=helper; echo "$value"; }' },
  powershell: { path: 'scripts/sample.ps1', content: 'Import-Module ./Helper.psm1\nfunction Invoke-Run { $value = Invoke-Helper }' },
  sql: { path: 'db/schema.sql', content: 'CREATE TABLE sample (id INTEGER);\nCREATE VIEW active_sample AS SELECT id FROM sample;' },
  graphql: { path: 'schema/sample.graphql', content: 'type Query { sample: Sample }\ntype Sample { id: ID! }' },
  protobuf: { path: 'schema/sample.proto', content: 'syntax = "proto3";\nmessage Sample { string id = 1; }\nservice SampleService {}' },
  html: { path: 'web/index.html', content: '<main id="sample"><button>Run</button></main>' },
  css: { path: 'web/sample.css', content: '.sample { display: block; }' },
  json: { path: 'config/sample.json', content: '{\n  "sample": true\n}' },
  yaml: { path: 'config/sample.yaml', content: 'sample: true\nitems:\n  - one' },
  toml: { path: 'config/sample.toml', content: '[sample]\nenabled = true' },
  xml: { path: 'config/sample.xml', content: '<project><sample enabled="true" /></project>' },
  markdown: { path: 'docs/sample.md', content: '# Sample\nDocumentation.' },
  terraform: { path: 'infra/main.tf', content: 'resource "aws_s3_bucket" "sample" {\n  bucket = var.name\n}' },
  dockerfile: { path: 'Dockerfile', content: 'FROM node:22 AS build\nRUN npm test' },
  make: { path: 'Makefile', content: 'build:\n\t@echo build' },
  cmake: { path: 'CMakeLists.txt', content: 'add_executable(sample main.cpp)' },
  maven: { path: 'pom.xml', content: '<project><artifactId>sample</artifactId></project>' },
  gradle: { path: 'build.gradle', content: "task sample { doLast { println 'sample' } }" },
  kubernetes: { path: 'k8s/deployment.yaml', content: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: sample' },
};

describe('language adapter conformance', () => {
  it('executes every declared language and artifact frontend', () => {
    const registry = new LanguageCapabilityRegistry();
    expect(LANGUAGE_DEFINITIONS).toHaveLength(43);
    expect(Object.keys(samples).sort()).toEqual(LANGUAGE_DEFINITIONS.map(item => item.id).sort());

    for (const definition of LANGUAGE_DEFINITIONS) {
      const fixture = samples[definition.id];
      expect(registry.identify(fixture.path)?.id).toBe(definition.id);
      const analysis = analyzeLanguageFile(fixture.path, fixture.content);
      expect(analysis?.language.id).toBe(definition.id);
      expect(analysis!.symbols.length).toBeGreaterThan(0);
      const graph = buildUniversalCpg({ sourcePath: fixture.path, content: fixture.content, language: definition.id });
      expect(graph.language).toBe(definition.id);
      expect(graph.nodes.length).toBeGreaterThan(1);
      expect(graph.edges.some(edge => edge.kind === 'ast')).toBe(true);
      expect(graph.capabilities.ast).toBe(true);
      expect(graph.capabilities.cfg).toBe(true);
      expect(graph.capabilities.dfg).toBe(true);
      expect(graph.capabilities.cdg).toBe(true);
    }
  });

  it('indexes every registered category plus an unknown text language through OKF and CPG end to end', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-all-languages-'));
    for (const [id, fixture] of Object.entries(samples)) {
      const target = path.join(root, id, fixture.path);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, fixture.content, 'utf8');
    }
    const unknownPath = 'unknown/custom.futurelang';
    await fs.mkdir(path.join(root, 'unknown'), { recursive: true });
    await fs.writeFile(path.join(root, unknownPath), 'module Future { function execute(input) { output = input; return output; } }', 'utf8');
    const result = await buildRepositoryIntelligence(root, { cognitive: true });
    expect(result.intelligence.files).toHaveLength(LANGUAGE_DEFINITIONS.length + 1);
    const supportIds = new Set(result.intelligence.languageSupport?.map(item => item.id));
    for (const definition of LANGUAGE_DEFINITIONS) expect(supportIds.has(definition.id)).toBe(true);
    expect(supportIds.has('unknown')).toBe(true);
    const okf = await new OkfSnapshotStore(root).read();
    expect(okf).toBeDefined();
    const activeFilePaths = new Set(okf!.units.filter(unit => ['file', 'test', 'documentation', 'configuration'].includes(unit.kind) && unit.lifecycle === 'active').map(unit => String(unit.properties.path)));
    for (const file of result.intelligence.files) expect(activeFilePaths.has(file.path)).toBe(true);
    const cpg = new CpgShardStore(root);
    for (const file of result.intelligence.files) {
      const graph = await cpg.get(file.path);
      expect(graph).toBeDefined();
      expect(graph!.nodes.length).toBeGreaterThan(0);
      expect(graph!.nodes.some(node => Boolean(node.okfId))).toBe(true);
    }
  });

});
