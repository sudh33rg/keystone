/**
 * Logging interface for Keystone.
 *
 * This file defines the logging contract that Keystone uses throughout the system.
 */

export interface Logger {
  /**
   * Log a debug message
   */
  debug(message: string, meta?: any): void;

  /**
   * Log an info message
   */
  info(message: string, meta?: any): void;

  /**
   * Log a warning message
   */
  warn(message: string, meta?: any): void;

  /**
   * Log an error message
   */
  error(message: string, meta?: any): void;
}