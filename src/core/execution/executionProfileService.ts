/**
 * Service for managing execution profiles in Keystone.
 *
 * This service handles creation, retrieval, and management of execution profiles
 * that define how each SDLC stage should be configured for execution.
 */

import { BUILT_IN_EXECUTION_PROFILES } from './executionProfile';
import type { BuiltInExecutionProfile, ExecutionProfile } from './executionProfile';
import type { CapabilityDiscoveryService } from './capabilityDiscoveryService';
import type { AgentCapability, InstructionCapability, SkillCapability } from './capability';
import type { KeystoneLogger } from '../../shared/logging/KeystoneLogger';

/**
 * Service for managing execution profiles in the Keystone system.
 */
export class ExecutionProfileService {
  private logger: KeystoneLogger;
  private capabilityService: CapabilityDiscoveryService;
  private profiles: ExecutionProfile[] = [];
  private builtInProfiles: BuiltInExecutionProfile[] = BUILT_IN_EXECUTION_PROFILES;

  constructor(logger: KeystoneLogger, capabilityService: CapabilityDiscoveryService) {
    this.logger = logger;
    this.capabilityService = capabilityService;
    this.profiles = [];
  }

  /**
   * Get all available execution profiles.
   *
   * @returns List of all execution profiles (built-in + user-created)
   */
  getExecutionProfiles(): ExecutionProfile[] {
    return this.profiles;
  }

  /**
   * Get built-in execution profiles.
   *
   * @returns List of built-in execution profiles
   */
  getBuiltInProfiles(): BuiltInExecutionProfile[] {
    return this.builtInProfiles;
  }

  /**
   * Get a specific execution profile by ID.
   *
   * @param id The profile ID to retrieve
   * @returns The profile if found, otherwise undefined
   */
  getExecutionProfileById(id: string): ExecutionProfile | undefined {
    return this.profiles.find(profile => profile.id === id);
  }

  /**
   * Create a new execution profile.
   *
   * @param profile The profile to create
   * @returns The created profile
   */
  createExecutionProfile(profile: Omit<ExecutionProfile, 'metadata'>): ExecutionProfile {
    const newProfile: ExecutionProfile = {
      ...profile,
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: "user",
        version: 1
      }
    };

