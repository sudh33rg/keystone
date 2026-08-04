import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const distPath = join(__dirname, '..', 'dist');
const coveragePath = join(__dirname, '..', 'coverage');

await rm(distPath, { recursive: true, force: true });
await rm(coveragePath, { recursive: true, force: true });
