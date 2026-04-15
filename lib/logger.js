// ============================================================
// lib/logger.js — Structured JSON Logger with Trace IDs
// Replaces console.log with machine-parseable JSONL output
// ============================================================

import { randomUUID } from 'crypto';

// ── Log Levels ──────────────────────────────────────────────
const LEVELS = { DEBUG: 10, INFO: 20, WARN: 30, ERROR: 40, FATAL: 50 };
const LEVEL_NAMES = Object.fromEntries(Object.entries(LEVELS).map(([k, v]) => [v, k]));

const MIN_LEVEL = LEVELS[process.env.LOG_LEVEL?.toUpperCase()] || LEVELS.INFO;

// ── Core Logger ─────────────────────────────────────────────

class Logger {
  constructor(context = {}) {
    this._context = context;
  }

  /**
   * Create a child logger with additional context.
   * @param {Object} extra - Additional context fields
   * @returns {Logger}
   */
  child(extra) {
    return new Logger({ ...this._context, ...extra });
  }

  /**
   * Start a new trace — returns a child logger with a traceId.
   * @param {string} [traceId] - Optional custom trace ID
   * @returns {Logger}
   */
  trace(traceId) {
    return this.child({ traceId: traceId || randomUUID() });
  }

  // ── Level methods ───────────────────────────────────────

  debug(msg, data = {}) { this._log(LEVELS.DEBUG, msg, data); }
  info(msg, data = {})  { this._log(LEVELS.INFO, msg, data); }
  warn(msg, data = {})  { this._log(LEVELS.WARN, msg, data); }
  error(msg, data = {}) { this._log(LEVELS.ERROR, msg, data); }
  fatal(msg, data = {}) { this._log(LEVELS.FATAL, msg, data); }

  // ── Internal ────────────────────────────────────────────

  _log(level, msg, data) {
    if (level < MIN_LEVEL) return;

    const entry = {
      ts: new Date().toISOString(),
      level: LEVEL_NAMES[level],
      msg,
      ...this._context,
    };

    // Flatten error objects for JSON serialization
    if (data instanceof Error) {
      entry.error = { message: data.message, stack: data.stack, name: data.name };
    } else if (data && typeof data === 'object' && Object.keys(data).length > 0) {
      Object.assign(entry, data);
    }

    const line = JSON.stringify(entry);

    if (level >= LEVELS.ERROR) {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }
}

// ── Singleton export ──────────────────────────────────────────

export const logger = new Logger({ service: 'enrich-clone' });
export { Logger };
