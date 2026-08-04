import http from 'node:http';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { generateRepoAwareStories } from '../src/poc/storyGenerator.ts';
import { ValueEdgeRestClient } from '../src/poc/ValueEdgeRestClient.ts';

const feature = {
  id: 'VE-7421',
  name: 'Support saved payment method during checkout',
  description: '<p>Allow a shopper to complete checkout using a previously saved payment method. Validation failures must be shown without creating an order, and successful checkout must keep the current order and notification flow.</p>'
};

const snapshot = JSON.parse(fs.readFileSync('tests/fixtures/benchmarks/fullstack/snapshot.json', 'utf8'));
const wanted = /checkout|payment|order|notification/i;
const evidence = [];
for (const s of snapshot.symbols) {
  if (!wanted.test(`${s.name} ${s.qualifiedName} ${s.filePath}`)) continue;
  evidence.push({
    id: s.id,
    type: s.kind,
    name: s.name,
    qualifiedName: s.qualifiedName,
    relativePath: s.filePath,
    language: s.filePath.endsWith('.tsx') ? 'tsx' : 'typescript',
    confidence: 0.95,
    matchedTerm: /payment/i.test(`${s.name} ${s.filePath}`) ? 'payment' : /order/i.test(`${s.name} ${s.filePath}`) ? 'order' : 'checkout'
  });
}
for (const f of snapshot.files) {
  if (!/test|spec/i.test(f.path) || !wanted.test(f.path)) continue;
  evidence.push({
    id: `file:${f.id}`,
    type: 'test_file',
    name: f.path.split('/').pop(),
    qualifiedName: `fixture-fullstack/${f.path}`,
    relativePath: f.path,
    language: f.language,
    confidence: 1,
    matchedTerm: 'checkout'
  });
}

const requests = [];
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const bodyText = Buffer.concat(chunks).toString('utf8');
  const record = { method: req.method, url: req.url, authorization: req.headers.authorization, body: bodyText ? JSON.parse(bodyText) : undefined };
  requests.push(record);

  if (req.method === 'GET' && req.url?.startsWith('/api/shared_spaces/1001/workspaces/2002/features/VE-7421')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: [feature] }));
    return;
  }
  if (req.method === 'POST' && /\/(stories|quality_stories)$/.test(req.url ?? '')) {
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: record.body?.data?.map((x, i) => ({ id: `${i + 1}`, ...x })) ?? [] }));
    return;
  }
  res.writeHead(404); res.end('not found');
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const client = new ValueEdgeRestClient({
  baseUrl: `http://127.0.0.1:${port}`,
  sharedSpaceId: '1001',
  workspaceId: '2002',
  authorization: 'Bearer POC_TEST_TOKEN'
});

