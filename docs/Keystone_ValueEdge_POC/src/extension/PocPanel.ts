import * as vscode from "vscode";
import type { ValueEdgePoc, PocGenerationResult } from "../poc/ValueEdgePoc";
import type { GeneratedStory } from "../poc/storyGenerator";

interface GenerateMessage { type: "generate"; featureId: string }
interface PublishMessage { type: "publish"; mode: "all" | "story" | "quality_story" }
interface SimpleMessage { type: "ready" | "refresh" | "rebuild" | "openSettings" }
type UiMessage = GenerateMessage | PublishMessage | SimpleMessage;

export class PocPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private latest?: PocGenerationResult;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly poc: ValueEdgePoc,
    private readonly rebuildIntelligence: () => void,
  ) {}

  show(): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      "keystoneValueEdgePoc",
      "Keystone · ValueEdge POC",
      vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: false, localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")] },
    );
    this.panel.webview.html = this.html(this.panel.webview);
    this.panel.onDidDispose(() => { this.panel = undefined; this.latest = undefined; }, undefined, this.disposables);
    this.panel.webview.onDidReceiveMessage((message: UiMessage) => void this.handle(message), undefined, this.disposables);
  }

  dispose(): void {
    this.panel?.dispose();
    vscode.Disposable.from(...this.disposables).dispose();
  }

  private async handle(message: UiMessage): Promise<void> {
    try {
      if (message.type === "ready" || message.type === "refresh") {
        await this.sendStatus();
        return;
      }
      if (message.type === "openSettings") {
        await this.poc.openSettings();
        await this.sendStatus();
        return;
      }
      if (message.type === "rebuild") {
        this.rebuildIntelligence();
        this.post({ type: "notice", level: "info", message: "Repository intelligence rebuild started." });
        await this.sendStatus();
        return;
      }
      if (message.type === "generate") {
        const featureId = message.featureId.trim();
        if (!featureId) throw new Error("Enter a ValueEdge Feature ID.");
        this.post({ type: "busy", value: true, message: "Reading ValueEdge feature and matching repository intelligence…" });
        this.latest = await this.poc.generate(featureId);
        this.post({ type: "generated", payload: this.latest });
        return;
      }
      if (message.type === "publish") {
        if (!this.latest) throw new Error("Generate stories before publishing.");
        const selected = selectStories(this.latest.stories, message.mode);
        if (!selected.length) throw new Error("There are no stories in the selected category.");
        this.post({ type: "busy", value: true, message: `Publishing ${selected.length} draft stor${selected.length === 1 ? "y" : "ies"} to ValueEdge…` });
        await this.poc.publish(this.latest.feature.id, selected);
        this.post({ type: "published", count: selected.length, mode: message.mode });
      }
    } catch (error) {
      this.post({ type: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      if (message.type === "generate" || message.type === "publish") this.post({ type: "busy", value: false });
    }
  }

  private async sendStatus(): Promise<void> {
    const [overview, config] = await Promise.all([this.poc.overview(), Promise.resolve(this.poc.configurationStatus())]);
    this.post({
      type: "status",
      payload: {
        config,
        intelligence: {
          status: overview.status,
          generation: overview.generation,
          pendingUpdate: overview.pendingUpdate,
          repository: overview.repository?.displayName,
          branch: overview.repository?.branch,
          updatedAt: overview.updatedAt,
          counts: overview.counts,
          phase: overview.runtime.phase,
        },
      },
    });
  }

  private post(value: unknown): void { void this.panel?.webview.postMessage(value); }

  private html(webview: vscode.Webview): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "assets", "app.js"));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "assets", "app.css"));
    const nonce = randomNonce();
    return `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';"><link rel="stylesheet" href="${style}"><title>Keystone ValueEdge POC</title></head><body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
  }
}

function selectStories(stories: GeneratedStory[], mode: PublishMessage["mode"]): GeneratedStory[] {
  if (mode === "all") return stories;
  return stories.filter((story) => story.kind === mode);
}
function randomNonce(): string { return Array.from({ length: 24 }, () => Math.random().toString(36)[2] ?? "x").join(""); }
