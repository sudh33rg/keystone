export type WorkflowStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'blocked';

export interface WorkflowStep {
  id: string;
  name: string;
  status: WorkflowStatus;
  description?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  version: string;
  steps: WorkflowStep[];
  metadata?: Record<string, unknown>;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  status: WorkflowStatus;
  startedAt: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface WorkflowRequest {
  id?: string;
  name?: string;
  workflowId?: string;
  type?: string;
  phases?: readonly {
    id: string;
    name: string;
    tasks: readonly {
      id: string;
      name: string;
      dependsOn?: readonly string[];
      requiresApproval?: boolean;
    }[];
  }[];
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ExecutionHandle {
  id: string;
  workflowId?: string;
  state?: WorkflowStatus;
  status: WorkflowStatus;
  startedAt: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}
