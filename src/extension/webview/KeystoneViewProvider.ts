import * as vscode from "vscode";
import type { ConfigurationService } from "../../core/configuration/ConfigurationService";
import type { WorkspaceStateStore } from "../../core/persistence/WorkspaceStateStore";
import type { WorkspaceSummary } from "../../shared/contracts/domain";
import type { KeystoneLogger } from "../../shared/logging/KeystoneLogger";
import { WebviewMessageRouter } from "./WebviewMessageRouter";
import type { ServiceRegistry } from "./WebviewMessageRouter";

export class KeystoneViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "keystone.controlCenter";

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly extensionVersion: string,
    private readonly store: WorkspaceStateStore,
    private readonly configuration: ConfigurationService,
    private readonly logger: KeystoneLogger,
    private readonly services?: ServiceRegistry
  ) {}

  async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
    const assetsRoot = vscode.Uri.joinPath(this.extensionUri, "dist", "webview");
    webviewView.webview.options = {
      enableScripts: true,
      enableCommandUris: false,
      localResourceRoots: [assetsRoot]
    };

    webviewView.webview.html = await this.createHtml(webviewView.webview, assetsRoot);
    const router = new WebviewMessageRouter(
      this.store,
      this.configuration,
      this.logger,
      this.extensionVersion,
      workspaceSummary,
      (message) => webviewView.webview.postMessage(message),
      this.services ?? this.createDefaultServices()
    );

    webviewView.webview.onDidReceiveMessage(
      (message: unknown) => {
        void router.handle(message);
      },
      undefined
    );

    this.logger.info("webview.resolve", "Keystone control center resolved.");
  }

  private createDefaultServices(): ServiceRegistry {
    // Create minimal stubs when services aren't injected
    const store = this.store;
    const logger = this.logger;

    return {
      repositoryIndex: {
        start: () => {},
        cancel: () => {},
        getIndex: () => ({ indexVersion: 0 })
      } as unknown as ServiceRegistry["repositoryIndex"],
      agentRegistry: {
        getProfile: () => undefined,
        getProfiles: () => [],
        getSelectionMode: () => "recommended",
        setSelectionMode: () => {},
        assign: () => ({ taskId: "", workflowId: "", agentId: "", selectionMode: "manual", userConfirmed: false, assignedAt: new Date().toISOString(), recommendationCandidates: [], capabilityFingerprint: "" }),
        getAssignment: () => undefined
      } as unknown as ServiceRegistry["agentRegistry"],
      contextEngine: {
        buildPackage: async () => ({ package: { id: "", taskId: "", specificationRevision: 0, repositoryIndexVersion: 0, createdAt: new Date().toISOString(), selectionPolicyVersion: 1, budget: 12000, estimatedTokens: 0, estimatedBytes: 0, items: [], excludedCandidates: [], fingerprint: "", reviewStatus: "unreviewed" }, estimate: { tokens: 0, bytes: 0 } })
      } as unknown as ServiceRegistry["contextEngine"],
      taskGraphService: {
        generateFromSpecification: () => ({ id: "", workflowId: "", specificationId: "", specificationRevision: 0, graphRevision: 1, taskIds: [], generatedAt: new Date().toISOString(), generationProvenance: "manual", validationStatus: "pending", topologicalOrder: [] }),
        getGraph: () => undefined,
        getTask: () => undefined,
        getAllTasks: () => [],
        updateTask: () => ({ id: "", title: "", objective: "", description: "", status: "pending", dependencies: [], requiredContextPolicy: { selectionSeeds: [], budget: 12000, mandatoryItems: [], excludedItems: [] }, expectedFiles: [], expectedOutput: "", acceptanceCriterionIds: [], validationSteps: [], retryHistory: [], executionNotes: [], baseFingerprint: { specRevision: 0, indexVersion: 0 } }),
        transitionTask: () => ({ id: "", title: "", objective: "", description: "", status: "pending", dependencies: [], requiredContextPolicy: { selectionSeeds: [], budget: 12000, mandatoryItems: [], excludedItems: [] }, expectedFiles: [], expectedOutput: "", acceptanceCriterionIds: [], validationSteps: [], retryHistory: [], executionNotes: [], baseFingerprint: { specRevision: 0, indexVersion: 0 } })
      } as unknown as ServiceRegistry["taskGraphService"],
      workflowOrchestrator: {
        startWorkflow: () => ({ id: "", specificationId: "", title: "", status: "running", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), taskIds: [], validationRuns: [], lastValidationId: undefined, agentAssignments: [], contextPackages: [], metadata: {} }),
        pauseWorkflow: () => ({ id: "", specificationId: "", title: "", status: "paused", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), taskIds: [], validationRuns: [], lastValidationId: undefined, agentAssignments: [], contextPackages: [], metadata: {} }),
        skipTask: () => ({ id: "", specificationId: "", title: "", status: "running", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), taskIds: [], validationRuns: [], lastValidationId: undefined, agentAssignments: [], contextPackages: [], metadata: {} }),
        cancelWorkflow: () => ({ id: "", specificationId: "", title: "", status: "cancelled", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), taskIds: [], validationRuns: [], lastValidationId: undefined, agentAssignments: [], contextPackages: [], metadata: {} }),
        completeWorkflow: () => ({ id: "", specificationId: "", title: "", status: "completed", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), taskIds: [], validationRuns: [], lastValidationId: undefined, agentAssignments: [], contextPackages: [], metadata: {} }),
        getWorkflow: () => undefined,
        getAllWorkflows: () => [],
        getReadyTasks: () => [],
        requiresApproval: () => false,
        setApprovalPolicy: () => {},
        getApprovalPolicy: () => "required"
      } as unknown as ServiceRegistry["workflowOrchestrator"],
      validationEngine: {
        plan: async () => ({ commands: [], checks: [] }),
        run: async () => ({ id: "", workflowId: "", specificationRevision: 0, taskIds: [], status: "completed", startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), checks: [], changedFiles: [], criterionResults: [], driftFindings: [], overrideRecords: [] }),
        createOverride: () => ({ id: "", userId: "", timestamp: new Date().toISOString(), criterionId: "", reason: "", riskAcknowledgement: "", priorResult: "passed", resultingStatus: "overridden" })
      } as unknown as ServiceRegistry["validationEngine"],
      delegationService: {
        delegate: async () => ({ success: false, method: "assisted", agentId: "", error: "Not configured" }),
        createWorkflow: () => ({ id: "", specificationId: "", title: "", status: "draft", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), taskIds: [], validationRuns: [], lastValidationId: undefined, agentAssignments: [], contextPackages: [], metadata: {} })
      } as unknown as ServiceRegistry["delegationService"],
      contextPreview: {
        generatePreview: () => ({ package: { id: "", taskId: "", specificationRevision: 0, repositoryIndexVersion: 0, createdAt: new Date().toISOString(), selectionPolicyVersion: 1, budget: 12000, estimatedTokens: 0, estimatedBytes: 0, items: [], excludedCandidates: [], fingerprint: "", reviewStatus: "unreviewed" }, summary: { totalItems: 0, includedItems: 0, excludedItems: 0, estimatedTokens: 0, estimatedBytes: 0, budget: 12000, utilization: 0 }, items: [] }),
        applyPin: () => ({ id: "", taskId: "", specificationRevision: 0, repositoryIndexVersion: 0, createdAt: new Date().toISOString(), selectionPolicyVersion: 1, budget: 12000, estimatedTokens: 0, estimatedBytes: 0, items: [], excludedCandidates: [], fingerprint: "", reviewStatus: "unreviewed" }),
        applyExclude: () => ({ id: "", taskId: "", specificationRevision: 0, repositoryIndexVersion: 0, createdAt: new Date().toISOString(), selectionPolicyVersion: 1, budget: 12000, estimatedTokens: 0, estimatedBytes: 0, items: [], excludedCandidates: [], fingerprint: "", reviewStatus: "unreviewed" }),
        applyBudget: () => ({ id: "", taskId: "", specificationRevision: 0, repositoryIndexVersion: 0, createdAt: new Date().toISOString(), selectionPolicyVersion: 1, budget: 12000, estimatedTokens: 0, estimatedBytes: 0, items: [], excludedCandidates: [], fingerprint: "", reviewStatus: "unreviewed" })
      } as unknown as ServiceRegistry["contextPreview"],
      externalChangeDetector: {
        setBaseline: () => {},
        detectChanges: () => undefined,
        markResolved: () => {},
        clearBaseline: () => {}
      } as unknown as ServiceRegistry["externalChangeDetector"],
      intentEngine: {
        analyze: () => ({ id: crypto.randomUUID(), text: "", category: "feature", riskLevel: "low", affectedAreas: [], ambiguities: [], constraints: [], agentRecommendations: [], requiredDecisions: [], generatedAt: new Date().toISOString() })
      } as unknown as ServiceRegistry["intentEngine"],
      specificationService: {
        create: () => ({ id: crypto.randomUUID(), intentId: "", title: "", workflowId: "", status: "draft", revisions: [], currentRevision: 1, criteria: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
        update: () => ({ id: crypto.randomUUID(), intentId: "", title: "", workflowId: "", status: "draft", revisions: [], currentRevision: 1, criteria: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
        approve: () => ({ id: crypto.randomUUID(), intentId: "", title: "", workflowId: "", status: "approved", revisions: [], currentRevision: 1, criteria: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
        reject: () => ({ id: crypto.randomUUID(), intentId: "", title: "", workflowId: "", status: "draft", revisions: [], currentRevision: 1, criteria: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
        revise: () => ({ id: crypto.randomUUID(), intentId: "", title: "", workflowId: "", status: "draft", revisions: [], currentRevision: 1, criteria: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }),
        get: () => undefined,
        getAll: () => [],
        getRevisions: () => []
      } as unknown as ServiceRegistry["specificationService"]
    };
  }

  private async createHtml(webview: vscode.Webview, assetsRoot: vscode.Uri): Promise<string> {
    const indexUri = vscode.Uri.joinPath(assetsRoot, "index.html");
    let html: string;
    try {
      html = new TextDecoder().decode(await vscode.workspace.fs.readFile(indexUri));
    } catch (error) {
      this.logger.warning("webview.assets", "Built Webview assets were not found.", error);
      return fallbackHtml();
    }

    const nonce = createNonce();
    html = html.replace(/(src|href)="\.\/([^"#?]+)([^"]*)"/g, (_match, attribute: string, assetPath: string, suffix: string) => {
      const uri = webview.asWebviewUri(vscode.Uri.joinPath(assetsRoot, ...assetPath.split("/")));
      return `${attribute}="${uri.toString()}${suffix}"`;
    });
    html = html.replace(/<script\b/g, `<script nonce="${nonce}"`);

    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource}`,
      `style-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`
    ].join("; ");
    return html.replace("<head>", `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`);
  }
}

function workspaceSummary(): WorkspaceSummary {
  const roots = vscode.workspace.workspaceFolders ?? [];
  return {
    name: roots.length === 0 ? "No workspace open" : roots.length === 1 ? roots[0]?.name ?? "Workspace" : `${roots[0]?.name ?? "Workspace"} +${roots.length - 1}`,
    rootCount: roots.length,
    trust: vscode.workspace.isTrusted ? "trusted" : "restricted",
    indexStatus: "not-started"
  };
}

function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function fallbackHtml(): string {
  return "<!doctype html><html><body><h1>Keystone</h1><p>Build the extension with <code>npm run build</code>, then reload this window.</p></body></html>";
}
