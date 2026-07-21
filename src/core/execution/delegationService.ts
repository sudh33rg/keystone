/**
 * Service for managing task delegation in Keystone.
 *
 * This service handles the actual delegation of tasks to agents based on
 * the configured execution profiles and capability availability.
 */

import type { ExecutionProfile } from "./executionProfile";
import type { PromptPackage } from "./promptPackageBuilder";
import type { CapabilityDiscoveryService } from "./capabilityDiscoveryService";
import type { KeystoneLogger } from "../../shared/logging/KeystoneLogger";
import type { VSCodeAPI } from "../../shared/contracts/vscodeApi";
import type { AgentCapability } from "./capability";
import { KeystoneError } from "../../shared/errors/KeystoneError";

/**
 * Delegation request object
 */
export interface DelegationRequest {
  /**
   * ID of the workflow containing the task
   */
  workflowId: string;

  /**
   * ID of the stage being executed
   */
  stageId: string;

  /**
   * ID of the work item being processed
   */
  workItemId: string;

  /**
   * The execution profile to use
   */
  profile: ExecutionProfile;

  /**
   * The built prompt package to delegate
   */
  promptPackage: PromptPackage;

  /**
   * Additional context for the delegation
   */
  context?: unknown;
}

/**
 * Result of a delegation attempt
 */
export interface DelegationExecutionResult {
  /**
   * Status of the delegation
   */
  status:
    | "prepared"
    | "awaiting-approval"
    | "invoked"
    | "handed-off"
    | "running"
    | "completed"
    | "failed"
    | "cancelled"
    | "result-rejected"
    | "superseded";

  /**
   * Timestamp when the delegation started
   */
  startTime: string;

  /**
   * Timestamp when the delegation completed (if applicable)
   */
  endTime?: string;

  /**
   * Result of the delegation (if captured)
   */
  result?: unknown;

  /**
   * The workflow the delegation belongs to
   */
  workflowId?: string;

  /**
   * Error details if the delegation failed
   */
  error?: {
    message: string;
    code?: string;
  };

  /**
   * Whether fallback was used
   */
  fallbackUsed?: boolean;

  /**
   * Reference to the returned result (if applicable)
   */
  resultReference?: string;
}

/**
 * Prepared delegation for execution
 */
export interface PreparedDelegation {
  /**
   * The delegation request
   */
  request: DelegationRequest;

  /**
   * Agent capability that will be used
   */
  agentCapability: AgentCapability;

  /**
   * Whether the delegation can be executed directly
   */
  canExecuteDirectly: boolean;

  /**
   * Mode of delegation
   */
  delegationMode: "direct" | "chat-handoff" | "clipboard-handoff" | "manual" | "deterministic";

  /**
   * Prepared task content (for clipboard or manual modes)
   */
  taskContent?: string;
}

/**
 * Service for managing task delegation in Keystone.
 */
export class DelegationService {
  private logger: KeystoneLogger;
  private capabilityService: CapabilityDiscoveryService;
  private vscodeAPI: VSCodeAPI;
  private delegationHistory: DelegationExecutionResult[] = [];

  constructor(
    logger: KeystoneLogger,
    capabilityService: CapabilityDiscoveryService,
    vscodeAPI: VSCodeAPI,
  ) {
    this.logger = logger;
    this.capabilityService = capabilityService;
    this.vscodeAPI = vscodeAPI;
  }

