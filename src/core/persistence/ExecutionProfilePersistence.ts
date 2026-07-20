/**
 * Service for persisting and loading execution profiles in Keystone.
 *
 * This service handles the storage and retrieval of execution profiles
 * to/from persistent storage (file system or extension storage).
 */

import type { ExecutionProfile } from '../execution/executionProfile';
import type { KeystoneLogger } from '../../shared/logging/KeystoneLogger';
import type { VSCodeAPI } from '../../shared/contracts/vscodeApi';
import fs from 'fs/promises';
import path from 'path';

/**
 * Service for managing the persistence of execution profiles.
 */
export class ExecutionProfilePersistence {
  private logger: KeystoneLogger;
  private vscodeAPI: VSCodeAPI;
  private profiles: ExecutionProfile[] = [];

  constructor(logger: KeystoneLogger, vscodeAPI: VSCodeAPI) {
    this.logger = logger;
    this.vscodeAPI = vscodeAPI;
  }

  /**
   * Save an execution profile to persistent storage.
   *
   * @param profile The profile to save
   * @returns Promise resolving when save is complete
   */
  async saveProfile(profile: ExecutionProfile): Promise<void> {
    try {
      this.logger.info(`Saving execution profile: ${profile.name}`);

      // In a real implementation, this would save to the file system or extension storage
      // For now, we'll just store in memory
      const existingIndex = this.profiles.findIndex(p => p.id === profile.id);
      if (existingIndex !== -1) {
        this.profiles[existingIndex] = profile;
      } else {
        this.profiles.push(profile);
      }

      this.logger.info(`Successfully saved execution profile: ${profile.name}`);
    } catch (error) {
      this.logger.error('Error saving execution profile', { error });
      throw new Error(`Failed to save profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Load all execution profiles from persistent storage.
   *
   * @returns Promise resolving to list of loaded profiles
   */
  async loadProfiles(): Promise<ExecutionProfile[]> {
    try {
      this.logger.info('Loading execution profiles from persistent storage');

      // In a real implementation, this would read from file system or extension storage
      // For now, we'll just return what's in memory or load from a default location
      const profiles = this.profiles;

      this.logger.info(`Loaded ${profiles.length} execution profiles`);

      return profiles;
    } catch (error) {
      this.logger.error('Error loading execution profiles', { error });
      throw new Error(`Failed to load profiles: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Delete an execution profile from persistent storage.
   *
   * @param profileId The ID of the profile to delete
   * @returns Promise resolving when delete is complete
   */
  async deleteProfile(profileId: string): Promise<void> {
    try {
      this.logger.info(`Deleting execution profile: ${profileId}`);

      const index = this.profiles.findIndex(p => p.id === profileId);
      if (index !== -1) {
        this.profiles.splice(index, 1);
      }

      this.logger.info(`Successfully deleted execution profile: ${profileId}`);
    } catch (error) {
      this.logger.error('Error deleting execution profile', { error });
      throw new Error(`Failed to delete profile: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Migrate old execution profile references to new format.
   *
   * @param oldProfile The old profile format to migrate
   * @returns The migrated profile or undefined if migration failed
   */
  migrateOldProfile(oldProfile: any): ExecutionProfile | undefined {
    try {
      // Migration logic would handle converting from older profile formats to the new format
      // This is a simplified example showing what might be involved

      if (!oldProfile || !oldProfile.id) {
        return undefined;
      }

      // Create a new profile in the current format
      const migratedProfile: ExecutionProfile = {
        id: oldProfile.id,
        name: oldProfile.name || 'Migrated Profile',
        description: oldProfile.description,
        executor: {
          agentId: oldProfile.agentId || '',
          invocationMode: oldProfile.invocationMode || 'manual',
          fallbackAgentId: oldProfile.fallbackAgentId,
          fallbackMode: oldProfile.fallbackMode
        },
        skills: (oldProfile.skills || []).map((skill: any) => ({
          skillId: skill.id || skill.skillId,
          enabled: skill.enabled !== undefined ? skill.enabled : true,
          order: skill.order || 0
        })),
        instructions: (oldProfile.instructions || []).map((instruction: any) => ({
          instructionId: instruction.id || instruction.instructionId,
          enabled: instruction.enabled !== undefined ? instruction.enabled : true,
          order: instruction.order || 0
        })),
        context: {
          profileId: oldProfile.contextProfileId,
          tokenBudget: oldProfile.tokenBudget || 12000,
          includeWorkflowIntent: oldProfile.includeWorkflowIntent !== undefined ? oldProfile.includeWorkflowIntent : true,
          includeSpecification: oldProfile.includeSpecification !== undefined ? oldProfile.includeSpecification : true,
          includeAcceptanceCriteria: oldProfile.includeAcceptanceCriteria !== undefined ? oldProfile.includeAcceptanceCriteria : true,
          includeStageHistory: oldProfile.includeStageHistory !== undefined ? oldProfile.includeStageHistory : true,
          includeValidationEvidence: oldProfile.includeValidationEvidence !== undefined ? oldProfile.includeValidationEvidence : true,
          includeUserPinnedContext: oldProfile.includeUserPinnedContext !== undefined ? oldProfile.includeUserPinnedContext : true
        },
        control: {
          approvalRequired: oldProfile.approvalRequired !== undefined ? oldProfile.approvalRequired : false,
          allowAutomaticInvocation: oldProfile.allowAutomaticInvocation !== undefined ? oldProfile.allowAutomaticInvocation : true,
          retryLimit: oldProfile.retryLimit || 3,
          timeoutSeconds: oldProfile.timeoutSeconds,
          requirePromptPreview: oldProfile.requirePromptPreview !== undefined ? oldProfile.requirePromptPreview : true,
          requireOutputReview: oldProfile.requireOutputReview !== undefined ? oldProfile.requireOutputReview : true
        },
        output: {
          contractType: oldProfile.outputContractType || 'implementation',
          expectedArtifacts: oldProfile.expectedArtifacts || [],
          requireStructuredResult: oldProfile.requireStructuredResult !== undefined ? oldProfile.requireStructuredResult : false,
          customSchemaId: oldProfile.customSchemaId
        },
        metadata: {
          createdAt: oldProfile.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: oldProfile.source || 'user',
          version: oldProfile.version || 1
        }
      };

      return migratedProfile;
    } catch (error) {
      this.logger.error('Error migrating old profile', { error });
      return undefined;
    }
  }

  /**
   * Get all stored profiles.
   *
   * @returns List of all stored profiles
   */
  getAllProfiles(): ExecutionProfile[] {
    return this.profiles;
  }

  /**
   * Get a specific profile by ID.
   *
   * @param id The profile ID to retrieve
   * @returns The profile if found, otherwise undefined
   */
  getProfileById(id: string): ExecutionProfile | undefined {
    return this.profiles.find(p => p.id === id);
  }
}