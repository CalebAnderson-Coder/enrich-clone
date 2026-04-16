import { AgentRuntime } from './lib/AgentRuntime.js';
import { angela } from './agents/angela.js';
import { helena } from './agents/helena.js';
import { sam } from './agents/sam.js';
import { kai } from './agents/kai.js';
import { manager } from './agents/manager.js';
import { scout } from './agents/scout.js';
import { carlos } from './agents/carlos.js';
import { davinci } from './agents/davinci.js';
import dotenv from 'dotenv';

dotenv.config();

if (!process.env.NVIDIA_API_KEY) {
  console.error('❌ FATAL: NVIDIA_API_KEY is not set. Configure it in your .env file.');
  process.exit(1);
}

const runtime = new AgentRuntime({
  apiKey: process.env.NVIDIA_API_KEY,
  model: 'meta/llama-3.1-70b-instruct',
  baseURL: 'https://integrate.api.nvidia.com/v1'
});

const agents = [manager, scout, angela, helena, sam, kai, carlos, davinci];
agents.forEach(a => runtime.registerAgent(a));

async function runTest() {
  console.log('🧪 Starting API Verification against NVIDIA NIM LLaMA 3.1 70B...');
  
  for (const agent of agents) {
    console.log(`\n===========================================`);
    console.log(`🤖 Testing Agent: ${agent.name}`);
    console.log(`===========================================`);
    try {
      const result = await runtime.run(
        agent.name, 
        "Hello! Please briefly introduce your role in Spanish using only 1 short sentence. DO NOT use any tools, just say hi."
      );
      console.log(`✅ [${agent.name}] RESPONSE:`);
      console.log(result.response);
      console.log(`🔄 Iterations inside loop: ${result.iterations}`);
    } catch (err) {
      console.error(`❌ ERROR testing ${agent.name}:`, err.message);
    }
  }
  process.exit(0);
}

runTest();
