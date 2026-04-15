// ============================================================
// lib/AgentRuntime.js — Lightweight Autonomous Agent Framework
// Uses OpenAI Compatible API with automatic Gemini fallback
// Primary: NVIDIA NIM (LLaMA) → Fallback: Google Gemini Flash
// ============================================================

import OpenAI from 'openai';
import { z } from 'zod';
import { logger as rootLogger } from './logger.js';

export class AgentRuntime {
  constructor({ apiKey, model = 'meta/llama-3.1-70b-instruct', baseURL = 'https://integrate.api.nvidia.com/v1' }) {
    this.apiKey = apiKey;
    this.openai = apiKey ? new OpenAI({ apiKey, baseURL }) : null;
    this.model = model;
    this.agents = new Map();
    this.globalTools = new Map();

    // Gemini fallback client (uses OpenAI-compatible endpoint)
    const geminiKey = process.env.GEMINI_API_KEY;
    if (geminiKey) {
      this.geminiClient = new OpenAI({
        apiKey: geminiKey,
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      });
      this.geminiModel = 'gemini-2.0-flash';
      rootLogger.info('Gemini fallback enabled', { model: 'gemini-2.0-flash' });
    } else {
      this.geminiClient = null;
      rootLogger.warn('GEMINI_API_KEY not set — no fallback available');
    }

    if (!apiKey) {
      rootLogger.warn('API_KEY not set — agents will only work in mock mode');
    }
  }

  registerAgent(agent) {
    this.agents.set(agent.name, agent);
    return this;
  }

  registerGlobalTool(name, fn, schema) {
    this.globalTools.set(name, { fn, schema });
    return this;
  }

  getAgent(name) {
    return this.agents.get(name);
  }

