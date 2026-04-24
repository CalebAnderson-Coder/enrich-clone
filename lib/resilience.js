// ============================================================
// lib/resilience.js — Retry, Timeout & Circuit Breaker
// Shared resilience patterns for all agents and tools
// ============================================================

import { logger } from './logger.js';

// ── withRetry ─────────────────────────────────────────────────
/**
 * Retry an async function with exponential backoff.
 * @param {Function} fn - Async function to execute
 * @param {Object} opts
 * @param {number} [opts.maxRetries=3] - Maximum retry attempts
 * @param {number} [opts.baseDelayMs=500] - Base delay between retries (doubled each time)
 * @param {string} [opts.label='operation'] - Label for logging
 * @param {Function} [opts.shouldRetry] - Optional predicate (error) => boolean
 * @returns {Promise<*>}
 */
export async function withRetry(fn, opts = {}) {
  const {
    maxRetries = 3,
    baseDelayMs = 500,
    label = 'operation',
    shouldRetry = () => true,
  } = opts;

  const log = logger.child({ module: 'resilience', operation: label });
  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await fn();
      if (attempt > 1) {
        log.info(`Succeeded on attempt ${attempt}/${maxRetries}`);
      }
      return result;
    } catch (err) {
      lastError = err;
      log.warn(`Attempt ${attempt}/${maxRetries} failed`, {
        error: err.message,
        attempt,
        maxRetries,
      });

      if (attempt < maxRetries && shouldRetry(err)) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await new Promise(res => setTimeout(res, delay));
      } else if (!shouldRetry(err)) {
        log.error(`Non-retryable error, aborting`, { error: err.message });
        break;
      }
    }
  }

  throw lastError;
}

// ── withTimeout ───────────────────────────────────────────────
/**
 * Wrap a promise with a timeout.
 * @param {Promise} promise - The promise to wrap
 * @param {number} ms - Timeout in milliseconds
 * @param {string} [label='operation'] - Label for the error message
 * @returns {Promise<*>}
 */
export function withTimeout(promise, ms, label = 'operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`[${label}] Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

// ── CircuitBreaker ────────────────────────────────────────────
/**
 * Circuit breaker pattern — prevents cascading failures.
 *
 * States:
 *   CLOSED  → Normal operation. Failures are counted.
 *   OPEN    → All calls fail immediately. Resets after cooldown.
 *   HALF_OPEN → One probe call allowed. Success → CLOSED, Failure → OPEN.
 */
export class CircuitBreaker {
  /**
   * @param {Object} opts
   * @param {number} [opts.failureThreshold=5] - Failures before opening
   * @param {number} [opts.cooldownMs=30000] - Cooldown before half-open (30s)
   * @param {string} [opts.name='circuit'] - Name for logging
   */
  constructor(opts = {}) {
    this.name = opts.name || 'circuit';
    this.failureThreshold = opts.failureThreshold || 5;
    this.cooldownMs = opts.cooldownMs || 30_000;

    this.state = 'CLOSED';
    this.failures = 0;
    this.lastFailureTime = 0;

    this._log = logger.child({ module: 'circuit-breaker', circuit: this.name });
  }

  /**
   * Execute a function through the circuit breaker.
   * @param {Function} fn - Async function to protect
   * @returns {Promise<*>}
   */
  async exec(fn) {
    if (this.state === 'OPEN') {
      // Check if cooldown has elapsed → half-open
      if (Date.now() - this.lastFailureTime >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
        this._log.info('Transitioning to HALF_OPEN — probing...');
      } else {
        const err = new Error(`[CircuitBreaker:${this.name}] OPEN — rejecting call`);
        this._log.warn('Call rejected — circuit is OPEN', {
          failures: this.failures,
          cooldownRemaining: this.cooldownMs - (Date.now() - this.lastFailureTime),
        });
        throw err;
      }
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      this._onFailure();
      throw err;
    }
  }

  _onSuccess() {
    if (this.state === 'HALF_OPEN') {
      this._log.info('Probe succeeded — closing circuit');
    }
    this.failures = 0;
    this.state = 'CLOSED';
  }

  _onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.failureThreshold) {
      this.state = 'OPEN';
      this._log.error(`Failure threshold reached (${this.failures}) — opening circuit`, {
        failures: this.failures,
        threshold: this.failureThreshold,
      });
    } else if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this._log.warn('Probe failed — reopening circuit');
    }
  }

  /** Get current state for monitoring */
  getState() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      threshold: this.failureThreshold,
    };
  }
}

