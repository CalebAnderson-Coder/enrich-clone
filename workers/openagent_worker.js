import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { spawn } from 'child_process';
import path from 'path';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = (supabaseUrl && supabaseKey) ? createClient(supabaseUrl, supabaseKey) : null;

const CLAW_BIN = path.join(process.cwd(), 'claw-code', 'rust', 'target', 'debug', 'claw.exe');

async function processMission(mission) {
  if (!supabase) {
    console.error('❌ [Claw Worker] Supabase no está configurado (falta URL o Key).');
    return;
  }
  try {
    console.log(`\n[Claw Worker] Iniciando misión ${mission.id}`);
    console.log(`[Claw Worker] Instrucción: ${mission.instruction}`);
    
    // Marcar como IN_PROGRESS
    const { error: updateErr } = await supabase
      .from('agent_misions')
      .update({ status: 'IN_PROGRESS', updated_at: new Date().toISOString() })
      .eq('id', mission.id);

    if (updateErr) throw updateErr;

    const env = { ...process.env };
    
    // Si NO hay API key de OpenAI pero sí de Groq, inyectamos compatibilidad Groq
    if (!env.OPENAI_API_KEY && env.GROQ_API_KEY) {
      env.OPENAI_API_KEY = env.GROQ_API_KEY;
      env.OPENAI_BASE_URL = "https://api.groq.com/openai/v1";
      console.log(`[Claw Worker] Usando modelo de Groq como Engine.`);
    } else {
      console.log(`[Claw Worker] Usando el Engine nativo disponible en .env.`);
    }

    console.log(`[Claw Worker] Spawning: ${CLAW_BIN} prompt`);
    
    const child = spawn(CLAW_BIN, [
      'prompt', 
      mission.instruction || 'Analyze this system'
    ], {
      env,
      stdio: 'pipe',
      cwd: process.cwd()
    });

    let output = '';
    let errorOutput = '';

    child.stdout.on('data', (data) => {
      const chunk = data.toString();
      output += chunk;
      process.stdout.write(chunk);
    });

    child.stderr.on('data', (data) => {
      const chunk = data.toString();
      errorOutput += chunk;
      process.stderr.write(chunk);
    });

    child.on('close', async (code) => {
      console.log(`\n[Claw Worker] Misión ${mission.id} completada con código ${code}`);
      const finalStatus = code === 0 ? 'COMPLETED' : 'ERROR';
      
      const resultObj = {
        exitCode: code,
        stdout: output,
        stderr: errorOutput
      };

      await supabase
        .from('agent_misions')
        .update({ 
          status: finalStatus, 
          result: resultObj,
          updated_at: new Date().toISOString()
        })
        .eq('id', mission.id);
      
      console.log(`[Claw Worker] BD actualizada a ${finalStatus}.\n`);
    });

  } catch (error) {
    console.error(`[Claw Worker] Error al procesar la misión ${mission.id}:`, error);
    await supabase
      .from('agent_misions')
      .update({ 
        status: 'ERROR', 
        result: { error: error.message }, 
        updated_at: new Date().toISOString() 
      })
      .eq('id', mission.id);
  }
}

async function startPolling() {
  console.log('🤖 [Claw Worker] Iniciando polling a agent_misions (cada 15s)...');
  
  setInterval(async () => {
    try {
      if (!supabase) return;
      const { data: missions, error } = await supabase
        .from('agent_misions')
        .select('*')
        .eq('status', 'PENDING')
        .order('created_at', { ascending: true })
        .limit(1);

      if (error) {
        console.error('[Claw Worker] Error haciendo polling:', error.message);
        return;
      }

      if (missions && missions.length > 0) {
        console.log(`\n[Claw Worker] 🚀 Nueva misión detectada (Pillada ${missions.length} fila).`);
        await processMission(missions[0]);
      }
    } catch (e) {
      console.error('[Claw Worker] Exception in poller:', e);
    }
  }, 15000);
}

// Iniciar automáticamente si se corre este archivo
if (process.argv[1].endsWith('openagent_worker.js')) {
    startPolling();
}

export { processMission, startPolling };
