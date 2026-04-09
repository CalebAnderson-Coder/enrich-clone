import fs from 'fs';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

// Config
const STATE_FILE = './prospector_state.json';
const CITIES = [
    "Orlando, FL",
    "Miami, FL",
    "Houston, TX",
    "San Antonio, TX",
    "Los Angeles, CA"
];
const TARGET_NICHES = [4, 9, 8]; // Example: 4 HVAC, 9 Roofing, 8 Plumbing

const SLEEP_BETWEEN_CAMPAIGNS_MS = 60000; // 60 seconds to respect LLM / API rate limits

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
    return { completed: [] };
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function startMassProspector() {
    console.log("🤖 Iniciando The Machine: Mass Prospector 🤖");
    
    let state = loadState();
    
    for (const city of CITIES) {
        for (const nicheId of TARGET_NICHES) {
            const taskId = `${nicheId}-${city}`;
            
            if (state.completed.includes(taskId)) {
                console.log(`⏭️ Saltando ${taskId} (Ya completado previamente)`);
                continue;
            }

            console.log(`\n========================================`);
            console.log(`🎯 Ejecutando campaña para Nicho ID: ${nicheId} en ${city}`);
            console.log(`========================================`);
            
            try {
                // Execute the child process
                const { stdout, stderr } = await execPromise(`node run_full_campaign.js ${nicheId} "${city}"`);
                console.log(stdout);
                if (stderr) console.error("⚠️ Advertencias:", stderr);

                console.log(`✅ Campaña ${taskId} terminada exitosamente.`);
                
                // Save state to avoid re-running
                state.completed.push(taskId);
                saveState(state);

                console.log(`⏳ Esperando ${SLEEP_BETWEEN_CAMPAIGNS_MS / 1000} segundos para enfriar los Rate Limits...`);
                await sleep(SLEEP_BETWEEN_CAMPAIGNS_MS);
                
            } catch (error) {
                console.error(`❌ Error fatal en ${taskId}:`, error.message);
                console.log("Intentaremos continuar con el siguiente después del enfriamiento...");
                await sleep(SLEEP_BETWEEN_CAMPAIGNS_MS); // Sleep anyway to recover rate limit
            }
        }
    }
    
    console.log("\n🎉 The Machine ha terminado su cola de tareas.");
}

startMassProspector();
