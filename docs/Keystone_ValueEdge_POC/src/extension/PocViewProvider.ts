import * as vscode from "vscode";
import type { ValueEdgePoc, PocGenerationResult } from "../poc/ValueEdgePoc";
import type { GeneratedStory } from "../poc/storyGenerator";

interface GenerateMessage { type: "generate"; featureId: string }
interface PublishMessage { type: "publish"; mode: "all" | "story" | "quality_story" }
interface SimpleMessage { type: "ready" | "refresh" | "rebuild" | "openSettings" }
type UiMessage = GenerateMessage | PublishMessage | SimpleMessage;

export class PocViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = "keystone.pocView";

  private view?: vscode.WebviewView;
  private latest?: PocGenerationResult;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly poc?: ValueEdgePoc,
    private readonly rebuildIntelligence?: () => void,
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    this.latest = undefined;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")],
    };
    view.webview.html = this.html(view.webview);
    this.disposables.push(
      view.webview.onDidReceiveMessage((message: UiMessage) => void this.handle(message)),
      view.onDidDispose(() => {
        this.view = undefined;
        this.latest = undefined;
      }),
    );
  }

  dispose(): void {
    vscode.Disposable.from(...this.disposables).dispose();
    this.view = undefined;
    this.latest = undefined;
  }

  private async handle(message: UiMessage): Promise<void> {
    try {
      if (message.type === "ready" || message.type === "refresh") {
        await this.sendStatus();
        return;
      }
      if (message.type === "openSettings") {
        if (this.poc) await this.poc.openSettings();
        else await vscode.commands.executeCommand("workbench.action.openSettings", "keystone.poc.valueEdge");
        await this.sendStatus();
        return;
      }
      if (message.type === "rebuild") {
        if (!this.rebuildIntelligence) throw new Error("Open a local repository before rebuilding intelligence.");
        this.rebuildIntelligence();
        this.post({ type: "notice", level: "info", message: "Repository intelligence rebuild started." });
        await this.sendStatus();
        return;
      }
      if (message.type === "generate") {
        const featureId = message.featureId.trim();
        if (!featureId) throw new Error("Enter a ValueEdge Feature ID.");
        this.post({ type: "busy", value: true, message: "Reading ValueEdge feature and matching repository intelligence…" });
        if (!this.poc) throw new Error("Open a local repository before generating stories.");
        this.latest = await this.poc.generate(featureId);
        this.post({ type: "generated", payload: this.latest });
        return;
      }
      if (message.type === "publish") {
        if (!this.latest) throw new Error("Generate stories before publishing.");
        const selected = selectStories(this.latest.stories, message.mode);
        if (!selected.length) throw new Error("There are no stories in the selected category.");
        this.post({ type: "busy", value: true, message: `Publishing ${selected.length} draft stor${selected.length === 1 ? "y" : "ies"} to ValueEdge…` });
        if (!this.poc) throw new Error("Open a local repository before publishing stories.");
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
    if (!this.poc) {
      const cfg = vscode.workspace.getConfiguration("keystone.poc.valueEdge");
      const raw = {
        baseUrl: String(cfg.get("baseUrl", "")),
        sharedSpaceId: String(cfg.get("sharedSpaceId", "")),
        workspaceId: String(cfg.get("workspaceId", "")),
        authorization: String(cfg.get("authorization", "")),
      };
      const missing = Object.entries(raw).filter(([, value]) => !value.trim()).map(([key]) => key);
      this.post({
        type: "status",
        payload: {
          config: { configured: missing.length === 0, missing },
          intelligence: {
            status: "idle", generation: 0, pendingUpdate: false, repository: undefined, branch: undefined,
            counts: { files: 0, symbols: 0, relationships: 0, tests: 0 }, phase: "idle",
          },
        },
      });
      return;
    }

    const [overview, config] = await Promise.all([
      this.poc.overview(),
      Promise.resolve(this.poc.configurationStatus()),
    ]);
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

  private post(value: unknown): void {
    void this.view?.webview.postMessage(value);
  }

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

function randomNonce(): string {
  return Array.from({ length: 24 }, () => Math.random().toString(36)[2] ?? "x").join("");
}
