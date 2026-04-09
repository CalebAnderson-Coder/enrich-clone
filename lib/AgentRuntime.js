// ============================================================
// lib/AgentRuntime.js — Lightweight Autonomous Agent Framework
// Uses Google Gemini for tool-calling agents with memory + delegation
// ============================================================

import { GoogleGenerativeAI } from '@google/generative-ai';

export class AgentRuntime {
  constructor({ geminiApiKey, model = 'gemini-2.0-flash' }) {
    this.geminiApiKey = geminiApiKey;
    this.genAI = geminiApiKey ? new GoogleGenerativeAI(geminiApiKey) : null;
    this.model = model;
    this.agents = new Map();
    this.globalTools = new Map();

    if (!geminiApiKey) {
      console.warn('⚠️  GEMINI_API_KEY not set — agents will only work in mock mode');
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

  /**
   * Run an agent on a task — Gemini function calling loop
   */
  async run(agentName, userMessage, context = {}) {
    const agent = this.agents.get(agentName);
    if (!agent) throw new Error(`Agent "${agentName}" not registered`);

    if (!this.genAI) {
      console.log(`  🤖 [${agentName}] MOCK MODE — would process: "${userMessage.slice(0, 80)}..."`);
      return {
        agent: agentName,
        response: `[MOCK] Agent "${agentName}" received the task but GEMINI_API_KEY is not set.`,
        artifacts: [],
        iterations: 0,
      };
    }

    // Build Gemini tool declarations
    const toolDeclarations = this._buildGeminiTools(agent);
    
    // Create Gemini model with tools
    const generativeModel = this.genAI.getGenerativeModel({
      model: this.model,
      systemInstruction: agent.systemPrompt,
      tools: toolDeclarations.length > 0 ? [{ functionDeclarations: toolDeclarations }] : undefined,
    });

    // Start chat
    const chat = generativeModel.startChat({
      history: this._convertHistory(context.history || []),
    });

    const maxIterations = context.maxIterations || 10;
    let iteration = 0;
    let finalResponse = null;
    const artifacts = [];

    // Send initial message
    let response = await chat.sendMessage(userMessage);

    while (iteration < maxIterations) {
      iteration++;

      const candidate = response.response.candidates?.[0];
      if (!candidate) {
        finalResponse = 'No response from model.';
        break;
      }

      const parts = candidate.content?.parts || [];
      
      // Check for function calls
      const functionCalls = parts.filter(p => p.functionCall);
      
      if (functionCalls.length === 0) {
        // No function calls — extract text response
        finalResponse = parts.map(p => p.text || '').join('').trim();
        break;
      }

      // Execute all function calls
      const functionResponses = [];

      for (const part of functionCalls) {
        const { name: fnName, args } = part.functionCall;
        
        console.log(`  🔧 [${agentName}] calling ${fnName}(${JSON.stringify(args).slice(0, 120)}...)`);

        let result;
        try {
          result = await this._executeTool(agent, fnName, args, context);
        } catch (err) {
          result = `ERROR: ${err.message}`;
          console.error(`  ❌ Tool error: ${err.message}`);
        }

        // Track artifacts
        if (result && typeof result === 'object' && result.__artifact) {
          artifacts.push(result.__artifact);
          result = result.message || 'Artifact created successfully.';
        }

        const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

        functionResponses.push({
          functionResponse: {
            name: fnName,
            response: { content: resultStr },
          },
        });
      }

      // Send function results back to Gemini
      try {
        response = await chat.sendMessage(functionResponses);
      } catch (err) {
        console.error(`  ❌ [${agentName}] Gemini error:`, err.message);
        finalResponse = `Agent encountered an error: ${err.message}`;
        break;
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
    };
  }

  async _executeTool(agent, fnName, args, context) {
    // 1. Agent-local tools
    if (agent.tools.has(fnName)) {
      return await agent.tools.get(fnName).fn(args, context);
    }

    // 2. Global tools
    if (this.globalTools.has(fnName)) {
      return await this.globalTools.get(fnName).fn(args, context);
    }

    // 3. Delegation
    if (fnName === 'delegate_to_agent') {
      return await this._handleDelegation(args, context);
    }

    throw new Error(`Unknown tool: ${fnName}`);
  }

  async _handleDelegation(args, context) {
    const { agent_name, task_description } = args;
    console.log(`  🔀 Delegating to "${agent_name}": ${task_description.slice(0, 80)}...`);
    const result = await this.run(agent_name, task_description, context);
    return result.response;
  }

  /**
   * Build Gemini-compatible function declarations from agent tools + global tools
   */
  _buildGeminiTools(agent) {
    const declarations = [];

    // Agent tools
    for (const [name, tool] of agent.tools) {
      declarations.push(this._toGeminiFunctionDeclaration(name, tool));
    }

    // Global tools
    for (const [name, { fn, schema }] of this.globalTools) {
      declarations.push({
        name,
        description: schema.description || name,
        parameters: this._cleanSchemaForGemini(schema.parameters || { type: 'OBJECT', properties: {} }),
      });
    }

    // Delegation tool
    const agentNames = Array.from(this.agents.keys());
    if (agentNames.length > 1) {
      declarations.push({
        name: 'delegate_to_agent',
        description: `Delegate a task to another specialist agent. Available: ${agentNames.join(', ')}`,
        parameters: {
          type: 'OBJECT',
          properties: {
            agent_name: {
              type: 'STRING',
              description: 'Name of the agent to delegate to',
            },
            task_description: {
              type: 'STRING',
              description: 'Clear description of the task',
            },
          },
          required: ['agent_name', 'task_description'],
        },
      });
    }

    return declarations;
  }

  _toGeminiFunctionDeclaration(name, tool) {
    return {
      name,
      description: tool.description || name,
      parameters: this._cleanSchemaForGemini(tool.parameters || { type: 'OBJECT', properties: {} }),
    };
  }

  /**
   * Convert JSON Schema types to Gemini's expected format (uppercase TYPE enums)
   */
  _cleanSchemaForGemini(schema) {
    if (!schema || typeof schema !== 'object') return { type: 'STRING' };

    const cleaned = { ...schema };

    // Convert type to uppercase
    if (cleaned.type) {
      cleaned.type = cleaned.type.toUpperCase();
    }

    // Clean properties recursively
    if (cleaned.properties) {
      const newProps = {};
      for (const [key, val] of Object.entries(cleaned.properties)) {
        newProps[key] = this._cleanSchemaForGemini(val);
      }
      cleaned.properties = newProps;
    }

    // Clean array items
    if (cleaned.items) {
      cleaned.items = this._cleanSchemaForGemini(cleaned.items);
    }

    // Remove unsupported fields
    delete cleaned.enum;
    delete cleaned.default;

    return cleaned;
  }

  /**
   * Convert OpenAI-style history to Gemini format
   */
  _convertHistory(history) {
    return history
      .filter(m => m.role !== 'system')
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      }));
  }
}

/**
 * Agent — A specialist with a personality, instructions, and tools.
 */
export class Agent {
  constructor({ name, systemPrompt, tools = [] }) {
    this.name = name;
    this.systemPrompt = systemPrompt;
    this.tools = new Map();

    for (const tool of tools) {
      this.tools.set(tool.name, tool);
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

/**
 * Tool — A callable function an agent can invoke.
 */
export class Tool {
  constructor({ name, description, parameters, fn }) {
    this.name = name;
    this.description = description;
    this.parameters = parameters;
    this.fn = fn;
  }
}