  /**
   * Prepare a delegation request for execution.
   *
   * @param request The delegation request to prepare
   * @returns Promise resolving to prepared delegation details
   */
  prepareDelegation(request: DelegationRequest): PreparedDelegation {
    this.logger.info(
      "delegationService.prepareDelegation",
      `Preparing delegation for workflow ${request.workflowId}, stage ${request.stageId}`,
    );

    try {
      // Find the agent capability to use
      const agentCapability = this.getAgentCapabilityForRequest(request);

      if (!agentCapability) {
        throw new Error(`No suitable agent found for delegation request: ${request.stageId}`);
      }

      // Determine delegation mode
      const delegationMode = this.determineDelegationMode(agentCapability, request.profile);

      // Check if direct execution is possible
      const canExecuteDirectly =
        delegationMode === "direct" && agentCapability.supportsDirectInvocation;

      // Create prepared delegation object
      const prepared: PreparedDelegation = {
        request,
        agentCapability,
        canExecuteDirectly,
        delegationMode,
      };

      // For manual or clipboard modes, prepare the task content
      if (delegationMode === "clipboard-handoff" || delegationMode === "manual") {
        prepared.taskContent = this.prepareTaskContent(request, agentCapability);
      }

      this.logger.info(
        "delegationService.prepareDelegation",
        `Prepared delegation with mode: ${delegationMode}`,
      );
      return prepared;
    } catch (error) {
      this.logger.error(KeystoneError.fromUnknown(error, "delegationService.prepareDelegation"));
      throw new Error(
        `Failed to prepare delegation: ${error instanceof Error ? error.message : "Unknown error"}`,
        { cause: error },
      );
    }
  }

  /**
   * Execute a prepared delegation.
   *
   * @param prepared The prepared delegation to execute
   * @returns Promise resolving to the execution result
   */
  async executeDelegation(prepared: PreparedDelegation): Promise<DelegationExecutionResult> {
    this.logger.info(
      "delegationService.executeDelegation",
      `Executing delegation for workflow ${prepared.request.workflowId}, stage ${prepared.request.stageId}`,
    );

    const result: DelegationExecutionResult = {
      status: "running",
      startTime: new Date().toISOString(),
      workflowId: prepared.request.workflowId,
    };

    try {
      // Record the delegation attempt
      this.recordDelegationAttempt(prepared);

      switch (prepared.delegationMode) {
        case "direct":
          if (prepared.canExecuteDirectly) {
            // Execute directly using the VS Code API
            const executionResult = await this.executeDirectly(prepared);
            result.status = "completed";
            result.result = executionResult;
            result.endTime = new Date().toISOString();
            this.logger.info(
              "delegationService.executeDelegation",
              "Direct delegation completed successfully",
            );
          } else {
            // Fallback to handoff mode
            result.status = "handed-off";
            result.endTime = new Date().toISOString();
            this.logger.warning(
              "delegationService.executeDelegation",
              "Direct execution not available, falling back to handoff mode",
            );
          }
          break;

        case "chat-handoff":
          // Open VS Code chat with the task
          result.status = "handed-off";
          result.endTime = new Date().toISOString();
          await this.executeChatHandoff(prepared);
          this.logger.info("delegationService.executeDelegation", "Chat handoff completed");
          break;

        case "clipboard-handoff":
          // Copy to clipboard
          result.status = "handed-off";
          result.endTime = new Date().toISOString();
          await this.executeClipboardHandoff(prepared);
          this.logger.info("delegationService.executeDelegation", "Clipboard handoff completed");
          break;

        case "manual":
          // Show manual instructions
          result.status = "handed-off";
          result.endTime = new Date().toISOString();
          this.logger.info(
            "delegationService.executeDelegation",
            "Manual handoff instructions provided",
          );
          break;

        case "deterministic":
          // Execute a deterministic operation (internal Keystone logic)
          result.status = "completed";
          result.result = this.executeDeterministic(prepared);
          result.endTime = new Date().toISOString();
          this.logger.info(
            "delegationService.executeDelegation",
            "Deterministic delegation completed",
          );
          break;

        default:
          throw new Error(`Unsupported delegation mode: ${String(prepared.delegationMode)}`);
      }

      // Record completion
      this.recordDelegationResult(prepared, result);
      return result;
    } catch (error) {
      this.logger.error(KeystoneError.fromUnknown(error, "delegationService.executeDelegation"));

      result.status = "failed";
      result.endTime = new Date().toISOString();
      result.error = {
        message: error instanceof Error ? error.message : "Unknown delegation error",
      };

      // Record failure
      this.recordDelegationResult(prepared, result);
      return result;
    }
  }

