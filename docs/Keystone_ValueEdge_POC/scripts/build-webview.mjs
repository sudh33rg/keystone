import { cp, mkdir } from 'node:fs/promises';
await mkdir('dist/webview/assets', { recursive: true });
await cp('src/ui/app.js', 'dist/webview/assets/app.js');
await cp('src/ui/app.css', 'dist/webview/assets/app.css');
await cp('src/ui/index.html', 'dist/webview/index.html');
