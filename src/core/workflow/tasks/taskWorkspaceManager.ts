import fs from 'node:fs/promises';
import path from 'node:path';
import type { ModernizationPlan } from '../modernization/model';
import type { SDLCPlan } from '../sdlc/engine';
import type { TaskStatePackage } from '../handoff/contracts';

export type TaskWorkspaceStatus = 'research-ready' | 'planned' | 'approved' | 'in-progress' | 'validating' | 'blocked' | 'done' | 'cancelled';

export interface TaskWorkspaceSeed {
  intent: string;
  intentType: string;
  route: string;
  relevantFiles: readonly string[];
  relevantSymbols: readonly string[];
  tests: readonly string[];
  qaChecks: readonly string[];
  securityRisk: string;
  performanceRisk: string;
  modernizationNotes: readonly string[];
  copilotPrompt: string;
  research?: { intentId: string; title: string; markdown: string; status: 'ready' | 'approved' };
}

export interface TaskWorkspaceRef {
  id: string;
  name: string;
  relativePath: string;
  absolutePath: string;
  status: TaskWorkspaceStatus;
}

export interface TaskWorkspaceSnapshot {
  ref: TaskWorkspaceRef;
  task: Record<string, unknown>;
  context: Record<string, unknown>;
  progress: Record<string, unknown>;
  delegationPrompt: string;
}

export class TaskWorkspaceManager {
  private readonly tasksRoot: string;

  constructor(private readonly workspaceRoot: string) {
    this.tasksRoot = path.join(workspaceRoot, '.keystone', 'tasks');
  }

  async create(seed: TaskWorkspaceSeed): Promise<TaskWorkspaceRef> {
    const { name, absolutePath } = await this.allocate(slug(seed.intent).slice(0, 56));
    const now = new Date().toISOString();
    const research = seed.research ?? defaultResearch(seed);
    const ref: TaskWorkspaceRef = { id: name, name, relativePath: `.keystone/tasks/${name}`, absolutePath, status: 'research-ready' };
    await Promise.all([
      this.write(absolutePath, 'task.json', { id: name, intent: seed.intent, intentId: research.intentId, intentType: seed.intentType, route: seed.route, researchStatus: research.status, createdAt: now, updatedAt: now }),
      this.write(absolutePath, 'research.md', research.markdown),
      this.write(absolutePath, 'research-status.json', { intentId: research.intentId, status: research.status, reviewedAt: null, updatedAt: now }),
      this.write(absolutePath, 'specification.md', initialSpecification(seed, research)),
      this.write(absolutePath, 'plan.json', initialPlan(seed, research, now)),
      this.write(absolutePath, 'SKILL.md', skill(seed)),
      this.write(absolutePath, 'instructions.md', instructions(seed)),
      this.write(absolutePath, 'agents.json', agents(seed)),
      this.write(absolutePath, 'progress.json', { status: 'research-ready', percent: 10, completed: ['Repository intelligence gathered', 'Repository R&D generated'], current: 'Awaiting R&D review before planning', blockers: [], updatedAt: now }),
      this.write(absolutePath, 'context.json', { relevantFiles: seed.relevantFiles, relevantSymbols: seed.relevantSymbols, tests: seed.tests, qaChecks: seed.qaChecks, securityRisk: seed.securityRisk, performanceRisk: seed.performanceRisk, modernizationNotes: seed.modernizationNotes }),
      this.write(absolutePath, 'delegation.md', seed.copilotPrompt),
      this.write(absolutePath, 'status.json', { status: 'research-ready', createdAt: now, updatedAt: now }),
    ]);
    return ref;
  }