// ── QuotaCircuitBreaker ──────────────────────────────────────
/**
 * Specialized breaker for LLM provider quota (429 / rate_limit).
 *
 * Different semantics from the generic CircuitBreaker:
 *   - Only 429 / rate-limit errors count as failures. Other errors
 *     pass through transparently (caller handles them).
 *   - Rolling window: N 429s within windowMs trip the circuit.
 *   - Long cooldown by default (5 min), because quota resets are slow.
 *   - On OPEN, throws a distinguishable `QuotaExhaustedError` so callers
 *     can branch without string-matching error messages.
 *
 * Used by AgentRuntime to stop the Manager from thrashing an already-
 * saturated provider on subsequent cycles.
 */
export class QuotaExhaustedError extends Error {
  constructor(provider, cooldownRemainingMs) {
    super(`[QuotaCircuitBreaker:${provider}] OPEN — cooldown ${Math.ceil(cooldownRemainingMs / 1000)}s remaining`);
    this.name = 'QuotaExhaustedError';
    this.provider = provider;
    this.cooldownRemainingMs = cooldownRemainingMs;
    this.code = 429;
  }
}

export class QuotaCircuitBreaker {
  /**
   * @param {Object} opts
   * @param {string}  opts.name               Provider label (e.g. 'nvidia', 'gemini')
   * @param {number} [opts.failureThreshold=10]  429s within window to trip
   * @param {number} [opts.windowMs=60000]       Sliding window (1 min)
   * @param {number} [opts.cooldownMs=300000]    Cooldown before half-open (5 min)
   */
  constructor(opts = {}) {
    this.name             = opts.name || 'provider';
    this.failureThreshold = opts.failureThreshold ?? 10;
    this.windowMs         = opts.windowMs         ?? 60_000;
    this.cooldownMs       = opts.cooldownMs       ?? 300_000;

    this.state      = 'CLOSED';
    this._hits      = []; // timestamps of recent 429s
    this._openedAt  = 0;
    this._log = logger.child({ module: 'quota-circuit-breaker', provider: this.name });
  }

  static isRateLimitError(err) {
    if (!err) return false;
    if (err.status === 429 || err.code === 429) return true;
    const msg = err.message || err.error?.message || String(err);
    if (/\b429\b/.test(msg)) return true;
    if (/rate[_ ]?limit/i.test(msg)) return true;
    return false;
  }

  /**
   * Guard a call. If OPEN, throws QuotaExhaustedError synchronously
   * without invoking fn. Otherwise invokes fn and tracks 429s.
   */
  async exec(fn) {
    if (this.state === 'OPEN') {
      const elapsed = Date.now() - this._openedAt;
      if (elapsed >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
        this._log.info('Cooldown elapsed — probing with next call');
      } else {
        throw new QuotaExhaustedError(this.name, this.cooldownMs - elapsed);
      }
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (err) {
      if (QuotaCircuitBreaker.isRateLimitError(err)) {
        this._onRateLimit();
      }
      throw err;
    }
  }

  _onSuccess() {
    if (this.state === 'HALF_OPEN') {
      this._log.info('Probe succeeded — closing circuit');
    }
    this.state = 'CLOSED';
    this._hits.length = 0;
  }

  _onRateLimit() {
    const now = Date.now();
    this._hits.push(now);
    // Drop hits older than windowMs
    while (this._hits.length && this._hits[0] < now - this.windowMs) {
      this._hits.shift();
    }
    if (this._hits.length >= this.failureThreshold || this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      this._openedAt = now;
      this._log.error('Quota circuit OPEN', {
        hits_in_window: this._hits.length,
        threshold: this.failureThreshold,
        window_ms: this.windowMs,
        cooldown_ms: this.cooldownMs,
      });
    }
  }

  getState() {
    return {
      name: this.name,
      state: this.state,
      hits_in_window: this._hits.length,
      threshold: this.failureThreshold,
      cooldown_remaining_ms: this.state === 'OPEN'
        ? Math.max(0, this.cooldownMs - (Date.now() - this._openedAt))
        : 0,
    };
  }
}
