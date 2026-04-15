// ============================================================
// lib/AgentRuntime.js — Lightweight Autonomous Agent Framework
// Uses OpenAI Compatible API with automatic Gemini fallback
// Primary: NVIDIA NIM (LLaMA) → Fallback: Google Gemini Flash
// ============================================================

import OpenAI from 'openai';

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
      console.log('✅ Gemini fallback enabled (gemini-2.0-flash)');
    } else {
      this.geminiClient = null;
      console.warn('⚠️  GEMINI_API_KEY not set — no fallback available');
    }

    if (!apiKey) {
      console.warn('⚠️  API_KEY not set — agents will only work in mock mode');
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

  async run(agentName, userMessage, context = {}) {
    const agent = this.agents.get(agentName);
    if (!agent) throw new Error(`Agent "${agentName}" not registered`);

    if (!this.openai) {
      console.log(`  🤖 [${agentName}] MOCK MODE — would process: "${userMessage.slice(0, 80)}..."`);
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
      console.log(`  🔄 [${agentName}] Primary model failed, retrying with Gemini fallback...`);
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
    let iteration = 0;
    let finalResponse = null;
    const artifacts = [];

    console.log(`  🚀 [${agentName}] Running on ${providerName} (${model})`);

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
        console.error(`  ❌ [${agentName}] ${providerName} API error:`, err.message);
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

      for (const toolCall of message.tool_calls) {
        const fnName = toolCall.function.name;
        let args = {};
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch (e) {
          console.error(`  ❌ Failed to parse args for ${fnName}`);
        }

        console.log(`  🔧 [${agentName}] calling ${fnName}(${Object.keys(args).join(', ')})`);

        let result;
        try {
          result = await this._executeTool(agent, fnName, args, context);
        } catch (err) {
          result = `ERROR: ${err.message}`;
          console.error(`  ❌ Tool error: ${err.message}`);
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

  async _executeTool(agent, fnName, args, context) {
    if (agent.tools.has(fnName)) return await agent.tools.get(fnName).fn(args, context);
    if (this.globalTools.has(fnName)) return await this.globalTools.get(fnName).fn(args, context);
    if (fnName === 'delegate_to_agent') return await this._handleDelegation(args, context);
    throw new Error(`Unknown tool: ${fnName}`);
  }

  async _handleDelegation(args, context) {
    const { agent_name, task_description } = args;
    console.log(`  🔀 Delegating to "${agent_name}": ${task_description.slice(0, 80)}...`);
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
    for (const tool of tools) this.tools.set(tool.name, tool);
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
  constructor({ name, description, parameters, fn }) {
    this.name = name;
    this.description = description;
    this.parameters = parameters;
    this.fn = fn;
  }
}