  async createModernization(plan: ModernizationPlan): Promise<TaskWorkspaceRef> {
    const { name, absolutePath } = await this.allocate(`modernize-${slug(plan.targetArchitecture.name).slice(0, 46)}`);
    const now = new Date().toISOString();
    const ref: TaskWorkspaceRef = { id: name, name, relativePath: `.keystone/tasks/${name}`, absolutePath, status: 'approved' };
    const firstPhase = [...plan.phases].sort((left, right) => left.order - right.order)[0];
    await Promise.all([
      this.write(absolutePath, 'task.json', { id: name, kind: 'modernization', sourcePlanId: plan.id, repositoryId: plan.repositoryId, strategy: plan.strategy, targetArchitecture: plan.targetArchitecture, decision: plan.decision, createdAt: now, updatedAt: now }),
      this.write(absolutePath, 'specification.md', modernizationSpecification(plan)),
      this.write(absolutePath, 'SKILL.md', modernizationSkill(plan)),
      this.write(absolutePath, 'instructions.md', modernizationInstructions(plan)),
      this.write(absolutePath, 'agents.json', modernizationAgents(plan)),
      this.write(absolutePath, 'plan.json', { status: 'approved', sourcePlanId: plan.id, strategy: plan.strategy, targetArchitecture: plan.targetArchitecture, phases: plan.phases, specifications: plan.specifications, metrics: plan.metrics, risks: plan.risks, updatedAt: now }),
      this.write(absolutePath, 'progress.json', { status: 'approved', percent: 15, completed: ['Repository-wide assessment completed', 'Technology choices accepted', 'Detailed specifications generated'], current: firstPhase ? `Ready to begin: ${firstPhase.name}` : 'Ready for implementation', activePhase: firstPhase?.id, completedPhases: [], blockers: [], updatedAt: now }),
      this.write(absolutePath, 'context.json', { assessmentId: plan.assessmentId, capabilities: plan.capabilities, gaps: plan.gaps, risks: plan.risks, targetArchitecture: plan.targetArchitecture, technologyDecisions: plan.decision?.technologies ?? {}, workflowRequest: plan.workflowRequest }),
      this.write(absolutePath, 'delegation.md', modernizationDelegation(plan)),
      this.write(absolutePath, 'status.json', { status: 'approved', kind: 'modernization', sourcePlanId: plan.id, createdAt: now, updatedAt: now }),
    ]);
    return ref;
  }

  async update(ref: TaskWorkspaceRef, status: TaskWorkspaceStatus, update: { percent: number; current: string; completed?: readonly string[]; blockers?: readonly string[] }): Promise<TaskWorkspaceRef> {
    const now = new Date().toISOString();
    const existing = await this.read<Record<string, unknown>>(ref.absolutePath, 'progress.json') ?? {};
    const existingStatus = await this.read<Record<string, unknown>>(ref.absolutePath, 'status.json') ?? {};
    await Promise.all([
      this.write(ref.absolutePath, 'progress.json', { ...existing, status, percent: update.percent, current: update.current, completed: update.completed ?? existing.completed ?? [], blockers: update.blockers ?? existing.blockers ?? [], updatedAt: now }),
      this.write(ref.absolutePath, 'status.json', { ...existingStatus, status, updatedAt: now }),
    ]);
    return { ...ref, status };
  }

  async attachSdlcPlan(ref: TaskWorkspaceRef, plan: SDLCPlan): Promise<TaskWorkspaceRef> {
    const now = new Date().toISOString();
    const updated = { ...ref, status: 'planned' as const };
    await Promise.all([
      this.write(ref.absolutePath, 'research.md', plan.researchDocument.markdown),
      this.write(ref.absolutePath, 'specification.md', plan.specificationDocument.markdown),
      this.write(ref.absolutePath, 'plan.json', plan),
      this.write(ref.absolutePath, 'progress.json', { status: 'planned', percent: 20, completed: ['Repository intelligence gathered', 'Repository R&D reviewed and approved', 'Implementation specification and backlog generated'], current: 'Awaiting specification approval', blockers: [], updatedAt: now }),
      this.write(ref.absolutePath, 'status.json', { status: 'planned', updatedAt: now }),
    ]);
    return updated;
  }

  async approveResearch(ref: TaskWorkspaceRef, intentId: string): Promise<void> {
    const now = new Date().toISOString();
    const task = await this.read<Record<string, unknown>>(ref.absolutePath, 'task.json') ?? {};
    if (task.intentId && task.intentId !== intentId) throw new Error('The active task research does not belong to this intent.');
    await Promise.all([
      this.write(ref.absolutePath, 'task.json', { ...task, intentId, researchStatus: 'approved', updatedAt: now }),
      this.write(ref.absolutePath, 'research-status.json', { intentId, status: 'approved', reviewedAt: now, updatedAt: now }),
    ]);
  }

