import fs from 'node:fs/promises';
import path from 'node:path';

export interface DetectedValidationCommands {
  all: string[];
  impacted: string[];
  ecosystem: string;
}

interface CommandSet {
  ecosystem: string;
  all: string[];
  impacted?: string[];
}

/**
 * Detect validation commands only when the repository contains an ecosystem
 * marker that makes the command defensible. Detection is additive so a
 * polyglot workspace can validate more than the first ecosystem encountered.
 * No command is executed here.
 */
export async function detectValidationCommands(root: string): Promise<DetectedValidationCommands> {
  const sets: CommandSet[] = [];
  const rootEntries = await listRoot(root);
  const hasRootSuffix = (suffix: string): boolean => rootEntries.some((entry) => entry.endsWith(suffix));

  const node = await readJson<{ scripts?: Record<string, unknown>; packageManager?: string }>(path.join(root, 'package.json'));
  if (node) {
    const manager = await nodePackageManager(root, node.packageManager);
    const scripts = node.scripts ?? {};
    const command = (name: string): string => manager === 'npm' ? `npm run ${name}` : `${manager} run ${name}`;
    const available = (name: string): boolean => typeof scripts[name] === 'string' && Boolean(String(scripts[name]).trim());
    const all = ['typecheck', 'check', 'lint', 'test']
      .filter((name, index, values) => available(name) && (name !== 'check' || !available('typecheck')) && values.indexOf(name) === index)
      .map(command);
    const impacted = available('test:changed') ? [command('test:changed')] : available('test:unit') ? [command('test:unit')] : available('test') ? [command('test')] : [];
    if (all.length || impacted.length) sets.push({ ecosystem: `node:${manager}`, all, impacted });
  }

  if (await anyExists(root, ['pyproject.toml', 'pytest.ini', 'setup.cfg', 'tox.ini']) || await directoryExists(root, 'tests')) {
    if (await looksLikePython(root, rootEntries)) sets.push({ ecosystem: 'python', all: ['python -m pytest'], impacted: ['python -m pytest'] });
  }
  if (await exists(root, 'go.mod')) sets.push({ ecosystem: 'go', all: ['go test ./...'], impacted: ['go test ./...'] });
  if (await exists(root, 'Cargo.toml')) sets.push({ ecosystem: 'rust', all: ['cargo test'], impacted: ['cargo test'] });

  if (hasRootSuffix('.sln') || hasRootSuffix('.csproj') || hasRootSuffix('.fsproj') || hasRootSuffix('.vbproj')) {
    sets.push({ ecosystem: 'dotnet', all: ['dotnet test'], impacted: ['dotnet test'] });
  }

  if (await exists(root, 'gradlew')) sets.push({ ecosystem: 'gradle', all: ['./gradlew test'], impacted: ['./gradlew test'] });
  else if (await anyExists(root, ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'])) sets.push({ ecosystem: 'gradle', all: ['gradle test'], impacted: ['gradle test'] });
  if (await exists(root, 'pom.xml')) sets.push({ ecosystem: 'maven', all: ['mvn test'], impacted: ['mvn test'] });

  const composer = await readJson<{ scripts?: Record<string, unknown>; require?: Record<string, unknown>; 'require-dev'?: Record<string, unknown> }>(path.join(root, 'composer.json'));
  if (composer) {
    const hasComposerTest = Boolean(composer.scripts && typeof composer.scripts.test !== 'undefined');
    const hasPhpUnit = await anyExists(root, ['phpunit.xml', 'phpunit.xml.dist', 'vendor/bin/phpunit']) || Boolean(composer['require-dev']?.['phpunit/phpunit']);
    if (hasComposerTest) sets.push({ ecosystem: 'php:composer', all: ['composer test'], impacted: ['composer test'] });
    else if (hasPhpUnit) sets.push({ ecosystem: 'php:phpunit', all: ['vendor/bin/phpunit'], impacted: ['vendor/bin/phpunit'] });
  }

  if (await exists(root, 'Gemfile')) {
    if (await directoryExists(root, 'spec') || await exists(root, '.rspec')) sets.push({ ecosystem: 'ruby:rspec', all: ['bundle exec rspec'], impacted: ['bundle exec rspec'] });
    else if (await directoryExists(root, 'test') || await exists(root, 'Rakefile')) sets.push({ ecosystem: 'ruby:rake', all: ['bundle exec rake test'], impacted: ['bundle exec rake test'] });
  }

  if (await exists(root, 'Package.swift')) sets.push({ ecosystem: 'swift', all: ['swift test'], impacted: ['swift test'] });
  if (await exists(root, 'build.sbt')) sets.push({ ecosystem: 'scala:sbt', all: ['sbt test'], impacted: ['sbt test'] });
  if (await exists(root, 'pubspec.yaml')) sets.push({ ecosystem: 'dart', all: ['dart test'], impacted: ['dart test'] });
  if (await exists(root, 'mix.exs')) sets.push({ ecosystem: 'elixir', all: ['mix test'], impacted: ['mix test'] });
  if (await exists(root, 'rebar.config')) sets.push({ ecosystem: 'erlang:rebar3', all: ['rebar3 eunit'], impacted: ['rebar3 eunit'] });

  if (await exists(root, 'stack.yaml')) sets.push({ ecosystem: 'haskell:stack', all: ['stack test'], impacted: ['stack test'] });
  else if (hasRootSuffix('.cabal') || await exists(root, 'cabal.project')) sets.push({ ecosystem: 'haskell:cabal', all: ['cabal test all'], impacted: ['cabal test all'] });

  if (await exists(root, 'Project.toml') && await looksLikeJuliaProject(root)) {
    sets.push({ ecosystem: 'julia', all: ['julia --project -e "using Pkg; Pkg.test()"'], impacted: ['julia --project -e "using Pkg; Pkg.test()"'] });
  }

  if ((await exists(root, 'Makefile.PL') || await exists(root, 'Build.PL')) && await directoryExists(root, 't')) {
    sets.push({ ecosystem: 'perl', all: ['prove -lr t'], impacted: ['prove -lr t'] });
  }

  if (await exists(root, 'DESCRIPTION')) {
    sets.push({ ecosystem: 'r', all: ['R CMD check --no-manual .'], impacted: ['R CMD check --no-manual .'] });
  }

  if (await exists(root, 'CMakeLists.txt') && await exists(root, 'build/CTestTestfile.cmake')) {
    sets.push({ ecosystem: 'cmake:ctest', all: ['ctest --test-dir build --output-on-failure'], impacted: ['ctest --test-dir build --output-on-failure'] });
  } else if (await hasMakeTestTarget(root)) {
    sets.push({ ecosystem: 'make', all: ['make test'], impacted: ['make test'] });
  }

  if (await containsFileWithSuffix(path.join(root, 'tests'), '.Tests.ps1')) {
    sets.push({ ecosystem: 'powershell:pester', all: ['pwsh -NoProfile -Command "Invoke-Pester -CI"'], impacted: ['pwsh -NoProfile -Command "Invoke-Pester -CI"'] });
  }
  if (await containsFileWithSuffix(path.join(root, 'test'), '.bats') || await containsFileWithSuffix(path.join(root, 'tests'), '.bats')) {
    const dir = await containsFileWithSuffix(path.join(root, 'test'), '.bats') ? 'test' : 'tests';
    sets.push({ ecosystem: 'shell:bats', all: [`bats ${dir}`], impacted: [`bats ${dir}`] });
  }

  const all = dedupe(sets.flatMap((set) => set.all));
  const impacted = dedupe(sets.flatMap((set) => set.impacted ?? set.all));
  return { all, impacted, ecosystem: sets.length ? sets.map((set) => set.ecosystem).join('+') : 'unknown' };
}

async function nodePackageManager(root: string, declared?: string): Promise<'pnpm' | 'yarn' | 'bun' | 'npm'> {
  const name = declared?.split('@')[0];
  if (name === 'pnpm' || name === 'yarn' || name === 'bun' || name === 'npm') return name;
  if (await exists(root, 'pnpm-lock.yaml')) return 'pnpm';
  if (await exists(root, 'yarn.lock')) return 'yarn';
  if (await exists(root, 'bun.lock') || await exists(root, 'bun.lockb')) return 'bun';
  return 'npm';
}

async function looksLikePython(root: string, entries: string[]): Promise<boolean> {
  if (await anyExists(root, ['pyproject.toml', 'pytest.ini', 'tox.ini'])) return true;
  if (entries.some((entry) => entry.endsWith('.py'))) return true;
  return containsFileWithSuffix(path.join(root, 'tests'), '.py');
}

async function looksLikeJuliaProject(root: string): Promise<boolean> {
  if (await directoryExists(root, 'test')) return true;
  const text = await readText(path.join(root, 'Project.toml'));
  return /\bname\s*=|\[deps\]|\[extras\]/m.test(text ?? '');
}

async function hasMakeTestTarget(root: string): Promise<boolean> {
  const text = await readText(path.join(root, 'Makefile'));
  return Boolean(text && /^test\s*:/m.test(text));
}

async function containsFileWithSuffix(directory: string, suffix: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && entry.name.endsWith(suffix));
  } catch {
    return false;
  }
}

async function listRoot(root: string): Promise<string[]> {
  try { return await fs.readdir(root); } catch { return []; }
}

async function directoryExists(root: string, name: string): Promise<boolean> {
  try { return (await fs.stat(path.join(root, name))).isDirectory(); } catch { return false; }
}

async function anyExists(root: string, names: string[]): Promise<boolean> {
  for (const name of names) if (await exists(root, name)) return true;
  return false;
}

async function exists(root: string, name: string): Promise<boolean> {
  return fs.access(path.join(root, name)).then(() => true).catch(() => false);
}

async function readText(target: string): Promise<string | undefined> {
  try { return await fs.readFile(target, 'utf8'); } catch { return undefined; }
}

async function readJson<T>(target: string): Promise<T | undefined> {
  try { return JSON.parse(await fs.readFile(target, 'utf8')) as T; } catch { return undefined; }
}

function dedupe(values: string[]): string[] { return [...new Set(values)]; }
