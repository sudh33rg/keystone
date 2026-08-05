import fs from 'node:fs';
import assert from 'node:assert/strict';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.equal(`${pkg.publisher}.${pkg.name}`, 'keystone-dev.keystone', 'POC must replace the existing Keystone extension identity');
assert.deepEqual(pkg.activationEvents, ['onView:keystone.pocView']);
assert.equal(pkg.contributes?.viewsContainers?.activitybar?.length, 1, 'Exactly one Activity Bar container is allowed');
assert.equal(pkg.contributes?.views?.keystone?.length, 1, 'Exactly one Keystone view is allowed');
assert.equal(pkg.contributes.views.keystone[0].id, 'keystone.pocView');
assert.equal(pkg.contributes.menus, undefined, 'POC must not contribute VS Code menus');
assert.equal(pkg.contributes.commands, undefined, 'POC must not contribute command menu entries');
assert.equal(fs.existsSync('package-lock.json'), false, 'package-lock.json must stay removed');
assert.equal(fs.existsSync('src/extension/PocPanel.ts'), false, 'Old editor-panel shell must not remain');

const ui = fs.readFileSync('src/ui/app.js', 'utf8');
for (const old of ['Active Workflow', 'Task Handoff', 'Delivery', 'PR Review', 'Diagnostics']) {
  assert.equal(ui.includes(old), false, `Old UI navigation term still present: ${old}`);
}
assert.ok(ui.includes('Repository-aware story generation'));
assert.ok(ui.includes('Generate from a ValueEdge Feature'));
assert.ok(ui.includes('User Stories'));
assert.ok(ui.includes('Quality Stories'));

console.log('POC_SCOPE_PASS: keystone-dev.keystone; 1 Activity Bar container; 1 webview; 0 menus; 0 commands; no old panel shell; no lockfile');