  async complete(ref: TaskWorkspaceRef): Promise<void> {
    await this.finalize(ref, 'done', 'completed');
  }

  async cancel(ref: TaskWorkspaceRef, reason: string): Promise<void> {
    await this.finalize(ref, 'cancelled', 'cancelled', reason);
  }

  private async finalize(ref: TaskWorkspaceRef, status: 'done' | 'cancelled', outcome: 'completed' | 'cancelled', reason?: string): Promise<void> {
    const done = await this.update(ref, status, { percent: status === 'done' ? 100 : 0, current: reason ?? (status === 'done' ? 'Completed' : 'Cancelled'), completed: status === 'done' ? ['Task completed and temporary workspace finalized'] : [] });
    const archive = path.join(this.tasksRoot, 'completed.jsonl');
    const record = JSON.stringify({ id: done.id, name: done.name, outcome, reason, completedAt: new Date().toISOString() });
    await fs.appendFile(archive, `${record}\n`, 'utf8');
    await fs.rm(done.absolutePath, { recursive: true, force: true });
  }

  async exportForHandoff(ref: TaskWorkspaceRef, targetRoot: string): Promise<string> {
    const destination = path.join(targetRoot, '.keystone', 'handoffs', ref.name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(ref.absolutePath, destination, { recursive: true, force: true });
    await this.write(destination, 'handoff.json', { sourceTask: ref.id, exportedAt: new Date().toISOString(), requiresManualRepositorySync: true });
    return destination;
  }

  async importHandoffPackage(packageValue: Record<string, any>): Promise<string> {
    const name = `${String(packageValue.taskId ?? 'task').replace(/[^a-zA-Z0-9_-]/g, '-')}_handoff`;
    const destination = path.join(this.workspaceRoot, '.keystone', 'handoffs', name);
    await fs.mkdir(destination, { recursive: true });
    await Promise.all([
      this.write(destination, 'task.json', packageValue.task ?? {}),
      this.write(destination, 'specification.json', packageValue.specification ?? {}),
      this.write(destination, 'plan.json', packageValue.plan ?? {}),
      this.write(destination, 'progress.json', packageValue.progress ?? {}),
      this.write(destination, 'context.json', packageValue.context ?? {}),
      this.write(destination, 'instructions.md', packageValue.continuation?.suggestedFirstPrompt ?? 'Continue from the restored task state.'),
      this.write(destination, 'handoff.json', { packageId: packageValue.packageId, importedAt: new Date().toISOString(), requiresManualRepositorySync: true }),
    ]);
    return destination;
  }

  async createFromHandoff(packageValue: TaskStatePackage): Promise<TaskWorkspaceRef> {
    const existing = await this.findBySourcePackage(packageValue.packageId);
    if (existing) return existing;
    const { name, absolutePath } = await this.allocate(`restored-${slug(packageValue.task.normalizedProblemStatement).slice(0, 46)}`);
    const now = new Date().toISOString();
    const blocked = packageValue.progress.blockers.length > 0;
    const status: TaskWorkspaceStatus = blocked ? 'blocked' : packageValue.progress.progressPercentage > 0 ? 'in-progress' : 'planned';
    const ref: TaskWorkspaceRef = { id: name, name, relativePath: `.keystone/tasks/${name}`, absolutePath, status };
    await Promise.all([
      this.write(absolutePath, 'task.json', { id: name, kind: 'restored-handoff', sourcePackageId: packageValue.packageId, sourceTaskId: packageValue.taskId, intent: packageValue.task.originalUserRequest, intentType: 'restored-handoff', route: 'human-review', createdAt: now, updatedAt: now }),
      this.write(absolutePath, 'specification.md', restoredSpecification(packageValue)),
      this.write(absolutePath, 'SKILL.md', `---\nname: restored-${slug(packageValue.task.normalizedProblemStatement).slice(0, 36)}\ndescription: Temporary guidance restored from a verified Keystone handoff.\n---\n\nFollow the restored specification, preserve recorded decisions, and validate every reported and pending check before completion.\n`),
      this.write(absolutePath, 'instructions.md', `${packageValue.continuation.manualRepositorySyncReminder}\n\nNext action: ${packageValue.continuation.exactNextRecommendedAction}\n\nDo not assume reported tests still pass; rerun them in this synchronized repository.\n`),
      this.write(absolutePath, 'agents.json', [{ id: 'continuation-planner', role: 'Reconcile restored state with the current repository' }, { id: 'executor', role: 'Continue only the recorded pending work' }, { id: 'qa', role: 'Revalidate reported and pending tests' }, { id: 'reviewer', role: 'Review restored security, performance, and decision evidence' }]),
      this.write(absolutePath, 'plan.json', { status, ...packageValue.plan, sourcePackageId: packageValue.packageId, updatedAt: now }),
      this.write(absolutePath, 'progress.json', { status, percent: packageValue.progress.progressPercentage, completed: packageValue.progress.completedWorkSummary, current: packageValue.progress.currentActivity ?? packageValue.continuation.exactNextRecommendedAction, blockers: packageValue.progress.blockers, openQuestions: packageValue.progress.openQuestions, updatedAt: now }),
      this.write(absolutePath, 'context.json', { ...packageValue.context, tests: packageValue.quality.testsPlanned, qaChecks: packageValue.quality.qualityChecksStillRequired, securityFindings: packageValue.quality.securityFindings, performanceFindings: packageValue.quality.performanceFindings, repositoryReference: packageValue.repositoryReference }),
      this.write(absolutePath, 'delegation.md', packageValue.continuation.suggestedFirstPrompt),
      this.write(absolutePath, 'status.json', { status, kind: 'restored-handoff', sourcePackageId: packageValue.packageId, createdAt: now, updatedAt: now }),
    ]);
    return ref;
  }

  private async findBySourcePackage(packageId: string): Promise<TaskWorkspaceRef | undefined> {
    await fs.mkdir(this.tasksRoot, { recursive: true });
    for (const name of await fs.readdir(this.tasksRoot)) {
      if (!/^\d{4}_/.test(name)) continue;
      const absolutePath = path.join(this.tasksRoot, name);
      const task = await this.read<{ sourcePackageId?: string }>(absolutePath, 'task.json');
      const state = await this.read<{ status?: TaskWorkspaceStatus }>(absolutePath, 'status.json');
      if (task?.sourcePackageId === packageId && state?.status && state.status !== 'done' && state.status !== 'cancelled') return { id: name, name, relativePath: `.keystone/tasks/${name}`, absolutePath, status: state.status };
    }
    return undefined;
  }

  async latestActive(): Promise<TaskWorkspaceRef | undefined> {
    await fs.mkdir(this.tasksRoot, { recursive: true });
    const candidates: Array<TaskWorkspaceRef & { updatedAt: string }> = [];
    for (const name of await fs.readdir(this.tasksRoot)) {
      if (!/^\d{4}_/.test(name)) continue;
      const absolutePath = path.join(this.tasksRoot, name);
      const status = await this.read<{ status?: TaskWorkspaceStatus; updatedAt?: string }>(absolutePath, 'status.json');
      if (!status?.status || status.status === 'done' || status.status === 'cancelled') continue;
      candidates.push({ id: name, name, relativePath: `.keystone/tasks/${name}`, absolutePath, status: status.status, updatedAt: status.updatedAt ?? '' });
    }
    return candidates.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.name.localeCompare(left.name))[0];
  }

