/**
 * Interface definitions for VS Code API access in Keystone.
 *
 * This file defines the contracts that Keystone uses to interact with the
 * VS Code extension API for capabilities like chat participants, language models, etc.
 */

/**
 * VS Code chat participant definition
 */
export interface VSCodeChatParticipant {
  /**
   * Unique identifier for the chat participant
   */
  id: string;

  /**
   * Human-readable name for the chat participant
   */
  name: string;

  /**
   * Description of what the chat participant does
   */
  description: string;

  /**
   * Whether the chat participant is sticky (always available)
   */
  isSticky?: boolean;
}

/**
 * VS Code language model provider definition
 */
export interface VSCodeLanguageModelProvider {
  /**
   * Unique identifier for the language model provider
   */
  id: string;

  /**
   * Human-readable name for the provider
   */
  name: string;

  /**
   * List of supported models
   */
  models: string[];
}

/**
 * VS Code extension definition
 */
export interface VSCodeExtension {
  /**
   * Unique identifier for the extension
   */
  id: string;

  /**
   * Human-readable name for the extension
   */
  name: string;

  /**
   * Extension contributions (if any)
   */
  contributes?: {
    chatParticipants?: VSCodeChatParticipant[];
    languageModelTools?: unknown[];
  };
}

/**
 * Interface for VS Code API access
 */
export interface VSCodeAPI {
  /**
   * Get available chat participants
   */
  getChatParticipants(): Promise<VSCodeChatParticipant[]>;

  /**
   * Get available language model providers
   */
  getLanguageModelProviders(): Promise<VSCodeLanguageModelProvider[]>;

  /**
   * Get available commands
   */
  getCommands(): Promise<string[]>;

  /**
   * Get available extensions
   */
  getExtensions(): Promise<VSCodeExtension[]>;

  /**
   * Open VS Code chat with content
   */
  openChatWithContent(content: string): Promise<void>;

  /**
   * Copy content to clipboard
   */
  copyToClipboard(content: string): Promise<void>;
}
