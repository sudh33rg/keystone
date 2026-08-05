(() => {
  const root = document.getElementById("root");
  if (!root) throw new Error("Keystone POC root element is missing.");

  root.innerHTML = `
  <main class="page-shell">
    <header class="hero">
      <div>
        <span class="eyebrow">VALUEEDGE POC</span>
        <h1>Repository-aware story generation</h1>
        <p>ValueEdge feature intent is enriched with Keystone's local repository intelligence before User Stories and Quality Stories are created.</p>
      </div>
      <div class="scope-pill">Local intelligence · ValueEdge API</div>
    </header>

    <section class="status-grid" aria-label="POC readiness">
      <div class="status-card">
        <div class="status-heading"><span id="intel-dot" class="dot warn"></span><span class="status-label">Repository Intelligence</span></div>
        <strong id="intel-value">Checking…</strong>
        <span id="intel-detail">Reading local intelligence.</span>
      </div>
      <div class="status-card">
        <div class="status-heading"><span id="ve-dot" class="dot warn"></span><span class="status-label">ValueEdge</span></div>
        <strong id="ve-value">Checking…</strong>
        <span id="ve-detail">Checking REST configuration.</span>
      </div>
      <div class="status-card metrics-card">
        <span class="status-label">Intelligence evidence</span>
        <strong id="metric-value">0 symbols</strong>
        <span id="metric-detail">0 files · 0 relationships · 0 tests</span>
      </div>
    </section>

    <section class="action-panel">
      <div class="action-copy">
        <h2>Generate from a ValueEdge Feature</h2>
        <p>The feature description is not used alone. Keystone first searches the current repository intelligence and carries concrete implementation and test evidence into every proposed story.</p>
      </div>
      <div class="feature-form">
        <label for="feature-id">ValueEdge Feature ID</label>
        <div class="feature-input-row">
          <input id="feature-id" placeholder="e.g. 7421" autocomplete="off">
          <button id="generate-button" class="primary" disabled>Generate stories</button>
        </div>
        <div class="inline-actions">
          <button id="refresh-button" class="link-button">Refresh status</button>
          <button id="rebuild-button" class="link-button">Rebuild intelligence</button>
          <button id="settings-button" class="link-button">Open ValueEdge settings</button>
        </div>
      </div>
    </section>

    <div id="progress" class="progress-banner" hidden><span class="spinner"></span><span id="progress-text">Working…</span></div>
    <div id="message" class="message" hidden></div>

    <section id="results" class="results" hidden>
      <div class="results-header">
        <div>
          <span id="feature-label" class="eyebrow"></span>
          <h2 id="feature-name"></h2>
          <p id="feature-description"></p>
        </div>
        <div class="result-summary">
          <strong id="story-count">0</strong><span>repo-aware stories</span><small id="evidence-count">0 matched evidence records</small>
        </div>
      </div>
      <div id="user-group" class="story-section"><div class="section-title"><h3>User Stories</h3><span id="user-count">0</span></div><div id="user-list" class="story-list"></div></div>
      <div id="quality-group" class="story-section"><div class="section-title"><h3>Quality Stories</h3><span id="quality-count">0</span></div><div id="quality-list" class="story-list"></div></div>
      <div class="publish-bar">
        <div><strong>Review before publish</strong><span>All ValueEdge entities are created as drafts under Feature #<span id="publish-feature-id"></span>.</span></div>
        <div class="publish-actions"><button data-publish="story">Publish User Stories</button><button data-publish="quality_story">Publish Quality Stories</button><button data-publish="all" class="primary">Publish All</button></div>
      </div>
    </section>
  </main>`;

  const vscode = typeof acquireVsCodeApi === "function" ? acquireVsCodeApi() : null;
  const $ = (id) => document.getElementById(id);
  let latestStatus;
  let latestResult;
  let busy = false;

  function send(message) { if (vscode) vscode.postMessage(message); }
  function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch])); }
  function acceptance(html) {
    const doc = new DOMParser().parseFromString(html || "", "text/html");
    return [...doc.querySelectorAll("li")].map((node) => node.textContent.trim()).filter(Boolean);
  }
  function setBusy(value, message = "") {
    busy = value;
    $("progress").hidden = !value;
    $("progress-text").textContent = message || "Working…";
    renderControls();
  }
  function showMessage(kind, text) {
    const box = $("message");
    box.className = `message ${kind}`;
    box.textContent = text;
    box.hidden = false;
  }
  function clearMessage() { $("message").hidden = true; }

  function renderStatus(status) {
    latestStatus = status;
    const intel = status.intelligence;
    $("intel-dot").className = `dot ${intel.generation ? "good" : "warn"}`;
    $("intel-value").textContent = intel.generation ? `Generation ${intel.generation}` : "Not ready";
    $("intel-detail").textContent = intel.repository ? `${intel.repository}${intel.branch ? ` · ${intel.branch}` : ""}` : "Open a local repository and build intelligence.";
    $("ve-dot").className = `dot ${status.config.configured ? "good" : "warn"}`;
    $("ve-value").textContent = status.config.configured ? "Configured" : "Configuration required";
    $("ve-detail").textContent = status.config.configured ? "REST connection settings are present." : `Missing: ${status.config.missing.join(", ") || "settings"}`;
    $("metric-value").textContent = `${intel.counts.symbols || 0} symbols`;
    $("metric-detail").textContent = `${intel.counts.files || 0} files · ${intel.counts.relationships || 0} relationships · ${intel.counts.tests || 0} tests`;
    $("settings-button").hidden = status.config.configured;
    renderControls();
  }

  function renderControls() {
    const id = $("feature-id").value.trim();
    const configured = Boolean(latestStatus?.config?.configured);
    const intelligenceReady = Boolean(latestStatus?.intelligence?.generation);
    $("generate-button").disabled = busy || !id || !configured || !intelligenceReady;
    document.querySelectorAll("[data-publish]").forEach((button) => button.disabled = busy || !latestResult);
  }

  function renderResults(result) {
    latestResult = result;
    const section = $("results");
    if (!result) { section.hidden = true; renderControls(); return; }
    const userStories = result.stories.filter((story) => story.kind === "story");
    const qualityStories = result.stories.filter((story) => story.kind === "quality_story");
    $("feature-label").textContent = `FEATURE #${result.feature.id}`;
    $("feature-name").textContent = result.feature.name;
    $("feature-description").textContent = result.feature.description || "";
    $("story-count").textContent = String(result.stories.length);
    $("evidence-count").textContent = `${result.evidenceCount} matched evidence records`;
    renderGroup("user-group", "user-list", "user-count", userStories);
    renderGroup("quality-group", "quality-list", "quality-count", qualityStories);
    $("publish-feature-id").textContent = result.feature.id;
    section.hidden = false;
    renderControls();
  }

  function renderGroup(groupId, listId, countId, stories) {
    $(countId).textContent = String(stories.length);
    $(listId).innerHTML = stories.map((story, index) => storyCard(story, index + 1)).join("");
    $(groupId).hidden = stories.length === 0;
  }

  function storyCard(story, index) {
    const criteria = acceptance(story.description).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    const evidence = story.evidence.map((item) => `<div class="evidence-row"><span class="evidence-type">${escapeHtml(item.type)}</span><code title="${escapeHtml(item.qualifiedName)}">${escapeHtml(item.qualifiedName)}</code><span class="path" title="${escapeHtml(item.relativePath)}">${escapeHtml(item.relativePath)}</span>${item.matchedTerm ? `<span class="match">matched: ${escapeHtml(item.matchedTerm)}</span>` : ""}</div>`).join("");
    return `<article class="story-card"><div class="story-index">${String(index).padStart(2, "0")}</div><div class="story-body"><h4>${escapeHtml(story.name)}</h4><p class="rationale">${escapeHtml(story.rationale)}</p><div class="criteria"><strong>Acceptance criteria</strong><ul>${criteria}</ul></div><div class="evidence"><strong>Repository evidence</strong><div class="evidence-list">${evidence}</div></div></div></article>`;
  }

  window.addEventListener("message", (event) => {
    const data = event.data || {};
    if (data.type === "status") renderStatus(data.payload);
    if (data.type === "generated") { renderResults(data.payload); clearMessage(); }
    if (data.type === "busy") setBusy(Boolean(data.value), data.message);
    if (data.type === "error") showMessage("error", data.message);
    if (data.type === "notice") showMessage("info", data.message);
    if (data.type === "published") showMessage("success", `Published ${data.count} draft ${data.count === 1 ? "story" : "stories"} to ValueEdge.`);
  });

  $("feature-id").addEventListener("input", renderControls);
  $("generate-button").addEventListener("click", () => { renderResults(undefined); clearMessage(); send({ type: "generate", featureId: $("feature-id").value }); });
  $("refresh-button").addEventListener("click", () => send({ type: "refresh" }));
  $("rebuild-button").addEventListener("click", () => send({ type: "rebuild" }));
  $("settings-button").addEventListener("click", () => send({ type: "openSettings" }));
  document.querySelectorAll("[data-publish]").forEach((button) => button.addEventListener("click", () => send({ type: "publish", mode: button.dataset.publish })));

  if (vscode) send({ type: "ready" });
  else loadVisualPreview();

  function loadVisualPreview() {
    $("feature-id").value = "7421";
    renderStatus({ config: { configured: true, missing: [] }, intelligence: { generation: 7, repository: "fixture-fullstack", branch: "main", counts: { symbols: 92, files: 31, relationships: 148, tests: 12 } } });
    const evidence = (id, type, qualifiedName, relativePath, matchedTerm) => ({ id, type, name: qualifiedName.split(".").pop(), qualifiedName, relativePath, language: "typescript", confidence: .95, matchedTerm });
    renderResults({ feature: { id: "7421", name: "Support saved payment method during checkout", description: "Allow a shopper to complete checkout using a previously saved payment method while preserving validation, order creation, and notification behavior." }, generation: 7, evidenceCount: 17, stories: [
      { kind: "story", name: "Integrate saved payment checkout with the existing API/service contract", rationale: "Repository intelligence found the established checkout API and service path, so the feature can extend the existing contract instead of inventing a parallel flow.", description: "<ul><li>Route saved-payment checkout through createCheckout, POST /checkout, CheckoutController and CheckoutService.</li><li>Preserve existing validation and error-response conventions.</li><li>Do not create an order when saved-payment validation fails.</li></ul>", evidence: [evidence("1","function","createCheckout","ui/src/api/checkoutApi.ts","checkout"),evidence("2","route","POST /checkout","server/src/routes/checkout.ts","checkout"),evidence("3","class","CheckoutService.process","server/src/services/CheckoutService.ts","payment")] },
      { kind: "story", name: "Persist saved payment checkout using the existing order model", rationale: "Existing repository and model touchpoints make persistence behavior an explicit part of the feature scope.", description: "<ul><li>Use OrderRepository and the existing Order entity for resulting order changes.</li><li>Keep existing records and callers backward-compatible.</li><li>Verify create, read and failure behavior on the affected persistence path.</li></ul>", evidence: [evidence("4","class","OrderRepository","server/src/repositories/OrderRepository.ts","order"),evidence("5","entity","Order","server/src/models/Order.ts","order")] },
      { kind: "quality_story", name: "Extend existing automated coverage for saved payment checkout", rationale: "Existing checkout tests were found, so new coverage can extend established suites rather than creating disconnected tests.", description: "<ul><li>Extend CheckoutPage.test.tsx and the checkout integration suite.</li><li>Cover positive, negative, boundary and regression cases.</li><li>Exercise the impacted UI, API, service and persistence touchpoints.</li></ul>", evidence: [evidence("6","test","CheckoutPage.test.tsx","ui/tests/unit/CheckoutPage.test.tsx","checkout"),evidence("7","test","checkout integration","server/tests/integration/checkout.test.ts","checkout")] }
    ] });
  }
})();