  // ── Static utility: Parse and validate LLM JSON output ──────
  /**
   * Safely parse raw LLM text response and validate against a Zod schema.
   * Handles markdown code fences, trailing commas, and other LLM quirks.
   * @param {string} rawText - Raw text from LLM response
   * @param {z.ZodSchema} schema - Zod schema to validate against
   * @returns {{ success: boolean, data?: any, error?: string }}
   */
  static safeParseLLMOutput(rawText, schema) {
    if (!rawText || typeof rawText !== 'string') {
      return { success: false, error: 'Empty or non-string response from LLM' };
    }

    // Step 1: Strip markdown code fences
    let jsonStr = rawText
      .replace(/^```json\s*/im, '')
      .replace(/^```\s*/im, '')
      .replace(/```\s*$/im, '')
      .trim();

    // Step 2: Try to extract JSON if wrapped in other text
    if (!jsonStr.startsWith('{') && !jsonStr.startsWith('[')) {
      const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      }
    }

    // Step 3: Parse JSON
    let parsed;
    try {
      parsed = JSON.parse(jsonStr);
    } catch (parseErr) {
      // Try fixing common LLM JSON mistakes
      try {
        // Remove trailing commas before } or ]
        const fixed = jsonStr
          .replace(/,\s*([}\]])/g, '$1')
          .replace(/'/g, '"'); // Single to double quotes
        parsed = JSON.parse(fixed);
      } catch {
        return {
          success: false,
          error: `JSON parse failed: ${parseErr.message}. Raw: "${jsonStr.slice(0, 200)}..."`,
        };
      }
    }

    // Step 4: Validate with Zod
    if (!schema) {
      return { success: true, data: parsed };
    }

    const result = schema.safeParse(parsed);
    if (result.success) {
      return { success: true, data: result.data };
    }

    // Format Zod errors into a clear message for LLM self-correction
    const errorMessages = result.error.issues.map(
      issue => `  - ${issue.path.join('.')}: ${issue.message}`
    ).join('\n');

    return {
      success: false,
      error: `Schema validation failed:\n${errorMessages}`,
      rawParsed: parsed, // Include what was parsed so caller can attempt partial recovery
    };
  }

  async run(agentName, userMessage, context = {}) {
    const agent = this.agents.get(agentName);
    if (!agent) throw new Error(`Agent "${agentName}" not registered`);

    if (!this.openai) {
      rootLogger.info(`Agent ${agentName} running in MOCK MODE`, { agent: agentName, prompt: userMessage.slice(0, 80) });
      return {
        agent: agentName,
        response: `[MOCK] Agent "${agentName}" received the task but API_KEY is not set.`,
        artifacts: [],
        iterations: 0,
      };
    }

    // Try primary model (NVIDIA)
    const result = await this._runWithClient(agentName, agent, userMessage, context, this.openai, this.model, 'NVIDIA');

    // If primary failed AND Gemini fallback is available → retry with Gemini
    const needsFallback = result.response.includes('max iterations')
      || result.response.includes('Agent encountered an error')
      || result.response === 'No response from model.';

    if (needsFallback && this.geminiClient && !context._isGeminiFallback) {
      rootLogger.info(`Primary model failed, retrying with Gemini fallback`, { agent: agentName });
      const fallbackResult = await this._runWithClient(
        agentName, agent, userMessage,
        { ...context, _isGeminiFallback: true },
        this.geminiClient, this.geminiModel, 'Gemini'
      );
      fallbackResult.fallbackUsed = true;
      return fallbackResult;
    }

    return result;
  }

  /**
   * Core execution loop — runs an agent with a specific LLM client/model
   */
  async _runWithClient(agentName, agent, userMessage, context, client, model, providerName) {
    const tools = this._buildOpenAITools(agent);
    
    // Initialize message history
    const messages = [
      { role: 'system', content: agent.systemPrompt },
      ...(context.history || [])
    ];
    
    messages.push({ role: 'user', content: userMessage });

    const maxIterations = context.maxIterations || 15;
    const maxToolCalls = context.maxToolCalls || 20;
    let iteration = 0;
    let totalToolCalls = 0;
    let finalResponse = null;
    const artifacts = [];

    const log = rootLogger.trace().child({ agent: agentName, provider: providerName, model });
    log.info('Agent run started');

    while (iteration < maxIterations) {
      iteration++;

      let response;
      try {
        response = await client.chat.completions.create({
          model,
          messages,
          tools: tools.length > 0 ? tools : undefined,
          temperature: 0.7,
        });
      } catch (err) {
        log.error('LLM API error', { error: err.message, iteration });
        finalResponse = `Agent encountered an error: ${err.message}`;
        break;
      }

      const message = response.choices[0]?.message;
      if (!message) {
        finalResponse = 'No response from model.';
        break;
      }

      messages.push(message);

      if (!message.tool_calls || message.tool_calls.length === 0) {
        finalResponse = message.content || '';
        break;
      }

      // Guard: check if we've exceeded max tool calls
      if (totalToolCalls >= maxToolCalls) {
        log.warn('Max tool calls reached — forcing final response', { totalToolCalls, maxToolCalls });
        messages.push({
          role: 'user',
          content: 'SYSTEM: You have reached the maximum number of tool calls. You MUST now respond with your final answer using all the information you have gathered so far. Do NOT call any more tools. Respond NOW with your complete analysis in the required JSON format.',
        });
        // Remove tool_calls from the last message to prevent loop
        const lastMsg = messages[messages.length - 2];
        if (lastMsg && lastMsg.tool_calls) {
          // Respond to pending tool calls with a stop message
          for (const tc of message.tool_calls) {
            messages.push({
              role: 'tool',
              tool_call_id: tc.id,
              content: 'STOPPED: Max tool calls reached. Use available data to respond.',
            });
          }
        }
        continue;
      }

      for (const toolCall of message.tool_calls) {
        totalToolCalls++;
        const fnName = toolCall.function.name;
        let args = {};
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch (e) {
          log.error(`Failed to parse args for tool`, { tool: fnName });
        }

        log.info('Tool call', { tool: fnName, argKeys: Object.keys(args), callNum: totalToolCalls, maxToolCalls });

        let result;
        try {
          result = await this._executeTool(agent, fnName, args, context);
        } catch (err) {
          // Distinguish Zod validation errors from runtime errors
          if (err.name === 'ZodError') {
            const fieldErrors = err.issues.map(
              i => `${i.path.join('.')}: ${i.message}`
            ).join('; ');
            result = `VALIDATION_ERROR: Invalid arguments for ${fnName}. Fix these fields and retry: ${fieldErrors}`;
            log.warn('Zod validation error on tool', { tool: fnName, errors: fieldErrors });
          } else {
            result = `ERROR: ${err.message}`;
            log.error('Tool runtime error', { tool: fnName, error: err.message });
          }
        }

        if (result && typeof result === 'object' && result.__artifact) {
          artifacts.push(result.__artifact);
          result = result.message || 'Artifact created successfully.';
        }

        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: resultStr,
        });
      }
    }

    if (!finalResponse) {
      finalResponse = 'Agent reached max iterations without a final response.';
    }

    return {
      agent: agentName,
      response: finalResponse,
      artifacts,
      iterations: iteration,
      provider: providerName,
    };
  }

  /**
   * Execute a tool with optional Zod input validation.
   * If the tool has an `inputSchema` (Zod), validates args BEFORE calling fn.
   */
  async _executeTool(agent, fnName, args, context) {
    let tool = null;
    
    if (agent.tools.has(fnName)) {
      tool = agent.tools.get(fnName);
    } else if (this.globalTools.has(fnName)) {
      tool = this.globalTools.get(fnName);
    } else if (fnName === 'delegate_to_agent') {
      return await this._handleDelegation(args, context);
    } else {
      throw new Error(`Unknown tool: ${fnName}`);
    }

    // ── Zod Input Validation ──────────────────────────────────
    if (tool.inputSchema) {
      // .parse() throws ZodError on failure — caught in the caller
      args = tool.inputSchema.parse(args);
    }

    return await tool.fn(args, context);
  }

  async _handleDelegation(args, context) {
    const { agent_name, task_description } = args;
    rootLogger.info('Delegating to agent', { target: agent_name, task: task_description.slice(0, 80) });
    const result = await this.run(agent_name, task_description, context);
    return result.response;
  }

  _buildOpenAITools(agent) {
    const declarations = [];

    for (const [name, tool] of agent.tools) {
      declarations.push(this._toOpenAIFunction(name, tool));
    }

    for (const [name, { schema }] of this.globalTools) {
      declarations.push({
        type: 'function',
        function: {
          name,
          description: schema.description || name,
          parameters: this._cleanSchemaForOpenAI(schema.parameters || { type: 'object', properties: {} }),
        }
      });
    }

    const agentNames = Array.from(this.agents.keys());
    if (agentNames.length > 1) {
      declarations.push({
        type: 'function',
        function: {
          name: 'delegate_to_agent',
          description: `Delegate a task to another specialist agent. Available: ${agentNames.join(', ')}`,
          parameters: {
            type: 'object',
            properties: {
              agent_name: { type: 'string', description: 'Name of the agent to delegate to' },
              task_description: { type: 'string', description: 'Clear description of the task' },
            },
            required: ['agent_name', 'task_description'],
          },
        }
      });
    }

    return declarations;
  }

  _toOpenAIFunction(name, tool) {
    return {
      type: 'function',
      function: {
        name,
        description: tool.description || name,
        parameters: this._cleanSchemaForOpenAI(tool.parameters || { type: 'object', properties: {} }),
      }
    };
  }

  _cleanSchemaForOpenAI(schema) {
    if (!schema || typeof schema !== 'object') return { type: 'string' };

    const cleaned = { ...schema };

    if (cleaned.type) {
      const t = cleaned.type.toLowerCase();
      // Translate any mismatched types. In JSON Schema it should be string/integer/boolean/object/array/number
      cleaned.type = t === 'int' ? 'integer' : t === 'bool' ? 'boolean' : t;
    }

    if (cleaned.properties) {
      const newProps = {};
      for (const [key, val] of Object.entries(cleaned.properties)) {
        newProps[key] = this._cleanSchemaForOpenAI(val);
      }
      cleaned.properties = newProps;
    }

    if (cleaned.items) cleaned.items = this._cleanSchemaForOpenAI(cleaned.items);
    return cleaned;
  }
}

export class Agent {
  constructor({ name, systemPrompt, tools = [] }) {
    this.name = name;
    this.systemPrompt = systemPrompt;
    this.tools = new Map();
    for (const tool of tools) {
      // Support both Tool instances and plain async functions
      if (typeof tool === 'function') {
        // Plain function: use the function itself as .fn and derive name/schema from it
        this.tools.set(tool.name, {
          name: tool.name,
          description: `Tool: ${tool.name}`,
          parameters: {
            type: 'object',
            properties: {
              q: { type: 'string', description: 'Input parameter' },
            },
          },
          fn: tool,
        });
      } else {
        // Tool instance or plain object — must have .name and .fn
        this.tools.set(tool.name, tool);
      }
    }
  }
  addTool(tool) {
    this.tools.set(tool.name, tool);
    return this;
  }
  getToolSchemas() {
    return Array.from(this.tools.values()).map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters || { type: 'object', properties: {} },
      },
    }));
  }
}

export class Tool {
  /**
   * @param {object} opts
   * @param {string} opts.name - Tool name
   * @param {string} opts.description - Tool description for LLM
   * @param {object} opts.parameters - JSON Schema for LLM function calling
   * @param {Function} opts.fn - Tool implementation
   * @param {import('zod').ZodSchema} [opts.inputSchema] - Optional Zod schema for runtime input validation
   */
  constructor({ name, description, parameters, fn, inputSchema }) {
    this.name = name;
    this.description = description;
    this.parameters = parameters;
    this.fn = fn;
    this.inputSchema = inputSchema || null;
  }
}