try {
  const fetched = await client.fetchFeature('VE-7421');
  assert.equal(fetched.id, feature.id);
  assert.equal(fetched.name, feature.name);
  assert.ok(!fetched.description.includes('<p>'), 'Feature HTML should be normalized');

  const stories = generateRepoAwareStories(fetched, evidence, snapshot.manifest.generation ?? 7);
  const userStories = stories.filter(s => s.kind === 'story');
  const qualityStories = stories.filter(s => s.kind === 'quality_story');

  assert.equal(userStories.length, 4, 'Expected core + API + persistence + UI user stories');
  assert.equal(qualityStories.length, 3, 'Expected regression + automation + API compatibility quality stories');
  assert.ok(stories.every(s => s.evidence.length > 0), 'Every generated story must have repository evidence');

  const allText = stories.map(s => `${s.name}\n${s.description}`).join('\n');
  for (const expected of ['CheckoutController', 'CheckoutService', 'OrderRepository', 'CheckoutPage']) {
    assert.ok(allText.includes(expected), `Generated acceptance criteria should reference ${expected}`);
  }
  assert.ok(allText.includes('ui/tests/unit/CheckoutPage.test.tsx'), 'Quality story should reference existing UI test');
  assert.ok(allText.includes('server/tests/integration/checkout.test.ts'), 'Quality story should reference existing integration test');
  assert.ok(allText.includes('positive, negative, boundary, and regression'), 'Automation story should define meaningful coverage classes');
  assert.ok(!/Copilot/i.test(allText), 'Generated stories must not depend on Copilot');

  await client.publish(fetched.id, stories);
  const getRequest = requests.find(r => r.method === 'GET');
  const storyPost = requests.find(r => r.method === 'POST' && r.url.endsWith('/stories'));
  const qualityPost = requests.find(r => r.method === 'POST' && r.url.endsWith('/quality_stories'));
  assert.ok(getRequest && storyPost && qualityPost, 'Expected feature GET and both publish POST calls');
  assert.equal(getRequest.authorization, 'Bearer POC_TEST_TOKEN');
  assert.equal(storyPost.authorization, 'Bearer POC_TEST_TOKEN');
  assert.equal(storyPost.body.data.length, 4);
  assert.equal(qualityPost.body.data.length, 3);
  for (const item of [...storyPost.body.data, ...qualityPost.body.data]) {
    assert.deepEqual(item.parent, { type: 'feature', id: 'VE-7421' });
    assert.equal(item.is_draft, true);
    assert.ok(item.name.length <= 255);
    assert.ok(item.description.includes('Acceptance criteria'));
  }

  const report = {
    verifiedAt: new Date().toISOString(),
    fixture: 'tests/fixtures/benchmarks/fullstack/snapshot.json',
    fixtureGeneration: snapshot.manifest.generation,
    valueEdgeMock: {
      featureGet: getRequest,
      storiesPost: storyPost,
      qualityStoriesPost: qualityPost,
    },
    counts: { repositoryEvidence: evidence.length, userStories: userStories.length, qualityStories: qualityStories.length },
    stories,
    assertions: [
      'Feature was fetched through the ValueEdge REST client',
      'Feature HTML was normalized',
      '4 repository-aware user stories were generated',
      '3 repository-aware quality stories were generated',
      'Every story has concrete repository evidence',
      'Acceptance criteria reference controller/service/repository/UI touchpoints',
      'Quality stories reference existing unit and integration tests',
      'Stories contain no Copilot dependency',
      'User stories were POSTed to /stories as drafts under the selected feature',
      'Quality stories were POSTed to /quality_stories as drafts under the selected feature',
      'Authorization header was sent to the mock ValueEdge server'
    ]
  };
  fs.mkdirSync('scripts/poc-evidence', { recursive: true });
  fs.writeFileSync('scripts/poc-evidence/verification-report.json', JSON.stringify(report, null, 2));
  const md = ['# Keystone ValueEdge POC – Executable Verification Evidence', '', `Verified: ${report.verifiedAt}`, '', `Fixture intelligence: \`${report.fixture}\``, '', `Generated: **${userStories.length} user stories + ${qualityStories.length} quality stories** from **${evidence.length} repository evidence records**.`, '', ...stories.flatMap((s, i) => [
    `## ${i+1}. ${s.kind === 'story' ? 'User Story' : 'Quality Story'} — ${s.name}`,
    '', s.rationale, '', s.description.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(), '',
    '**Evidence**', ...s.evidence.map(e => `- ${e.type}: ${e.qualifiedName} — \`${e.relativePath}\``), ''
  ]), '## REST calls captured', '', '```json', JSON.stringify(requests, null, 2), '```', '', '## Assertions', '', ...report.assertions.map(x => `- PASS — ${x}`), ''];
  fs.writeFileSync('scripts/poc-evidence/verification-report.md', md.join('\n'));
  console.log(`PASS: ${userStories.length} user stories, ${qualityStories.length} quality stories, ${evidence.length} evidence records`);
  console.log('Evidence report: scripts/poc-evidence/verification-report.md');
} finally {
  server.close();
}