  /**
   * Determine the appropriate delegation mode for the request.
   *
   * @param agentCapability The agent capability to use
   * @param profile The execution profile to use
   * @returns The delegation mode to use
   */
  private determineDelegationMode(
    agentCapability: AgentCapability,
    profile: ExecutionProfile,
  ): "direct" | "chat-handoff" | "clipboard-handoff" | "manual" | "deterministic" {
    // Check the profile's invocation mode first
    if (profile.executor.invocationMode === "direct") {
      // Check if the agent supports direct execution
      if (agentCapability.supportsDirectInvocation) {
        return "direct";
      } else {
        // Fallback to chat handoff if direct is not supported
        return "chat-handoff";
      }
    }

    // If not direct, use the mode from the profile or default to chat handoff
    if (profile.executor.invocationMode === "chat-handoff") {
      return "chat-handoff";
    } else if (profile.executor.invocationMode === "clipboard-handoff") {
      return "clipboard-handoff";
    } else if (profile.executor.invocationMode === "manual") {
      return "manual";
    } else if (profile.executor.invocationMode === "deterministic") {
      return "deterministic";
    }

    // Default to chat handoff
    return "chat-handoff";
  }

  /**
   * Get the agent capability to use for the delegation request.
   *
   * @param request The delegation request
   * @returns The agent capability or undefined if not found
   */
  private getAgentCapabilityForRequest(request: DelegationRequest): AgentCapability | undefined {
    // Try to get the specific agent defined in the profile
    const agent = this.capabilityService.getCapabilityById(request.profile.executor.agentId) as
      AgentCapability | undefined;

    if (agent && agent.state === "available") {
      return agent;
    }

    // If the specified agent is not available, try fallback agent if one is defined
    if (request.profile.executor.fallbackAgentId) {
      const fallbackAgent = this.capabilityService.getCapabilityById(
        request.profile.executor.fallbackAgentId,
      ) as AgentCapability | undefined;
      if (fallbackAgent && fallbackAgent.state === "available") {
        return fallbackAgent;
      }
    }

    // Find any available agent as a last resort
    const availableAgents = this.capabilityService
      .getCapabilitiesByType("agent")
      .filter((a) => a.state === "available") as AgentCapability[];

    return availableAgents[0];
  }

