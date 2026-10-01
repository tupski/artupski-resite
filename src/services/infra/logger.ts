/**
 * Structured logger - Artupski ReSite
 * Source of truth: AGENTS.md section 7 and docs/architecture/ERROR-HANDLING.md.
 *
 * This is the single sanctioned `console` boundary in the application. All
 * other modules must emit through `logger` rather than raw `console.*`.
 */
import { toStructuredError, type StructuredError } from './errors';

export const LOG_LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  scope: string;
  message: string;
  metadata?: Record<string, unknown>;
  error?: StructuredError;
}

export type LogSink = (entry: LogEntry) => void;

const LEVEL_RANK: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
};

function generateId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const CONSOLE_METHOD: Record<LogLevel, (...args: unknown[]) => void> = {
  DEBUG: console.debug.bind(console),
  INFO: console.info.bind(console),
  WARN: console.warn.bind(console),
  ERROR: console.error.bind(console),
};

/**
 * Small, dependency-free structured logger.
 *
 * - Level filtering via `setLevel`.
 * - Structured metadata and error objects.
 * - Pluggable sinks so the future UI console (EVENT-SYSTEM.md section 6) can
 *   subscribe without the logger knowing about React or Tauri.
 */
export class Logger {
  private level: LogLevel;
  private readonly scope: string;
  private readonly sinks = new Set<LogSink>();

  constructor(scope = 'app', level: LogLevel = 'DEBUG') {
    this.scope = scope;
    this.level = level;
  }

  /** Create a child logger that shares sinks but carries a distinct scope. */
  child(scope: string): Logger {
    const child = new Logger(scope, this.level);
    for (const sink of this.sinks) {
      child.sinks.add(sink);
    }
    return child;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  addSink(sink: LogSink): () => void {
    this.sinks.add(sink);
    return () => {
      this.sinks.delete(sink);
    };
  }

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.write('DEBUG', message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.write('INFO', message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.write('WARN', message, metadata);
  }

  error(message: string, error?: unknown, metadata?: Record<string, unknown>): void {
    const structured =
      error === undefined
        ? undefined
        : toStructuredError(error, { message, severity: 'error', category: 'process' });
    this.write('ERROR', message, metadata, structured);
  }

  private write(
    level: LogLevel,
    message: string,
    metadata?: Record<string, unknown>,
    error?: StructuredError
  ): void {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.level]) {
      return;
    }

    const entry: LogEntry = {
      id: generateId(),
      timestamp: new Date().toISOString(),
      level,
      scope: this.scope,
      message,
      ...(metadata !== undefined ? { metadata } : {}),
      ...(error !== undefined ? { error } : {}),
    };

    // Sanctioned console bridge.
    CONSOLE_METHOD[level](
      `[${entry.timestamp}] [${level}] [${this.scope}] ${message}`,
      metadata ?? '',
      error ?? ''
    );

    for (const sink of this.sinks) {
      try {
        sink(entry);
      } catch {
        // A failing sink must never break application logging.
      }
    }
  }
}

/** Shared application logger. Feature modules should derive children from it. */
export const logger = new Logger('app');
