import * as vscode from "vscode";
import type { ConfigurationService } from "../../core/configuration/ConfigurationService";
import type { WorkspaceStateStore } from "../../core/persistence/WorkspaceStateStore";
import type { WorkspaceSummary } from "../../shared/contracts/domain";
import {
  hostMessage,
  WebviewRequestSchema,
} from "../../shared/contracts/messages";
import {
  KeystoneInitializationSchema,
  OpenKeystoneRequestSchema,
  type KeystoneInitialization,
  type OpenKeystoneRequest,
  type ValidatedNavigation,
} from "../../shared/contracts/nativeShell";
import type { KeystoneLogger } from "../../shared/logging/KeystoneLogger";
import type {
  KeystoneLaunchValidationService,
  KeystonePanelStateService,
} from "../../core/integration/NativeShellServices";
import {
  WebviewMessageRouter,
  type IntelligenceServiceRegistry,
} from "./WebviewMessageRouter";

export class KeystonePanelService implements vscode.Disposable {
  static readonly viewType = "keystone.controlCenter";
  private panel?: vscode.WebviewPanel;
  private router?: WebviewMessageRouter;
  private receiver?: vscode.Disposable;
  private panelDisposables: vscode.Disposable[] = [];
  private readyInstanceId?: string;
  private duplicatePreventionCount = 0;
  private createdAt = 0;
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly extensionVersion: string,
    private readonly store: WorkspaceStateStore,
    private readonly configuration: ConfigurationService,
    private readonly logger: KeystoneLogger,
    private readonly services: IntelligenceServiceRegistry,
    private readonly panelState: KeystonePanelStateService,
    private readonly validation: KeystoneLaunchValidationService,
    private readonly initializePayload: (
      navigation?: ValidatedNavigation,
    ) => KeystoneInitialization,
  ) {}
  get currentPanel(): vscode.WebviewPanel | undefined {
    return this.panel;
  }
  get metrics() {
    return {
      duplicatePreventionCount: this.duplicatePreventionCount,
      panelOpen: Boolean(this.panel),
      ready: Boolean(this.readyInstanceId),
    };
  }
  async open(
    raw: OpenKeystoneRequest,
    column = this.configuredColumn(),
  ): Promise<ValidatedNavigation> {
    const started = performance.now();
    const request = OpenKeystoneRequestSchema.parse(raw);
    const navigation = this.validation.validate(request);
    await this.panelState.pending(navigation);
    if (this.panel) {
      this.duplicatePreventionCount += 1;
      this.panel.reveal(column, true);
      await this.panelState.revealed(column);
      if (this.readyInstanceId) await this.sendNavigation(navigation);
      this.logger.info(
        "panel.revealed",
        "Reused the singleton Keystone panel.",
        {
          source: request.source,
          durationMs: performance.now() - started,
          duplicatePreventionCount: this.duplicatePreventionCount,
        },
      );
      return navigation;
    }
    this.createdAt = performance.now();
    const panel = vscode.window.createWebviewPanel(
      KeystonePanelService.viewType,
      "Keystone",
      column,
      {
        enableScripts: true,
        enableCommandUris: false,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.extensionUri, "dist", "webview"),
        ],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(
      this.extensionUri,
      "resources",
      "keystone.svg",
    );
    await this.panelState.opened(column);
    await this.attach(panel);
    this.logger.info("panel.created", "Created the singleton Keystone panel.", {
      source: request.source,
      durationMs: performance.now() - started,
    });
    return navigation;
  }
  async show(): Promise<void> {
    await this.open({
      schemaVersion: 1,
      destination: { type: "home" },
      source: "command-palette",
      requestedAt: new Date().toISOString(),
    });
  }
  async restore(panel: vscode.WebviewPanel): Promise<void> {
    this.disposePanel(false);
    await this.panelState.opened(
      panel.viewColumn ?? this.panelState.snapshot.column,
    );
    await this.attach(panel);
  }
  dispose(): void {
    const panel = this.panel;
    this.disposePanel(false);
    panel?.dispose();
  }
  private async attach(panel: vscode.WebviewPanel): Promise<void> {
    this.panel = panel;
    this.readyInstanceId = undefined;
    const assetsRoot = vscode.Uri.joinPath(
      this.extensionUri,
      "dist",
      "webview",
    );
    panel.webview.options = {
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [assetsRoot],
    };
    panel.webview.html = await this.createHtml(panel.webview, assetsRoot);
    this.router = new WebviewMessageRouter(
      this.store,
      this.configuration,
      this.logger,
      this.extensionVersion,
      () => this.workspaceSummary(),
      (message) => panel.webview.postMessage(message),
      this.services,
    );
    this.receiver = panel.webview.onDidReceiveMessage((message: unknown) => {
      void this.receive(message, panel);
    });
    this.panelDisposables = [
      panel.onDidDispose(() => {
        if (this.panel !== panel) return;
        this.disposePanel(true);
      }),
      panel.onDidChangeViewState((event) => {
        void this.panelState.revealed(
          event.webviewPanel.viewColumn ?? this.panelState.snapshot.column,
          event.webviewPanel.visible,
        );
      }),
    ];
  }
  private async receive(
    raw: unknown,
    panel: vscode.WebviewPanel,
  ): Promise<void> {
    const parsed = WebviewRequestSchema.safeParse(raw);
    if (!parsed.success) {
      await this.router?.handle(raw);
      return;
    }
    const request = parsed.data;
    if (request.type === "keystone/webviewReady") {
      const initialization = KeystoneInitializationSchema.parse(
        this.initializePayload(this.panelState.snapshot.pendingNavigation),
      );
      if (this.readyInstanceId === request.payload.instanceId) {
        await panel.webview.postMessage(
          hostMessage("response/success", {
            requestId: request.requestId,
            data: initialization,
          }),
        );
        return;
      }
      this.readyInstanceId = request.payload.instanceId;
      await this.panelState.ready();
      await panel.webview.postMessage(
        hostMessage("keystone/initialize", initialization),
      );
      await panel.webview.postMessage(
        hostMessage("response/success", {
          requestId: request.requestId,
          data: initialization,
        }),
      );
      if (this.panelState.snapshot.pendingNavigation)
        await this.sendNavigation(this.panelState.snapshot.pendingNavigation);
      this.logger.info("panel.ready", "Keystone Webview handshake completed.", {
        handshakeDurationMs: performance.now() - this.createdAt,
      });
      return;
    }
    if (request.type === "keystone/initializationAcknowledged") {
      await panel.webview.postMessage(
        hostMessage("response/success", {
          requestId: request.requestId,
          data: this.panelState.snapshot,
        }),
      );
      return;
    }
    if (request.type === "keystone/navigationAcknowledged") {
      const state = await this.panelState.acknowledged(
        request.payload.sequence,
        request.payload.route,
      );
      await panel.webview.postMessage(
        hostMessage("response/success", {
          requestId: request.requestId,
          data: state,
        }),
      );
      return;
    }
    if (request.type === "keystone/webviewStateChanged") {
      const state = await this.panelState.route(request.payload.route, {
        ...(request.payload.workflowId
          ? { workflowId: request.payload.workflowId }
          : {}),
        ...(request.payload.taskId ? { taskId: request.payload.taskId } : {}),
        ...(request.payload.intelligenceQuery
          ? { query: request.payload.intelligenceQuery }
          : {}),
        ...(request.payload.entityId
          ? { entityId: request.payload.entityId }
          : {}),
        ...(request.payload.drawer ? { drawer: request.payload.drawer } : {}),
      });
      await panel.webview.postMessage(
        hostMessage("response/success", {
          requestId: request.requestId,
          data: state,
        }),
      );
      return;
    }
    await this.router?.handle(raw);
  }
  private async sendNavigation(navigation: ValidatedNavigation): Promise<void> {
    if (!this.panel || !this.readyInstanceId) return;
    await this.panel.webview.postMessage(
      hostMessage("keystone/navigationRequest", {
        ...navigation,
        sequence: this.panelState.snapshot.navigationSequence,
      }),
    );
  }
  private disposePanel(persistClosed: boolean): void {
    this.receiver?.dispose();
    this.receiver = undefined;
    this.router?.dispose();
    this.router = undefined;
    for (const disposable of this.panelDisposables) disposable.dispose();
    this.panelDisposables = [];
    this.panel = undefined;
    this.readyInstanceId = undefined;
    if (persistClosed) void this.panelState.disposed();
  }
  private configuredColumn(): vscode.ViewColumn {
    const value = vscode.workspace
      .getConfiguration("keystone.panel")
      .get<string>("defaultColumn", "one");
    return value === "active"
      ? vscode.ViewColumn.Active
      : value === "beside"
        ? vscode.ViewColumn.Beside
        : vscode.ViewColumn.One;
  }
  private workspaceSummary(): WorkspaceSummary {
    const roots = vscode.workspace.workspaceFolders ?? [];
    return {
      name:
        roots.length === 0
          ? "No workspace open"
          : roots.length === 1
            ? (roots[0]?.name ?? "Workspace")
            : `${roots[0]?.name ?? "Workspace"} +${roots.length - 1}`,
      rootCount: roots.length,
      trust: vscode.workspace.isTrusted ? "trusted" : "restricted",
      indexStatus: this.services.intelligenceRuntime.getState().status,
    };
  }
  private async createHtml(
    webview: vscode.Webview,
    assetsRoot: vscode.Uri,
  ): Promise<string> {
    const indexUri = vscode.Uri.joinPath(assetsRoot, "index.html");
    let html: string;
    try {
      html = new TextDecoder().decode(
        await vscode.workspace.fs.readFile(indexUri),
      );
    } catch (error) {
      this.logger.warning(
        "webview.assets",
        "Built Webview assets were not found.",
        error,
      );
      return fallbackHtml();
    }
    const nonce = createNonce();
    html = html.replace(
      /(src|href)="\.\/([^"#?]+)([^"]*)"/g,
      (_match, attribute: string, assetPath: string, suffix: string) =>
        `${attribute}="${webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, ...assetPath.split("/"))).toString()}${suffix}"`,
    );
    html = html.replace(/<script\b/g, `<script nonce="${nonce}"`);
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource}`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return html.replace(
      "<head>",
      `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`,
    );
  }
}
function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}
function fallbackHtml(): string {
  return "<!doctype html><html><body><h1>Keystone</h1><p>Build the extension with <code>npm run build</code>, then reload this window.</p></body></html>";
}
