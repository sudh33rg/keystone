import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { AtomicFileWriter } from "./AtomicFileWriter";
import { CopilotIntegrationPersistentStateSchema, type CopilotIntegrationPersistentState } from "../../shared/contracts/copilotIntegration";

export class CopilotIntegrationPersistenceStore {
  private state = emptyState(); private chain = Promise.resolve(); private readonly path?: string;
  constructor(storageRoot?: string, private readonly writer = new AtomicFileWriter()) { this.path = storageRoot ? join(storageRoot, "workflow", "copilot-integration.json") : undefined; }
  get snapshot(): CopilotIntegrationPersistentState { return structuredClone(this.state); }
  async initialize(): Promise<CopilotIntegrationPersistentState> { if (!this.path) return this.snapshot; try { this.state = CopilotIntegrationPersistentStateSchema.parse(JSON.parse(await readFile(this.path, "utf8"))); } catch (cause) { if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) await rename(this.path, `${this.path}.invalid-${Date.now()}`); await this.persist(this.state); } return this.snapshot; }
  async update(mutator: (state: CopilotIntegrationPersistentState) => CopilotIntegrationPersistentState): Promise<CopilotIntegrationPersistentState> { let result!: CopilotIntegrationPersistentState; this.chain = this.chain.catch(() => undefined).then(async () => { const next = CopilotIntegrationPersistentStateSchema.parse({ ...mutator(this.snapshot), revision: this.state.revision + 1, updatedAt: new Date().toISOString() }); await this.persist(next); this.state = next; result = this.snapshot; }); await this.chain; return result; }
  private async persist(state: CopilotIntegrationPersistentState): Promise<void> { if (this.path) await this.writer.writeJson(this.path, state); }
}
function emptyState(): CopilotIntegrationPersistentState { return { schemaVersion: 1, revision: 0, customizationFingerprints: {}, customizationEnabled: {}, selectedAgents: {}, settings: { toolsEnabled: true, participantEnabled: true, includeCandidates: false, maximumToolResults: 25, maximumSourceExcerptLines: 20, defaultAssistedMode: "open-chat", auditRetention: 200 }, audit: [], assistedLaunches: [], updatedAt: new Date().toISOString() }; }
