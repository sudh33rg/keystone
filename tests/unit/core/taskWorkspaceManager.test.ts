import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from '../../support/testkit';
import { TaskWorkspaceManager } from '@core/workflow/tasks/taskWorkspaceManager';
import { TaskStatePackageBuilder, verifyTaskStatePackage } from '@core/workflow/handoff/taskStatePackage';
import { decryptHandoffPackage, encryptHandoffPackage } from '@core/workflow/handoff/handoffSecurity';

const seed = { intent: 'Add audit telemetry', intentType: 'feature', route: 'hybrid', relevantFiles: ['src/a.ts'], relevantSymbols: ['run'], tests: ['src/a.test.ts'], qaChecks: ['Run unit tests'], securityRisk: 'high', performanceRisk: 'medium', modernizationNotes: ['Preserve behavior'], copilotPrompt: 'Implement with context' };

describe('TaskWorkspaceManager', () => {
  it('creates incrementing task folders, updates progress, and archives before deletion', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-task-workspace-'));
    const manager = new TaskWorkspaceManager(root);
    const first = await manager.create(seed);
    const second = await manager.create({ ...seed, intent: 'Add retry policy' });
    expect(first.name).toMatch(/^0001_add-audit-telemetry/);
    expect(second.name).toMatch(/^0002_add-retry-policy/);
    await expect(fs.access(path.join(first.absolutePath, 'SKILL.md'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(first.absolutePath, 'specification.md'))).resolves.toBeUndefined();
    const updated = await manager.update(first, 'approved', { percent: 30, current: 'Delegated' });
    expect(JSON.parse(await fs.readFile(path.join(first.absolutePath, 'progress.json'), 'utf8')).percent).toBe(30);
    await manager.complete(updated);
    await expect(fs.access(first.absolutePath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(root, '.keystone', 'tasks', 'completed.jsonl'), 'utf8')).toContain(first.id);
    await manager.complete(second);
    expect((await manager.create({ ...seed, intent: 'Third task' })).name).toMatch(/^0003_third-task/);
  });

  it('copies task artifacts for handoff and reconstructs received packages', async () => {
    const source = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-task-source-'));
    const target = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-task-target-'));
    const manager = new TaskWorkspaceManager(source);
    const ref = await manager.create(seed);
    const exported = await manager.exportForHandoff(ref, target);
    await expect(fs.access(path.join(exported, 'plan.json'))).resolves.toBeUndefined();
    await expect(manager.exportForHandoff(ref, target)).resolves.toBe(exported);
    const imported = await new TaskWorkspaceManager(target).importHandoffPackage({ taskId: 'shared-task', packageId: 'pkg', task: { intent: seed.intent }, specification: {}, plan: {}, progress: {}, context: {}, continuation: { suggestedFirstPrompt: seed.copilotPrompt } });
    await expect(fs.access(path.join(imported, 'instructions.md'))).resolves.toBeUndefined();
  });

  it('recovers the latest task, binds delegation, preserves status metadata, and archives cancellation truthfully', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-task-recovery-'));
    const manager = new TaskWorkspaceManager(root);
    const first = await manager.create(seed);
    await manager.update(first, 'approved', { percent: 20, current: 'Approved' });
    const recovered = await new TaskWorkspaceManager(root).latestActive();
    expect(recovered?.id).toBe(first.id);
    expect(await manager.delegationPrompt(first)).toBe(seed.copilotPrompt);
    expect(JSON.parse(await fs.readFile(path.join(first.absolutePath, 'status.json'), 'utf8')).createdAt).toBeTruthy();
    await manager.cancel(first, 'Superseded');
    expect(await manager.latestActive()).toBeUndefined();
    expect(await fs.readFile(path.join(root, '.keystone', 'tasks', 'completed.jsonl'), 'utf8')).toContain('"outcome":"cancelled"');
  });

  it('materializes an accepted modernization plan into the same numbered lifecycle', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-modernization-task-'));
    const manager = new TaskWorkspaceManager(root);
    await manager.create(seed);
    const ref = await manager.createModernization({
      id: 'plan-1', repositoryId: 'repo-1', generatedAt: new Date().toISOString(), strategy: 'incremental-upgrade', assessmentId: 'assessment-1',
      targetArchitecture: { id: 'target-1', name: 'Modern Modular Platform', style: 'modular-monolith', principles: ['Preserve contracts'], technologyPreferences: ['Node.js'] },
      capabilities: [], gaps: [], risks: [], metrics: { totalPhases: 1, estimatedEffortDays: 2, highRiskItems: 0, reversibleTransformations: 1, validationChecks: 1, readinessScore: 80 },
      decision: { proposalId: 'proposal-1', acceptedAt: new Date().toISOString(), source: 'keystone-recommendation', targetArchitecture: { id: 'target-1', name: 'Modern Modular Platform', style: 'modular-monolith', principles: ['Preserve contracts'], technologyPreferences: ['Node.js'] }, technologies: { runtime: 'Node.js 24' }, notes: [] },
      phases: [{ id: 'phase-1', name: 'Baseline and upgrade', strategy: 'incremental-upgrade', order: 1, goals: ['Upgrade runtime'], scope: ['src'], prerequisites: [], risks: [], transformations: [], validation: [], rollback: ['Restore lockfile'], estimatedEffortDays: 2, requiresApproval: true }],
      specifications: [{ id: 'spec-1', title: 'Runtime upgrade', scope: ['src'], technologyDecisions: ['Node.js 24'], functionalRequirements: ['Preserve API behavior'], nonFunctionalRequirements: ['No latency regression'], acceptanceCriteria: ['Tests pass'], validation: ['Run tests'], rollout: ['Canary'], rollback: ['Restore runtime'], traceability: ['gap-1'] }],
      workflowRequest: { objective: 'Modernize runtime' } as any,
    });

    expect(ref.name).toMatch(/^0002_modernize-modern-modular-platform/);
    expect(JSON.parse(await fs.readFile(path.join(ref.absolutePath, 'progress.json'), 'utf8'))).toMatchObject({ status: 'approved', activePhase: 'phase-1' });
    expect(await fs.readFile(path.join(ref.absolutePath, 'specification.md'), 'utf8')).toContain('Node.js 24');
    expect(JSON.parse(await fs.readFile(path.join(ref.absolutePath, 'agents.json'), 'utf8')).map((agent: { id: string }) => agent.id)).toEqual(expect.arrayContaining(['security', 'performance', 'qa']));
  });

  it('round-trips an encrypted handoff into an independent workspace without sharing repository state', async () => {
    const sourceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-handoff-source-instance-'));
    const targetRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-handoff-target-instance-'));
    const packageValue = new TaskStatePackageBuilder().build(handoffInput as any);
    const encrypted = await encryptHandoffPackage(JSON.stringify(packageValue), 'independent workspace passphrase');
    expect(encrypted).not.toContain(packageValue.task.originalUserRequest);
    const decrypted = JSON.parse(await decryptHandoffPackage(encrypted, 'independent workspace passphrase'));
    expect(() => verifyTaskStatePackage(decrypted)).not.toThrow();
    const targetManager = new TaskWorkspaceManager(targetRoot);
    const restored = await targetManager.createFromHandoff(decrypted);
    expect(restored.absolutePath.startsWith(targetRoot)).toBe(true);
    expect(restored.absolutePath.startsWith(sourceRoot)).toBe(false);
    expect(await targetManager.delegationPrompt(restored)).toBe(packageValue.continuation.suggestedFirstPrompt);
    expect(JSON.parse(await fs.readFile(path.join(restored.absolutePath, 'context.json'), 'utf8'))).toMatchObject({ repositoryReference: packageValue.repositoryReference });
    expect(await fs.readFile(path.join(restored.absolutePath, 'instructions.md'), 'utf8')).toContain(packageValue.continuation.manualRepositorySyncReminder);
  });

  it('materializes a verified handoff as an idempotent active task workspace', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'keystone-restored-task-'));
    const manager = new TaskWorkspaceManager(root);
    const packageValue = new TaskStatePackageBuilder().build(handoffInput as any);
    const restored = await manager.createFromHandoff(packageValue);
    const repeated = await manager.createFromHandoff(packageValue);
    expect(repeated.id).toBe(restored.id);
    expect(restored.name).toMatch(/^0001_restored-continue-shared-task/);
    expect(await fs.readFile(path.join(restored.absolutePath, 'delegation.md'), 'utf8')).toContain('Continue from verified state');
    expect(JSON.parse(await fs.readFile(path.join(restored.absolutePath, 'task.json'), 'utf8'))).toMatchObject({ kind: 'restored-handoff', sourcePackageId: packageValue.packageId });
  });
});

