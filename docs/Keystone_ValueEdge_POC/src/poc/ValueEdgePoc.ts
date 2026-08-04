import * as vscode from "vscode";
import type { IntelligenceQueryService } from "../core/intelligence/IntelligenceQueryService";
import type { IntelligenceOverview } from "../shared/contracts/intelligence";
import { generateRepoAwareStories, type GeneratedStory, type RepositoryEvidence } from "./storyGenerator";
import { ValueEdgeRestClient, type ValueEdgeConfig, type ValueEdgeFeature } from "./ValueEdgeRestClient";

export interface PocGenerationResult {
  feature: ValueEdgeFeature;
  stories: GeneratedStory[];
  generation: number;
  evidenceCount: number;
}

export interface PocConfigurationStatus {
  configured: boolean;
  missing: string[];
}

export class ValueEdgePoc {
  constructor(private readonly intelligence: IntelligenceQueryService) {}

  async overview(): Promise<IntelligenceOverview> {
    return this.intelligence.overview();
  }

  configurationStatus(): PocConfigurationStatus {
    const config = this.readConfig(false);
    if (config) return { configured: true, missing: [] };
    const raw = this.rawConfig();
    const missing = Object.entries(raw).filter(([, value]) => !value.trim()).map(([key]) => key);
    return { configured: false, missing };
  }

  async generate(featureId: string): Promise<PocGenerationResult> {
    const config = this.readConfig(true);
    if (!config) throw new Error("ValueEdge settings are incomplete.");

    const overview = await this.intelligence.overview();
    if (!overview.generation) {
      throw new Error("Repository intelligence is not ready yet. Rebuild intelligence and try again.");
    }

    const feature = await new ValueEdgeRestClient(config).fetchFeature(featureId.trim());
    const evidence = await this.collectEvidence(feature);
    const stories = generateRepoAwareStories(feature, evidence, overview.generation);
    return {
      feature,
      stories,
      generation: overview.generation,
      evidenceCount: evidence.length,
    };
  }

  async publish(featureId: string, stories: GeneratedStory[]): Promise<void> {
    const config = this.readConfig(true);
    if (!config) throw new Error("ValueEdge settings are incomplete.");
    await new ValueEdgeRestClient(config).publish(featureId, stories);
  }

  openSettings(): Thenable<unknown> {
    return vscode.commands.executeCommand("workbench.action.openSettings", "keystone.poc.valueEdge");
  }

  private rawConfig(): ValueEdgeConfig {
    const cfg = vscode.workspace.getConfiguration("keystone.poc.valueEdge");
    return {
      baseUrl: String(cfg.get("baseUrl", "")).replace(/\/$/, ""),
      sharedSpaceId: String(cfg.get("sharedSpaceId", "")),
      workspaceId: String(cfg.get("workspaceId", "")),
      authorization: String(cfg.get("authorization", "")),
    };
  }

  private readConfig(showMessage: boolean): ValueEdgeConfig | undefined {
    const value = this.rawConfig();
    const missing = Object.entries(value).filter(([, item]) => !item.trim()).map(([key]) => key);
    if (!missing.length) return value;
    if (showMessage) {
      void vscode.window.showErrorMessage(
        `Keystone POC ValueEdge settings are incomplete: ${missing.join(", ")}.`,
        "Open Settings",
      ).then((choice) => choice === "Open Settings" && this.openSettings());
    }
    return undefined;
  }

  private async collectEvidence(feature: ValueEdgeFeature): Promise<RepositoryEvidence[]> {
    const terms = meaningfulTerms(`${feature.name} ${feature.description ?? ""}`).slice(0, 10);
    const found = new Map<string, RepositoryEvidence>();
    for (const term of terms) {
      const result = await this.intelligence.search({ query: term, limit: 12 });
      for (const item of result.items) {
        found.set(item.id, { ...item, matchedTerm: term });
        if (found.size >= 35) break;
      }
      if (found.size >= 35) break;
    }
    return [...found.values()];
  }
}

function meaningfulTerms(value: string): string[] {
  const stop = new Set(["the","and","for","with","from","that","this","into","user","feature","should","will","when","then","have","using","based","create","support","provide"]);
  return unique(plainText(value).toLowerCase().match(/[a-z][a-z0-9_-]{2,}/g) ?? []).filter((item) => !stop.has(item));
}

function unique<T>(items: T[]): T[] { return [...new Set(items)]; }
function plainText(value: string): string { return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(); }
