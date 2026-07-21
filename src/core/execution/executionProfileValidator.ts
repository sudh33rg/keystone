/**
 * Service for validating execution profiles in Keystone.
 *
 * This service validates that execution profiles are properly configured
 * and that all referenced capabilities are available or can be resolved.
 */

import type { ExecutionProfile } from "./executionProfile";
import type { CapabilityDiscoveryService } from "./capabilityDiscoveryService";
import type { KeystoneLogger } from "../../shared/logging/KeystoneLogger";

/**
 * Validation result for an execution profile
 */
export interface ValidationIssue {
  /**
   * Unique code for this validation issue
   */
  code: string;

  /**
   * Severity of the issue (warning, error, info)
   */
  severity: "info" | "warning" | "error";

  /**
   * The capability or component that has the issue
   */
  affectedCapability: string;

  /**
   * Human-readable message describing the issue
   */
  message: string;

  /**
   * Suggested resolution for the issue
   */
  suggestedResolution: string;

  /**
   * Whether this issue blocks execution
   */
  blocking: boolean;
}

/**
 * Service for validating execution profiles in Keystone.
 */
export class ExecutionProfileValidator {
  private logger: KeystoneLogger;
  private capabilityService: CapabilityDiscoveryService;

  constructor(logger: KeystoneLogger, capabilityService: CapabilityDiscoveryService) {
    this.logger = logger;
    this.capabilityService = capabilityService;
  }

  /**
   * Validate an execution profile.
   *
   * @param profile The profile to validate
   * @returns List of validation issues
   */
  validateProfile(profile: ExecutionProfile): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    this.logger.info(
      "executionProfileValidator.validateProfile",
      `Validating execution profile: ${profile.name}`,
    );

    // Validate basic profile structure
    if (!profile.id) {
      issues.push({
        code: "PROFILE_ID_MISSING",
        severity: "error",
        affectedCapability: "profile",
        message: "Execution profile must have an ID",
        suggestedResolution: "Assign a unique ID to the profile",
        blocking: true,
      });
    }

    if (!profile.name) {
      issues.push({
        code: "PROFILE_NAME_MISSING",
        severity: "error",
        affectedCapability: "profile",
        message: "Execution profile must have a name",
        suggestedResolution: "Provide a descriptive name for the profile",
        blocking: true,
      });
    }

    // Validate executor configuration
    const executorIssues = this.validateExecutor(profile);
    issues.push(...executorIssues);

    // Validate skills configuration
    const skillIssues = this.validateSkills(profile);
    issues.push(...skillIssues);

    // Validate instructions configuration
    const instructionIssues = this.validateInstructions(profile);
    issues.push(...instructionIssues);

    // Validate context configuration
    const contextIssues = this.validateContext(profile);
    issues.push(...contextIssues);

    // Validate control configuration
    const controlIssues = this.validateControl(profile);
    issues.push(...controlIssues);

    // Validate output configuration
    const outputIssues = this.validateOutput(profile);
    issues.push(...outputIssues);

    // Validate capability availability
    const capabilityIssues = this.validateCapabilityAvailability(profile);
    issues.push(...capabilityIssues);

    this.logger.info(
      "executionProfileValidator.validateProfile",
      `Validation complete. Found ${issues.length} issues`,
    );

