import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MISSIONS_FILE = path.join(__dirname, 'missions.json');

async function injectMission() {
    console.log("Inyectando Misión de Prueba usando JSON local...");
    
    let missions = [];
    if (fs.existsSync(MISSIONS_FILE)) {
        missions = JSON.parse(fs.readFileSync(MISSIONS_FILE, 'utf-8'));
    }

    const newMission = {
        id: "mission-" + Math.random().toString(36).substr(2, 9),
        type: 'BROWSER_SCRAPE',
        instruction: 'https://news.ycombinator.com/',
        payload: { priority: 'high' },
        status: 'PENDING',
        created_at: new Date().toISOString()
    };

    missions.push(newMission);
    fs.writeFileSync(MISSIONS_FILE, JSON.stringify(missions, null, 2));

    console.log("✅ Misión inyectada exitosamente con ID:", newMission.id);
    console.log("El Daemon local la ejecutará en breve.");
}

injectMission();