  async delegationPrompt(ref: TaskWorkspaceRef): Promise<string> {
    return (await fs.readFile(path.join(ref.absolutePath, 'delegation.md'), 'utf8')).trimEnd();
  }

  async snapshot(ref: TaskWorkspaceRef): Promise<TaskWorkspaceSnapshot> {
    return {
      ref,
      task: await this.read(ref.absolutePath, 'task.json') ?? {},
      context: await this.read(ref.absolutePath, 'context.json') ?? {},
      progress: await this.read(ref.absolutePath, 'progress.json') ?? {},
      delegationPrompt: await this.delegationPrompt(ref),
    };
  }

  private async allocate(suffix: string): Promise<{ name: string; absolutePath: string }> {
    await fs.mkdir(this.tasksRoot, { recursive: true });
    let sequence = await this.nextSequence();
    for (let attempt = 0; attempt < 100; attempt += 1, sequence += 1) {
      const name = `${String(sequence).padStart(4, '0')}_${suffix}`;
      const absolutePath = path.join(this.tasksRoot, name);
      try {
        await fs.mkdir(absolutePath, { recursive: false });
        return { name, absolutePath };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    throw new Error('Could not allocate a unique Keystone task workspace.');
  }

  private async nextSequence(): Promise<number> {
    const names = await fs.readdir(this.tasksRoot).catch(() => [] as string[]);
    let max = names.reduce((value, name) => Math.max(value, Number(name.match(/^(\d{4})_/)?.[1] ?? 0)), 0);
    try {
      const completed = await fs.readFile(path.join(this.tasksRoot, 'completed.jsonl'), 'utf8');
      for (const line of completed.split(/\r?\n/).filter(Boolean)) max = Math.max(max, Number((JSON.parse(line).id as string)?.match(/^(\d{4})_/)?.[1] ?? 0));
    } catch { /* No completed task archive yet. */ }
    return max + 1;
  }

  private async write(directory: string, name: string, value: unknown): Promise<void> {
    const target = path.join(directory, name);
    const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    await fs.writeFile(temporary, `${content.trimEnd()}\n`, 'utf8');
    await fs.rename(temporary, target);
  }

  private async read<T>(directory: string, name: string): Promise<T | undefined> {
    try { return JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')) as T; }
    catch { return undefined; }
  }
}

function slug(value: string): string { return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'task'; }
function defaultResearch(seed: TaskWorkspaceSeed): NonNullable<TaskWorkspaceSeed['research']> {
  return {
    intentId: `intent-${slug(seed.intent)}`,
    title: seed.intent,
    markdown: `# Repository Research\n\n## Intent\n\n${seed.intent}\n\nResearch evidence will be populated when Keystone analyzes this task.`,
    status: 'ready',
  };
}
function initialSpecification(seed: TaskWorkspaceSeed, research: NonNullable<TaskWorkspaceSeed['research']>): string {
  return `# Task Specification\n\n## Intent\n\n${seed.intent}\n\n## Research\n\n${research.title}\n\n## Acceptance Criteria\n\n- Preserve existing repository behavior.\n- Run the listed QA checks before completion.\n`;
}
function initialPlan(seed: TaskWorkspaceSeed, research: NonNullable<TaskWorkspaceSeed['research']>, updatedAt: string): Record<string, unknown> {
  return {
    status: 'research-ready',
    intentId: research.intentId,
    intent: seed.intent,
    route: seed.route,
    currentPhase: 'research-review',
    currentTask: 'Review repository research before planning',
    completedTasks: ['Repository intelligence gathered', 'Repository R&D generated'],
    pendingTasks: ['Review research', 'Approve specification', 'Plan implementation'],
    blockedTasks: [],
    updatedAt,
  };
}
function skill(seed: TaskWorkspaceSeed): string { return `---\nname: ${slug(seed.intent).slice(0, 48)}\ndescription: Temporary task-local guidance generated from repository intelligence.\n---\n\nUse only for this task. Preserve repository conventions, follow the specification, and validate every changed behavior.\n`; }
function instructions(seed: TaskWorkspaceSeed): string { return `# Task Instructions\n\n- Work only on the accepted intent.\n- Use these relevant files: ${seed.relevantFiles.join(', ')}.\n- Do not weaken security or performance behavior.\n- Run the listed QA checks before completion.\n- Do not retain this folder after successful completion.\n`; }
function agents(seed: TaskWorkspaceSeed) { return [{ id: 'planner', role: 'Maintain plan and scope' }, { id: 'executor', role: 'Perform approved implementation only' }, { id: 'qa', role: `Run ${seed.qaChecks.length} QA checks` }, { id: 'reviewer', role: 'Review security, performance, and modernization risks' }]; }
function modernizationSpecification(plan: ModernizationPlan): string { return `# Accepted Modernization Specification\n\n## Objective\n\nMigrate incrementally to **${plan.targetArchitecture.name}** using the **${plan.strategy}** strategy while preserving observable behavior.\n\n## Architecture Principles\n\n${plan.targetArchitecture.principles.map(item => `- ${item}`).join('\n')}\n\n## Accepted Technologies\n\n${Object.entries(plan.decision?.technologies ?? {}).map(([category, technology]) => `- ${category}: ${technology}`).join('\n') || '- No technology overrides recorded.'}\n\n${plan.specifications.map(spec => `## ${spec.title}\n\n### Scope\n${spec.scope.map(item => `- ${item}`).join('\n')}\n\n### Requirements\n${[...spec.functionalRequirements, ...spec.nonFunctionalRequirements].map(item => `- ${item}`).join('\n')}\n\n### Acceptance Criteria\n${spec.acceptanceCriteria.map(item => `- ${item}`).join('\n')}\n\n### Validation\n${spec.validation.map(item => `- ${item}`).join('\n')}\n\n### Rollout and Rollback\n${spec.rollout.map(item => `- Rollout: ${item}`).join('\n')}\n${spec.rollback.map(item => `- Rollback: ${item}`).join('\n')}\n\n### Traceability\n${spec.traceability.map(item => `- ${item}`).join('\n')}`).join('\n\n')}\n`; }
function modernizationSkill(plan: ModernizationPlan): string { return `---\nname: modernize-${slug(plan.targetArchitecture.name).slice(0, 38)}\ndescription: Temporary task-local modernization guidance generated after explicit user approval.\n---\n\nExecute only the accepted phases in plan.json. Preserve functional equivalence, keep each transformation reversible where specified, enforce phase approval gates, and update progress.json after every meaningful step. Validate security, performance, tests, rollout, and rollback before a phase is complete.\n`; }
function modernizationInstructions(plan: ModernizationPlan): string { return `# Modernization Instructions\n\n- Accepted strategy: ${plan.strategy}.\n- Target architecture: ${plan.targetArchitecture.name} (${plan.targetArchitecture.style}).\n- Follow phases in order; do not begin an approval-gated phase without user approval.\n- Keep plan.json and progress.json current throughout execution.\n- Treat every listed risk mitigation and functional-equivalence check as required.\n- Run security, performance, QA, rollout, and rollback validation for each affected scope.\n- Never delete this temporary folder until the task is completed and recorded in completed.jsonl.\n`; }
function modernizationAgents(plan: ModernizationPlan) { return [{ id: 'modernization-planner', role: 'Own accepted scope, phase order, decisions, and progress' }, { id: 'migration-executor', role: `Execute ${plan.phases.length} reversible migration phase(s)` }, { id: 'qa', role: 'Verify characterization, contract, integration, and acceptance checks' }, { id: 'security', role: 'Review security gaps and prevent control regressions' }, { id: 'performance', role: 'Measure baselines and prevent latency, throughput, or resource regressions' }, { id: 'reviewer', role: 'Enforce approvals, traceability, rollout, and rollback readiness' }]; }
function modernizationDelegation(plan: ModernizationPlan): string { return `# Modernization Delegation Packet\n\nImplement only the user-accepted modernization plan **${plan.id}**. Start with **${[...plan.phases].sort((a, b) => a.order - b.order)[0]?.name ?? 'the first approved phase'}**. Read specification.md, instructions.md, plan.json, context.json, and SKILL.md before editing the repository. After each unit of work, update progress.json with completed steps, active phase, percentage, blockers, validation evidence, and the next action. Stop at every approval gate.\n\n## Phase Order\n\n${[...plan.phases].sort((a, b) => a.order - b.order).map(phase => `${phase.order}. ${phase.name} — ${phase.strategy}; ${phase.estimatedEffortDays} day(s); approval: ${phase.requiresApproval ? 'required' : 'not required'}`).join('\n')}\n`; }
function restoredSpecification(value: TaskStatePackage): string { return `# Restored Task Specification\n\n## Problem\n\n${value.task.normalizedProblemStatement}\n\n## Business Goal\n\n${value.task.businessGoal}\n\n## Technical Goal\n\n${value.task.technicalGoal}\n\n## Scope\n\n${value.task.scope.map(item => `- ${item}`).join('\n')}\n\n## Acceptance Criteria\n\n${value.task.acceptanceCriteria.map(item => `- ${item}`).join('\n')}\n\n## Approved Behavior\n\n${value.specification.approvedBehavior.map(item => `- ${item}`).join('\n')}\n\n## Security and Performance\n\n${[...value.specification.securityRequirements, ...value.specification.performanceRequirements].map(item => `- ${item}`).join('\n')}\n`; }
