// ============================================================
// lib/AgentMessenger.js — Inter-agent queue + durable state
// ============================================================
//
// ESM module. No top-level side effects. Caller owns the supabase
// client lifetime and passes it in via the constructor.
//
// Tables consumed (schema from Track A migration):
//   agent_messages   — inter-agent queue
//   agent_processes  — heartbeat / process registry
//   agent_state      — durable per-agent k/v store
//
// See method JSDoc for individual behaviour contracts.
// ============================================================

import os from 'os';

// ─── Typed errors ────────────────────────────────────────────

export class AgentMessengerError extends Error {
  constructor(message, context = {}) {
    super(message);
    this.name = 'AgentMessengerError';
    this.context = context;
  }
}

// ─── AgentMessenger class ────────────────────────────────────

export class AgentMessenger {
  /**
   * @param {object} opts
   * @param {import('@supabase/supabase-js').SupabaseClient} opts.supabase
   *   Caller-owned Supabase client.
   * @param {string} opts.agentName   Logical agent identifier (e.g. 'helena').
   * @param {string} opts.processId   UUID that uniquely identifies this process instance.
   * @param {string} opts.brandId     UUID of the brand this agent operates under.
   */
  constructor({ supabase, agentName, processId, brandId }) {
    if (!supabase)   throw new AgentMessengerError('supabase client is required');
    if (!agentName)  throw new AgentMessengerError('agentName is required');
    if (!processId)  throw new AgentMessengerError('processId is required');
    if (!brandId)    throw new AgentMessengerError('brandId is required');

    this._db        = supabase;
    this.agentName  = agentName;
    this.processId  = processId;
    this.brandId    = brandId;
  }

  // ── Messaging ─────────────────────────────────────────────

  /**
   * Enqueue a message to another agent.
   *
   * @param {object} opts
   * @param {string} opts.to       Recipient agent name.
   * @param {object} opts.payload  Arbitrary JSON payload.
   * @returns {Promise<object>}    The inserted row.
   */
  async send({ to, payload }) {
    if (!to)      throw new AgentMessengerError('send: `to` is required');
    if (!payload) throw new AgentMessengerError('send: `payload` is required');

    const { data, error } = await this._db
      .from('agent_messages')
      .insert({
        brand_id:   this.brandId,
        from_agent: this.agentName,
        to_agent:   to,
        payload,
        status:     'pending',
      })
      .select()
      .single();

    if (error) {
      throw new AgentMessengerError(`send failed: ${error.message}`, { to, error });
    }
    if (!data) {
      throw new AgentMessengerError('send: Supabase returned no data after insert', { to });
    }
    return data;
  }