const handoffInput = {
  handoffId: 'handoff-1', taskId: 'shared-task', createdBy: 'dev', repositoryReference: { repositoryName: 'repo', expectedBranch: 'feature' },
  task: { originalUserRequest: 'Continue shared task', normalizedProblemStatement: 'Continue shared task', businessGoal: 'Preserve continuity', technicalGoal: 'Finish implementation', scope: ['src/a.ts'], nonGoals: [], constraints: [], assumptions: [], acceptanceCriteria: ['Tests pass'] },
  specification: { approvedBehavior: ['Preserve behavior'], functionalRequirements: [], nonFunctionalRequirements: [], uiRequirements: [], apiRequirements: [], dataRequirements: [], securityRequirements: [], performanceRequirements: [], compatibilityRequirements: [] },
  plan: { phases: [], currentPhase: 'implementation', currentTask: 'Finish implementation', completedTasks: ['Analyze'], pendingTasks: ['Implement'], blockedTasks: [], deferredTasks: [] },
  progress: { progressPercentage: 40, completedWorkSummary: ['Analyzed'], currentActivity: 'Implement', pendingAction: 'Continue', blockers: [], openQuestions: [], lastUpdateTime: new Date().toISOString() },
  context: { architectureSummary: 'modular', relevantModules: [], relevantFiles: ['src/a.ts'], relevantSymbols: ['run'], dependencyRelationships: [], impactedComponents: [], compressedTaskContext: 'context', importantCodeExcerpts: [], conventionsToFollow: [], thingsToAvoid: [], knownArchitecturalConstraints: [] },
  changes: { filesExpectedToChange: ['src/a.ts'], filesReportedChanged: [], filesAdded: [], filesRemoved: [], majorImplementationChanges: [], knownUnfinishedAreas: [] },
  quality: { testsPlanned: ['test'], testsAdded: [], testsReportedPassing: [], testsReportedFailing: [], testsPending: ['test'], staticAnalysisFindings: [], securityFindings: [], performanceFindings: [], accessibilityFindings: [], knownRegressions: [], qualityChecksStillRequired: ['Run test'] },
  decisions: { acceptedDecisions: [], rejectedAlternatives: [], decisionReasons: [], assumptions: [], unresolvedQuestions: [], risks: [], reviewerComments: [] },
  continuation: { exactNextRecommendedAction: 'Implement', suggestedFirstPrompt: 'Continue from verified state', expectedFilesToInspect: ['src/a.ts'], expectedTestsToRun: ['test'], environmentRequirements: [], setupReminders: [], restoreWarnings: [], manualRepositorySyncReminder: 'Synchronize manually', definitionOfCompletion: ['Tests pass'] },
};
