import { build, context } from 'esbuild';
const options = {
  entryPoints: ['src/extension/core/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  external: ['vscode'],
  alias: { '@core': './src/core', '@vscode': './src/extension', '@webview': './src/webview' },
  outfile: 'dist/extension.js',
  sourcemap: true,
  minify: false,
  logLevel: 'warning'
};
const worker = { ...options, entryPoints: ['src/extension/workers/backgroundAnalysisWorker.ts'], outfile: 'dist/backgroundAnalysisWorker.js', sourcemap: false };
if (process.argv.includes('--watch')) {
  const extensionContext = await context(options); await extensionContext.watch();
  const workerContext = await context(worker); await workerContext.watch();
} else { await build(options); await build(worker); }