  /**
   * Claim pending messages addressed to this agent.
   *
   * @note SKIP LOCKED semantics: Supabase JS does not expose
   * `SELECT … FOR UPDATE SKIP LOCKED` directly. We approximate
   * at-least-once delivery using a two-step pattern:
   *
   *   1. SELECT rows WHERE to_agent=this AND brand_id=this AND
   *      status='pending' AND claimed_by IS NULL ORDER BY created_at
   *      LIMIT N
   *   2. For each candidate row, UPDATE SET status='claimed',
   *      claimed_by=processId, claimed_at=now()
   *      WHERE id=row.id AND status='pending' AND claimed_by IS NULL
   *      RETURNING *
   *
   * Step 2 filters on `claimed_by IS NULL` which means concurrent
   * workers racing on the same row will at most produce a "missed
   * update" (zero rows returned) rather than a double-claim. Rows
   * claimed by another worker are silently skipped. This gives
   * at-least-once delivery without strict SKIP LOCKED; idempotent
   * message handlers are strongly recommended.
   *
   * To upgrade to strict once-only delivery, add an RPC in the
   * migration:
   *   CREATE FUNCTION claim_agent_messages(…) RETURNS SETOF agent_messages
   *   LANGUAGE sql AS $$
   *     UPDATE agent_messages SET status='claimed', …
   *     WHERE id IN (
   *       SELECT id FROM agent_messages
   *       WHERE to_agent=$1 AND brand_id=$2 AND status='pending'
   *       ORDER BY created_at LIMIT $3
   *       FOR UPDATE SKIP LOCKED
   *     ) RETURNING *;
   *   $$;
   * Then call `supabase.rpc('claim_agent_messages', {…})` here.
   *
   * @param {object} [opts]
   * @param {number} [opts.limit=10]  Max messages to claim in one batch.
   * @returns {Promise<object[]>}     Claimed message rows.
   */
  async recv({ limit = 10 } = {}) {
    // Step 1: fetch candidates
    const { data: candidates, error: selectErr } = await this._db
      .from('agent_messages')
      .select('id')
      .eq('to_agent',   this.agentName)
      .eq('brand_id',   this.brandId)
      .eq('status',     'pending')
      .is('claimed_by', null)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (selectErr) {
      throw new AgentMessengerError(`recv select failed: ${selectErr.message}`, { selectErr });
    }
    if (!candidates || candidates.length === 0) return [];

    const now = new Date().toISOString();
    const claimed = [];

    // Step 2: attempt to claim each row atomically via guarded UPDATE
    for (const { id } of candidates) {
      const { data: row, error: updateErr } = await this._db
        .from('agent_messages')
        .update({
          status:     'claimed',
          claimed_by: this.processId,
          claimed_at: now,
        })
        .eq('id',         id)
        .eq('status',     'pending')
        .is('claimed_by', null)
        .select()
        .maybeSingle();

      if (updateErr) {
        console.warn(`[AgentMessenger] recv: failed to claim msg ${id}: ${updateErr.message}`);
        continue;
      }
      if (row) claimed.push(row);
      // null row means another worker already claimed it — skip silently
    }

    return claimed;
  }

  /**
   * Acknowledge successful processing of a claimed message.
   * Only succeeds when the message was claimed by this processId.
   *
   * @param {string|number} msgId  The message id to acknowledge.
   * @param {object} [opts]
   * @param {object} [opts.result] Arbitrary result payload to persist.
   * @returns {Promise<object>}    The updated row.
   */
  async ack(msgId, { result } = {}) {
    if (msgId === undefined || msgId === null) {
      throw new AgentMessengerError('ack: msgId is required');
    }

    const { data, error } = await this._db
      .from('agent_messages')
      .update({
        status:       'processed',
        processed_at: new Date().toISOString(),
        result:       result ?? null,
      })
      .eq('id',         msgId)
      .eq('claimed_by', this.processId)
      .eq('status',     'claimed')
      .select()
      .maybeSingle();

    if (error) {
      throw new AgentMessengerError(`ack failed: ${error.message}`, { msgId, error });
    }
    if (!data) {
      throw new AgentMessengerError(
        `ack: message ${msgId} not found or not claimed by this process (${this.processId})`,
        { msgId, processId: this.processId }
      );
    }
    return data;
  }

  /**
   * Negative-acknowledge a claimed message, marking it as failed.
   * Only succeeds when the message was claimed by this processId.
   *
   * @param {string|number} msgId  The message id to nack.
   * @param {string} reason        Human-readable error description.
   * @returns {Promise<object>}    The updated row.
   */
  async nack(msgId, reason) {
    if (msgId === undefined || msgId === null) {
      throw new AgentMessengerError('nack: msgId is required');
    }
    if (!reason) {
      throw new AgentMessengerError('nack: reason is required');
    }

    const { data, error } = await this._db
      .from('agent_messages')
      .update({
        status: 'failed',
        error:  String(reason),
      })
      .eq('id',         msgId)
      .eq('claimed_by', this.processId)
      .eq('status',     'claimed')
      .select()
      .maybeSingle();

    if (error) {
      throw new AgentMessengerError(`nack failed: ${error.message}`, { msgId, error });
    }
    if (!data) {
      throw new AgentMessengerError(
        `nack: message ${msgId} not found or not claimed by this process (${this.processId})`,
        { msgId, processId: this.processId }
      );
    }
    return data;
  }

