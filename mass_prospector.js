import fs from 'fs';
import { exec } from 'child_process';
import util from 'util';

const execPromise = util.promisify(exec);

// ═══════════════════════════════════════════════════════════
// THE MACHINE v2 — Mass Prospector for 50 Leads
// Runs the full 7-agent pipeline for each niche × city combo
// Pipeline: Manager → Scout → Helena → Sam → Kai → Carlos → Angela
// Output: Leads appear as DRAFT in dashboard for client approval
// ═══════════════════════════════════════════════════════════

const STATE_FILE = './prospector_state.json';

// 10 niches × 5 cities = 50 unique search combinations
const CITIES = [
    "Orlando, FL",
    "Miami, FL",
    "Houston, TX",
    "Dallas, TX",
    "San Antonio, TX",
];

// Niche IDs from niches.json — top demand sectors
const TARGET_NICHES = [
    8,  // Landscaping
    9,  // Roofing
    4,  // HVAC
    2,  // Remodeling
    5,  // Plumbing
    6,  // Electrical
    1,  // General Construction
    10, // Painting
    17, // Pressure Washing
    7,  // Maid services / Cleaning
];

const SLEEP_BETWEEN_CAMPAIGNS_MS = 45000; // 45 sec to respect rate limits
const MAX_LEADS = 50;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function loadState() {
    if (fs.existsSync(STATE_FILE)) {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
    return { completed: [], failedCount: 0 };
}

function saveState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function startMassProspector() {
    console.log("╔══════════════════════════════════════════════╗");
    console.log("║  🤖 THE MACHINE v2 — Mass Prospector (50)   ║");
    console.log("║  Pipeline: Manager→Scout→Helena→Sam→Kai→    ║");
    console.log("║            Carlos→Angela                    ║");
    console.log("║  Output: DRAFT leads for client approval    ║");
    console.log("╚══════════════════════════════════════════════╝");
    
    let state = loadState();
    let leadsGenerated = state.completed.length;
    let consecutiveFailures = 0;
    const MAX_CONSECUTIVE_FAILURES = 5;
    
    console.log(`\n📊 Estado: ${leadsGenerated} leads ya completados de ${MAX_LEADS} target`);
    
    for (const nicheId of TARGET_NICHES) {
        for (const city of CITIES) {
            // Check if we've hit our target
            if (leadsGenerated >= MAX_LEADS) {
                console.log(`\n🎯 ¡Meta alcanzada! ${leadsGenerated}/${MAX_LEADS} leads generados.`);
                printSummary(state);
                return;
            }
            
            // Check consecutive failures
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                console.log(`\n🛑 Demasiados fallos consecutivos (${consecutiveFailures}). Pausando 3 minutos...`);
                await sleep(180000);
                consecutiveFailures = 0;
            }

            const taskId = `${nicheId}-${city}`;
            
            if (state.completed.includes(taskId)) {
                console.log(`⏭️ Saltando ${taskId} (ya completado)`);
                continue;
            }

            // Load niche name for display
            const niches = JSON.parse(fs.readFileSync('./niches.json', 'utf8'));
            const niche = niches.find(n => n.id === nicheId);

            console.log(`\n${'═'.repeat(60)}`);
            console.log(`🎯 [${leadsGenerated + 1}/${MAX_LEADS}] ${niche?.en || nicheId} en ${city}`);
            console.log(`${'═'.repeat(60)}`);
            
            try {
                const { stdout, stderr } = await execPromise(
                    `node run_full_campaign.js ${nicheId} "${city}"`,
                    { timeout: 300000 } // 5 min timeout per lead
                );
                console.log(stdout.slice(-500)); // Last 500 chars of output
                if (stderr) console.error("⚠️ stderr:", stderr.slice(-200));

                console.log(`✅ Lead ${taskId} procesado exitosamente.`);
                leadsGenerated++;
                consecutiveFailures = 0;
                
                // Save state
                state.completed.push(taskId);
                saveState(state);

                console.log(`📊 Progreso: ${leadsGenerated}/${MAX_LEADS} (${Math.round(leadsGenerated/MAX_LEADS*100)}%)`);
                console.log(`⏳ Enfriando ${SLEEP_BETWEEN_CAMPAIGNS_MS / 1000}s...`);
                await sleep(SLEEP_BETWEEN_CAMPAIGNS_MS);
                
            } catch (error) {
                consecutiveFailures++;
                state.failedCount = (state.failedCount || 0) + 1;
                saveState(state);
                
                console.error(`❌ Error en ${taskId}: ${error.message?.slice(0, 200)}`);
                console.log(`⏳ Enfriando después de error...`);
                await sleep(SLEEP_BETWEEN_CAMPAIGNS_MS);
            }
        }
    }
    
    printSummary(state);
}

function printSummary(state) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🏁 THE MACHINE v2 — RESUMEN FINAL`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`✅ Leads generados: ${state.completed.length}`);
    console.log(`❌ Fallos totales: ${state.failedCount || 0}`);
    console.log(`📋 Los leads están como DRAFT en el dashboard`);
    console.log(`👉 El cliente puede aprobar cada uno individualmente`);
    console.log(`${'═'.repeat(60)}`);
}

startMassProspector();
