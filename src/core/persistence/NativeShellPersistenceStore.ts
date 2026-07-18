import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { AtomicFileWriter } from "./AtomicFileWriter";
import { KeystonePanelStateSchema, type KeystonePanelState } from "../../shared/contracts/nativeShell";

export class NativeShellPersistenceStore {
  private state = empty(); private chain = Promise.resolve(); private readonly path?: string;
  constructor(storageRoot?: string, private readonly writer = new AtomicFileWriter()) { this.path = storageRoot ? join(storageRoot, "state", "native-shell.json") : undefined; }
  get snapshot(): KeystonePanelState { return structuredClone(this.state); }
  async initialize(): Promise<KeystonePanelState> { if (!this.path) return this.snapshot; try { this.state = KeystonePanelStateSchema.parse(JSON.parse(await readFile(this.path, "utf8"))); } catch (cause) { if (!(cause instanceof Error && "code" in cause && cause.code === "ENOENT")) await rename(this.path, `${this.path}.invalid-${Date.now()}`).catch(() => undefined); await this.persist(this.state); } return this.snapshot; }
  async update(patch: Partial<KeystonePanelState>): Promise<KeystonePanelState> { let result!: KeystonePanelState; this.chain = this.chain.catch(() => undefined).then(async () => { const next = KeystonePanelStateSchema.parse({ ...this.state, ...patch, updatedAt: new Date().toISOString() }); await this.persist(next); this.state = next; result = this.snapshot; }); await this.chain; return result; }
  private async persist(state: KeystonePanelState): Promise<void> { if (this.path) await this.writer.writeJson(this.path, state); }
}
function empty(): KeystonePanelState { return { schemaVersion: 1, wasOpen: false, visible: false, ready: false, column: 1, lastRoute: "/", navigationSequence: 0, updatedAt: new Date().toISOString() }; }