  // ── Process registry ──────────────────────────────────────

  /**
   * Register this process in agent_processes.
   * Call once on startup before the message loop begins.
   *
   * @param {object} [opts]
   * @param {string} [opts.host]      Hostname override; defaults to os.hostname().
   * @param {object} [opts.metadata]  Arbitrary metadata to store alongside the record.
   * @returns {Promise<object>}       The inserted/upserted row.
   */
  async register({ host, metadata } = {}) {
    const now = new Date().toISOString();

    const { data, error } = await this._db
      .from('agent_processes')
      .upsert({
        agent_name:          this.agentName,
        brand_id:            this.brandId,
        process_id:          this.processId,
        host:                host ?? os.hostname(),
        started_at:          now,
        last_heartbeat_at:   now,
        status:              'running',
        metadata:            metadata ?? null,
      }, { onConflict: 'process_id' })
      .select()
      .maybeSingle();

    if (error) {
      throw new AgentMessengerError(`register failed: ${error.message}`, { error });
    }
    return data;
  }

  /**
   * Update last_heartbeat_at for this process.
   * Call on a periodic timer (e.g. every 30 s) to signal liveness.
   *
   * @returns {Promise<object>}  The updated row.
   */
  async heartbeat() {
    const { data, error } = await this._db
      .from('agent_processes')
      .update({ last_heartbeat_at: new Date().toISOString() })
      .eq('process_id', this.processId)
      .select()
      .maybeSingle();

    if (error) {
      throw new AgentMessengerError(`heartbeat failed: ${error.message}`, { error });
    }
    if (!data) {
      console.warn(`[AgentMessenger] heartbeat: no row found for processId ${this.processId}`);
    }
    return data;
  }

  /**
   * Mark this process as stopped in agent_processes.
   * Call on graceful shutdown (SIGTERM/SIGINT handler).
   *
   * @returns {Promise<object>}  The updated row.
   */
  async deregister() {
    const { data, error } = await this._db
      .from('agent_processes')
      .update({ status: 'stopped' })
      .eq('process_id', this.processId)
      .select()
      .maybeSingle();

    if (error) {
      throw new AgentMessengerError(`deregister failed: ${error.message}`, { error });
    }
    return data;
  }

  // ── Durable state ─────────────────────────────────────────

  /**
   * Read a single key from this agent's durable state store.
   *
   * @param {string} key  State key to look up.
   * @returns {Promise<*>}  The stored value, or null if not found.
   */
  async getState(key) {
    if (!key) throw new AgentMessengerError('getState: key is required');

    const { data, error } = await this._db
      .from('agent_state')
      .select('value')
      .eq('agent_name', this.agentName)
      .eq('brand_id',   this.brandId)
      .eq('key',        key)
      .maybeSingle();

    if (error) {
      throw new AgentMessengerError(`getState failed: ${error.message}`, { key, error });
    }
    return data ? data.value : null;
  }

  /**
   * Upsert a single key in this agent's durable state store.
   *
   * @param {string} key    State key to set.
   * @param {*}      value  JSON-serialisable value to store.
   * @returns {Promise<object>}  The upserted row.
   */
  async setState(key, value) {
    if (!key) throw new AgentMessengerError('setState: key is required');
    if (value === undefined) throw new AgentMessengerError('setState: value is required');

    const { data, error } = await this._db
      .from('agent_state')
      .upsert({
        agent_name: this.agentName,
        brand_id:   this.brandId,
        key,
        value,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'agent_name,brand_id,key' })
      .select()
      .maybeSingle();

    if (error) {
      throw new AgentMessengerError(`setState failed: ${error.message}`, { key, error });
    }
    return data;
  }
}