  /**
   * Execute delegation directly using VS Code API.
   *
   * @param prepared The prepared delegation
   * @returns Promise resolving to the execution result
   */
  private executeDirectly(prepared: PreparedDelegation): unknown {
    const { request, agentCapability } = prepared;

    // In a real implementation, this would use the VS Code Language Model API
    // or a specific agent API to execute the task directly

    this.logger.debug(
      "delegationService.executeDirectly",
      `Executing direct delegation with agent: ${agentCapability.name}`,
    );

    // This is a placeholder - in real implementation, we'd make actual API calls
    return {
      agent: agentCapability.name,
      executionType: "direct",
      workflowId: request.workflowId,
      stageId: request.stageId,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Execute delegation via VS Code chat handoff.
   *
   * @param prepared The prepared delegation
   */
  private async executeChatHandoff(prepared: PreparedDelegation): Promise<void> {
    const { request, agentCapability } = prepared;

    // In a real implementation, this would:
    // 1. Open the VS Code chat window
    // 2. Pre-fill the chat with the task content
    // 3. Set the appropriate agent context
    // 4. Possibly provide pre-filled messages or instructions

    this.logger.debug(
      "delegationService.executeChatHandoff",
      `Executing chat handoff for agent: ${agentCapability.name}`,
    );

    // This is a placeholder - in real implementation, we'd use VS Code chat APIs
    await this.vscodeAPI.openChatWithContent(
      `Task for ${request.stageId}: ${prepared.taskContent || "Task details"}`,
    );
  }

  /**
   * Execute delegation via clipboard handoff.
   *
   * @param prepared The prepared delegation
   */
  private async executeClipboardHandoff(prepared: PreparedDelegation): Promise<void> {
    const { taskContent } = prepared;

    if (!taskContent) {
      throw new Error("No task content available for clipboard handoff");
    }

    // In a real implementation, this would copy the task content to the clipboard
    this.logger.debug("delegationService.executeClipboardHandoff", "Executing clipboard handoff");

    // This is a placeholder - in real implementation, we'd use VS Code clipboard APIs
    await this.vscodeAPI.copyToClipboard(taskContent);
  }

  /**
   * Execute delegation as a deterministic operation.
   *
   * @param prepared The prepared delegation
   * @returns Promise resolving to the execution result
   */
  private executeDeterministic(prepared: PreparedDelegation): unknown {
    const { request } = prepared;

    // In a real implementation, this would run internal Keystone logic
    // such as static analysis, graph traversal, or other deterministic operations

    this.logger.debug(
      "delegationService.executeDeterministic",
      "Executing deterministic delegation",
    );

    // This is a placeholder - in real implementation, we'd perform deterministic operations
    return {
      workflowId: request.workflowId,
      stageId: request.stageId,
      operationType: "deterministic",
      timestamp: new Date().toISOString(),
      result: "Deterministic operation completed successfully",
    };
  }

  /**
   * Prepare content for manual or clipboard handoff.
   *
   * @param request The delegation request
   * @param agentCapability The agent capability to use
   * @returns The formatted task content
   */
  private prepareTaskContent(request: DelegationRequest, agentCapability: AgentCapability): string {
    return `## Task for ${agentCapability.name}

**Workflow:** ${request.workflowId}
**Stage:** ${request.stageId}
**Work Item:** ${request.workItemId}

**Instructions:**
${request.promptPackage.rendered}

**Task Details:**
- Exact work: ${request.promptPackage.structured.task?.exactWork}
- Boundaries: ${request.promptPackage.structured.task?.boundaries?.join(", ") || "None specified"}
- Files allowed: ${request.promptPackage.structured.task?.allowedFiles?.join(", ") || "None specified"}
- Files excluded: ${request.promptPackage.structured.task?.excludedFiles?.join(", ") || "None specified"}

**Expected Output:**
${request.promptPackage.structured.expectedOutput?.requiredResultStructure || "Not specified"}

**Additional Context:**
${request.promptPackage.structured.context?.userPinnedContext?.join("\n") || "None provided"}
`;
  }

  /**
   * Record a delegation attempt in the history.
   *
   * @param prepared The prepared delegation request
   */
  private recordDelegationAttempt(prepared: PreparedDelegation): void {
    // In a real implementation, this would persist the delegation attempt to storage
    this.logger.debug(
      "delegationService.recordDelegationAttempt",
      `Recording delegation attempt for stage: ${prepared.request.stageId}`,
    );
  }

  /**
   * Record the result of a delegation.
   *
   * @param prepared The prepared delegation
   * @param result The execution result
   */
  private recordDelegationResult(
    prepared: PreparedDelegation,
    result: DelegationExecutionResult,
  ): void {
    // In a real implementation, this would persist the delegation result to storage
    this.delegationHistory.push(result);
    this.logger.debug(
      "delegationService.recordDelegationResult",
      `Recording delegation result for stage: ${prepared.request.stageId}`,
    );
  }

  /**
   * Get delegation history.
   *
   * @returns List of past delegation attempts
   */
  getDelegationHistory(): DelegationExecutionResult[] {
    return this.delegationHistory;
  }

  /**
   * Get delegation history for a specific workflow.
   *
   * @param workflowId The workflow ID to filter by
   * @returns List of delegation attempts for that workflow
   */
  getDelegationHistoryForWorkflow(workflowId: string): DelegationExecutionResult[] {
    return this.delegationHistory.filter(
      (entry) => entry.status !== "superseded" && entry.workflowId === workflowId,
    );
  }
}
