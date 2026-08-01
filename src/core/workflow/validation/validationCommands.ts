import fs from 'node:fs/promises';
import path from 'node:path';

export interface DetectedValidationCommands {
  all: string[];
  impacted: string[];
  ecosystem: string;
}

export async function detectValidationCommands(root: string): Promise<DetectedValidationCommands> {
  const node = await readJson<{ scripts?: Record<string, string>; packageManager?: string }>(path.join(root, 'package.json'));
  if (node) {
    const manager = await nodePackageManager(root, node.packageManager);
    const scripts = node.scripts ?? {};
    const command = (name: string): string => manager === 'npm' ? `npm run ${name}` : `${manager} run ${name}`;
    const all = ['typecheck', 'check', 'lint', 'test'].filter((name, index, values) => Boolean(scripts[name]) && (name !== 'check' || !scripts.typecheck) && values.indexOf(name) === index).map(command);
    const impacted = scripts['test:changed'] ? [command('test:changed')] : scripts['test:unit'] ? [command('test:unit')] : scripts.test ? [command('test')] : [];
    return { all, impacted, ecosystem: `node:${manager}` };
  }
  if (await exists(root, 'pyproject.toml') || await exists(root, 'pytest.ini') || await exists(root, 'setup.cfg')) return { all: ['python -m pytest'], impacted: ['python -m pytest'], ecosystem: 'python' };
  if (await exists(root, 'go.mod')) return { all: ['go test ./...'], impacted: ['go test ./...'], ecosystem: 'go' };
  if (await exists(root, 'Cargo.toml')) return { all: ['cargo test'], impacted: ['cargo test'], ecosystem: 'rust' };
  if (await exists(root, 'gradlew')) return { all: ['./gradlew test'], impacted: ['./gradlew test'], ecosystem: 'gradle' };
  if (await exists(root, 'pom.xml')) return { all: ['mvn test'], impacted: ['mvn test'], ecosystem: 'maven' };
  return { all: [], impacted: [], ecosystem: 'unknown' };
}

async function nodePackageManager(root: string, declared?: string): Promise<'pnpm' | 'yarn' | 'bun' | 'npm'> {
  const name = declared?.split('@')[0];
  if (name === 'pnpm' || name === 'yarn' || name === 'bun' || name === 'npm') return name;
  if (await exists(root, 'pnpm-lock.yaml')) return 'pnpm';
  if (await exists(root, 'yarn.lock')) return 'yarn';
  if (await exists(root, 'bun.lock') || await exists(root, 'bun.lockb')) return 'bun';
  return 'npm';
}

async function exists(root: string, name: string): Promise<boolean> { return fs.access(path.join(root, name)).then(() => true).catch(() => false); }
async function readJson<T>(target: string): Promise<T | undefined> { try { return JSON.parse(await fs.readFile(target, 'utf8')) as T; } catch { return undefined; } }
