import { ApifyClient } from 'apify-client';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MISSIONS_FILE = path.join(__dirname, 'missions.json');

const apify = new ApifyClient({ token: process.env.APIFY_API_TOKEN });

const POLLING_INTERVAL_MS = 5000;

console.log("==========================================");
console.log("🧠 Cerebro Orquestador NATIVO Iniciado...");
console.log(`📡 Conectado a Cola: ${MISSIONS_FILE}`);
console.log(`🕷️  Conectado a Manos: Apify Client Activo`);
console.log("==========================================");

async function processMissions() {
    try {
        if (!fs.existsSync(MISSIONS_FILE)) return;
        
        let missions = JSON.parse(fs.readFileSync(MISSIONS_FILE, 'utf-8'));
        const pendingIndex = missions.findIndex(m => m.status === 'PENDING');
        
        if (pendingIndex === -1) return;

        const mission = missions[pendingIndex];
        console.log(`\n========================================`);
        console.log(`🎯 MISIÓN RECLAMADA: ${mission.id}`);
        console.log(`📋 TIPO: ${mission.type}`);
        console.log(`📜 INSTR: ${mission.instruction}`);

        // Marcar como "IN_PROGRESS"
        missions[pendingIndex].status = 'IN_PROGRESS';
        fs.writeFileSync(MISSIONS_FILE, JSON.stringify(missions, null, 2));

        let finalResult = null;

        if (mission.type === 'BROWSER_SCRAPE') {
            console.log(`🌐 Desplegando a las Manos de Apify para Scrape...`);
            
            const run = await apify.actor('apify/rag-web-browser').call({
                query: mission.instruction.replace("Navigate to ", "").trim(),
                maxResults: 1
            });

            const { items } = await apify.dataset(run.defaultDatasetId).listItems();
            finalResult = {
                success: true,
                extracted_data: items.length > 0 ? items[0] : null,
                apify_run_id: run.id
            };
        } else {
            console.log(`⚠️ Tipo de misión no soportada nativamente aún. Saltando...`);
            finalResult = { success: false, error: "Type not implemented" };
        }

        console.log(`✅ Result Obtenido.`);
        if (finalResult.success && finalResult.extracted_data) {
            console.log(`📝 Extracto de texto:\n`, finalResult.extracted_data.text?.substring(0, 200), "...");
        }

        // Marcar como completada
        missions = JSON.parse(fs.readFileSync(MISSIONS_FILE, 'utf-8')); // recargar por si cambió
        const updateIndex = missions.findIndex(m => m.id === mission.id);
        if (updateIndex !== -1) {
            missions[updateIndex].status = finalResult.success ? 'COMPLETED' : 'FAILED';
            missions[updateIndex].result = finalResult;
            missions[updateIndex].updated_at = new Date().toISOString();
            fs.writeFileSync(MISSIONS_FILE, JSON.stringify(missions, null, 2));
        }

        console.log(`🏁 Misión Terminada. Volviendo a descansar.`);
        console.log(`========================================`);
        
        // Autoterminar para la demostración
        console.log("👋 Demostración completada. Apagando daemon...");
        process.exit(0);

    } catch (e) {
        console.error(`💥 Excepción fatal procesando misión:`, e);
    }
}

setInterval(processMissions, POLLING_INTERVAL_MS);
processMissions();