    return issues;
  }

  /**
   * Validate the executor configuration in the profile.
   *
   * @param profile The profile to validate
   * @returns List of validation issues
   */
  private validateExecutor(profile: ExecutionProfile): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check that agent is specified
    if (!profile.executor.agentId) {
      issues.push({
        code: "EXECUTOR_AGENT_ID_MISSING",
        severity: "error",
        affectedCapability: "executor",
        message: "Executor must specify an agent ID",
        suggestedResolution: "Specify the ID of the agent to use for execution",
        blocking: true,
      });
    } else {
      // Check if the agent exists and is available
      const agent = this.capabilityService.getCapabilityById(profile.executor.agentId);
      if (!agent) {
        issues.push({
          code: "EXECUTOR_AGENT_NOT_FOUND",
          severity: "warning",
          affectedCapability: profile.executor.agentId,
          message: `Selected agent ${profile.executor.agentId} is not found in capability registry`,
          suggestedResolution:
            "Select a valid agent from the available capabilities or update the agent ID",
          blocking: false,
        });
      } else if (agent.state !== "available") {
        issues.push({
          code: "EXECUTOR_AGENT_UNAVAILABLE",
          severity: "warning",
          affectedCapability: profile.executor.agentId,
          message: `Selected agent ${profile.executor.agentId} is not currently available`,
          suggestedResolution: "Select a different agent or wait for the agent to become available",
          blocking: false,
        });
      }
    }

    // Validate invocation mode
    const validModes = ["direct", "chat-handoff", "clipboard-handoff", "manual", "deterministic"];
    if (!validModes.includes(profile.executor.invocationMode)) {
      issues.push({
        code: "EXECUTOR_INVALID_INVOCATION_MODE",
        severity: "error",
        affectedCapability: "executor",
        message: `Invalid invocation mode: ${profile.executor.invocationMode}`,
        suggestedResolution:
          "Use one of: direct, chat-handoff, clipboard-handoff, manual, deterministic",
        blocking: true,
      });
    }

    // Validate fallback configuration if provided
    if (profile.executor.fallbackAgentId) {
      const fallbackAgent = this.capabilityService.getCapabilityById(
        profile.executor.fallbackAgentId,
      );
      if (!fallbackAgent) {
        issues.push({
          code: "EXECUTOR_FALLBACK_AGENT_NOT_FOUND",
          severity: "warning",
          affectedCapability: profile.executor.fallbackAgentId,
          message: `Fallback agent ${profile.executor.fallbackAgentId} is not found in capability registry`,
          suggestedResolution: "Select a valid fallback agent or remove the fallback configuration",
          blocking: false,
        });
      } else if (fallbackAgent.state !== "available") {
        issues.push({
          code: "EXECUTOR_FALLBACK_AGENT_UNAVAILABLE",
          severity: "warning",
          affectedCapability: profile.executor.fallbackAgentId,
          message: `Fallback agent ${profile.executor.fallbackAgentId} is not currently available`,
          suggestedResolution:
            "Select a different fallback agent or wait for the agent to become available",
          blocking: false,
        });
      }
    }

    return issues;
  }

  /**
   * Validate the skills configuration in the profile.
   *
   * @param profile The profile to validate
   * @returns List of validation issues
   */
  private validateSkills(profile: ExecutionProfile): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check that skill IDs are valid
    for (const skillRef of profile.skills) {
      if (!skillRef.skillId) {
        issues.push({
          code: "SKILL_ID_MISSING",
          severity: "error",
          affectedCapability: "skills",
          message: "Skill reference must specify a skill ID",
          suggestedResolution: "Provide a valid skill ID",
          blocking: true,
        });
        continue;
      }

      // Check if the skill exists in the capability registry
      const skill = this.capabilityService.getCapabilityById(skillRef.skillId);
      if (!skill) {
        issues.push({
          code: "SKILL_NOT_FOUND",
          severity: "warning",
          affectedCapability: skillRef.skillId,
          message: `Skill ${skillRef.skillId} is not found in capability registry`,
          suggestedResolution: "Ensure the skill exists or remove this reference",
          blocking: false,
        });
      } else if (skill.type !== "skill") {
        issues.push({
          code: "SKILL_INVALID_TYPE",
          severity: "error",
          affectedCapability: skillRef.skillId,
          message: `Capability ${skillRef.skillId} is not a skill`,
          suggestedResolution: "Use a valid skill capability ID",
          blocking: true,
        });
      }
    }

    return issues;
  }

  /**
   * Validate the instructions configuration in the profile.
   *
   * @param profile The profile to validate
   * @returns List of validation issues
   */
  private validateInstructions(profile: ExecutionProfile): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check that instruction IDs are valid
    for (const instructionRef of profile.instructions) {
      if (!instructionRef.instructionId) {
        issues.push({
          code: "INSTRUCTION_ID_MISSING",
          severity: "error",
          affectedCapability: "instructions",
          message: "Instruction reference must specify an instruction ID",
          suggestedResolution: "Provide a valid instruction ID",
          blocking: true,
        });
        continue;
      }

      // Check if the instruction exists in the capability registry
      const instruction = this.capabilityService.getCapabilityById(instructionRef.instructionId);
      if (!instruction) {
        issues.push({
          code: "INSTRUCTION_NOT_FOUND",
          severity: "warning",
          affectedCapability: instructionRef.instructionId,
          message: `Instruction ${instructionRef.instructionId} is not found in capability registry`,
          suggestedResolution: "Ensure the instruction exists or remove this reference",
          blocking: false,
        });
      } else if (instruction.type !== "instruction") {
        issues.push({
          code: "INSTRUCTION_INVALID_TYPE",
          severity: "error",
          affectedCapability: instructionRef.instructionId,
          message: `Capability ${instructionRef.instructionId} is not an instruction`,
          suggestedResolution: "Use a valid instruction capability ID",
          blocking: true,
        });
      }
    }

    return issues;
  }

  /**
   * Validate the context configuration in the profile.
   *
   * @param profile The profile to validate
   * @returns List of validation issues
   */
  private validateContext(profile: ExecutionProfile): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Validate token budget
    if (profile.context.tokenBudget <= 0) {
      issues.push({
        code: "CONTEXT_INVALID_TOKEN_BUDGET",
        severity: "error",
        affectedCapability: "context",
        message: "Token budget must be positive",
        suggestedResolution: "Set token budget to a positive value",
        blocking: true,
      });
    }

    return issues;
  }

  /**
   * Validate the control configuration in the profile.
   *
   * @param profile The profile to validate
   * @returns List of validation issues
   */
  private validateControl(profile: ExecutionProfile): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Validate retry limit
    if (profile.control.retryLimit < 0) {
      issues.push({
        code: "CONTROL_INVALID_RETRY_LIMIT",
        severity: "error",
        affectedCapability: "control",
        message: "Retry limit must be non-negative",
        suggestedResolution: "Set retry limit to zero or a positive integer",
        blocking: true,
      });
    }

    // Validate timeout seconds if provided
    if (profile.control.timeoutSeconds !== undefined && profile.control.timeoutSeconds < 0) {
      issues.push({
        code: "CONTROL_INVALID_TIMEOUT",
        severity: "error",
        affectedCapability: "control",
        message: "Timeout seconds must be non-negative",
        suggestedResolution: "Set timeout to zero or a positive integer",
        blocking: true,
      });
    }

    return issues;
  }

  /**
   * Validate the output configuration in the profile.
   *
   * @param profile The profile to validate
   * @returns List of validation issues
   */
  private validateOutput(profile: ExecutionProfile): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Validate contract type
    const validContractTypes = [
      "implementation",
      "analysis",
      "test-plan",
      "test-changes",
      "review-findings",
      "documentation",
      "custom",
    ];

    if (!validContractTypes.includes(profile.output.contractType)) {
      issues.push({
        code: "OUTPUT_INVALID_CONTRACT_TYPE",
        severity: "error",
        affectedCapability: "output",
        message: `Invalid output contract type: ${profile.output.contractType}`,
        suggestedResolution:
          "Use one of: implementation, analysis, test-plan, test-changes, review-findings, documentation, custom",
        blocking: true,
      });
    }

    // Validate custom schema ID when contract type is custom
    if (profile.output.contractType === "custom" && !profile.output.customSchemaId) {
      issues.push({
        code: "OUTPUT_CUSTOM_SCHEMA_MISSING",
        severity: "warning",
        affectedCapability: "output",
        message: "Custom output contract requires a schema ID",
        suggestedResolution: "Provide a custom schema ID or change contract type",
        blocking: false,
      });
    }

    return issues;
  }

  /**
   * Validate that all referenced capabilities are available.
   *
   * @param profile The profile to validate
   * @returns List of validation issues
   */
  private validateCapabilityAvailability(profile: ExecutionProfile): ValidationIssue[] {
    const issues: ValidationIssue[] = [];

    // Check if all referenced capabilities are available or have fallbacks
    const referencedCapabilities = new Set<string>();

    // Add agent ID
    if (profile.executor.agentId) {
      referencedCapabilities.add(profile.executor.agentId);
    }

    // Add fallback agent ID if exists
    if (profile.executor.fallbackAgentId) {
      referencedCapabilities.add(profile.executor.fallbackAgentId);
    }

    // Add skill IDs
    for (const skillRef of profile.skills) {
      if (skillRef.skillId) {
        referencedCapabilities.add(skillRef.skillId);
      }
    }

    // Add instruction IDs
    for (const instructionRef of profile.instructions) {
      if (instructionRef.instructionId) {
        referencedCapabilities.add(instructionRef.instructionId);
      }
    }

    // Validate each referenced capability
    for (const capabilityId of referencedCapabilities) {
      const capability = this.capabilityService.getCapabilityById(capabilityId);
      if (!capability) {
        issues.push({
          code: "CAPABILITY_NOT_FOUND",
          severity: "warning",
          affectedCapability: capabilityId,
          message: `Referenced capability ${capabilityId} is not found`,
          suggestedResolution: "Check that capability exists or update the reference",
          blocking: false,
        });
      } else if (capability.state === "unavailable") {
        issues.push({
          code: "CAPABILITY_UNAVAILABLE",
          severity: "warning",
          affectedCapability: capabilityId,
          message: `Referenced capability ${capabilityId} is not available`,
          suggestedResolution: "Ensure capability is available or select a different option",
          blocking: false,
        });
      }
    }

    return issues;
  }
}