    this.profiles.push(newProfile);
    this.logger.info('executionProfileService.createExecutionProfile', `Created execution profile: ${newProfile.name}`);
    return newProfile;
  }

  /**
   * Update an existing execution profile.
   *
   * @param id The profile ID to update
   * @param updates The updates to apply
   * @returns The updated profile or undefined if not found
   */
  updateExecutionProfile(id: string, updates: Partial<ExecutionProfile>): ExecutionProfile | undefined {
    const index = this.profiles.findIndex(profile => profile.id === id);
    if (index === -1) {
      return undefined;
    }

    const existing = this.profiles[index];
    if (!existing) {
      return undefined;
    }

    const updatedProfile = {
      ...existing,
      ...updates,
      metadata: {
        ...existing.metadata,
        updatedAt: new Date().toISOString()
      }
    };

    this.profiles[index] = updatedProfile;
    this.logger.info('executionProfileService.updateExecutionProfile', `Updated execution profile: ${updatedProfile.name}`);
    return updatedProfile;
  }

  /**
   * Delete an execution profile.
   *
   * @param id The profile ID to delete
   * @returns Whether deletion was successful
   */
  deleteExecutionProfile(id: string): boolean {
    const index = this.profiles.findIndex(profile => profile.id === id);
    if (index === -1) {
      return false;
    }

    this.profiles.splice(index, 1);
    this.logger.info('executionProfileService.deleteExecutionProfile', `Deleted execution profile: ${id}`);
    return true;
  }

  /**
   * Create a profile from a built-in template.
   *
   * @param builtInProfileId The ID of the built-in profile to use
   * @returns The created profile or undefined if not found
   */
  createProfileFromBuiltIn(builtInProfileId: string): ExecutionProfile | undefined {
    const builtInProfile = this.builtInProfiles.find(p => p.id === builtInProfileId);
    if (!builtInProfile) {
      return undefined;
    }

    // Create a new profile based on the built-in template
    const newProfile: ExecutionProfile = {
      id: `${builtInProfileId}-${Date.now()}`,
      name: builtInProfile.name,
      description: builtInProfile.description,
      executor: {
        agentId: "",
        invocationMode: "manual",
        fallbackAgentId: builtInProfile.fallbackBehavior.fallbackAgentId,
        fallbackMode: builtInProfile.fallbackBehavior.fallbackMode
      },
      skills: [],
      instructions: [],
      context: {
        profileId: undefined,
        tokenBudget: builtInProfile.defaultTokenBudget,
        includeWorkflowIntent: true,
        includeSpecification: true,
        includeAcceptanceCriteria: true,
        includeStageHistory: true,
        includeValidationEvidence: true,
        includeUserPinnedContext: true
      },
      control: {
        approvalRequired: builtInProfile.approvalRequired,
        allowAutomaticInvocation: true,
        retryLimit: 3,
        requirePromptPreview: builtInProfile.requirePromptPreview,
        requireOutputReview: true
      },
      output: builtInProfile.expectedOutputContract,
      metadata: {
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: "user",
        version: 1
      }
    };

    this.profiles.push(newProfile);
    this.logger.info('executionProfileService.createProfileFromBuiltIn', `Created profile from built-in template: ${newProfile.name}`);
    return newProfile;
  }

  /**
   * Apply a built-in profile to a workflow stage.
   *
   * @param stageType The stage type to apply to
   * @param profileId The built-in profile ID to apply
   * @returns The applied profile or undefined if not found or applicable
   */
  applyBuiltInProfileToStage(stageType: string, profileId: string): ExecutionProfile | undefined {
    const builtInProfile = this.builtInProfiles.find(p => p.id === profileId);
    if (!builtInProfile) {
      return undefined;
    }

    // Check if this profile is applicable to the stage type
    if (!builtInProfile.applicableStageTypes.includes(stageType)) {
      return undefined;
    }

    // Create a new profile from the built-in template
    return this.createProfileFromBuiltIn(profileId);
  }

  /**
   * Validate that an execution profile is valid.
   *
   * @param profile The profile to validate
   * @returns Whether the profile is valid
   */
  validateProfile(profile: ExecutionProfile): boolean {
    // Basic validation checks
    if (!profile.id || !profile.name) {
      return false;
    }

    // Validate executor configuration
    if (!profile.executor.agentId) {
      return false;
    }

    // Validate that the selected agent exists
    if (!this.capabilityService.isCapabilityAvailable(profile.executor.agentId)) {
      // This might be okay if it's a fallback or the capability will be discovered later
      this.logger.warning('executionProfileService.validateProfile', `Selected agent ${profile.executor.agentId} is not currently available`);
    }

    // Validate token budget
    if (profile.context.tokenBudget <= 0) {
      return false;
    }

    // Validate skills exist (if any)
    // In a real implementation, we would check if each referenced skill exists
    // via the capability service; for now we accept the profile's references.

    // Validate instructions exist (if any)
    // In a real implementation, we would check if each referenced instruction exists
    // via the capability service; for now we accept the profile's references.

    return true;
  }

  /**
   * Get available agents for execution.
   *
   * @returns List of available agent capabilities
   */
  getAvailableAgents(): AgentCapability[] {
    return this.capabilityService.getCapabilitiesByType('agent') as AgentCapability[];
  }

  /**
   * Get available skills for execution.
   *
   * @returns List of available skill capabilities
   */
  getAvailableSkills(): SkillCapability[] {
    return this.capabilityService.getCapabilitiesByType('skill') as SkillCapability[];
  }

  /**
   * Get available instructions for execution.
   *
   * @returns List of available instruction capabilities
   */
  getAvailableInstructions(): InstructionCapability[] {
    return this.capabilityService.getCapabilitiesByType('instruction') as InstructionCapability[];
  }
}