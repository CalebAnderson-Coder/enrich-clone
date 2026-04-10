/**
 * process_stitch_queue.js
 * 
 * Procesa la cola de Stitch generada por DaVinci.
 * Para cada archivo .json en output/stitch_queue/:
 * 1. Crea el proyecto en Stitch via MCP
 * 2. Genera la pantalla (landing)
 * 3. Descarga el screenshot como imagen local
 * 4. Actualiza el archivo con el path de la imagen final
 * 
 * Uso: Este script es ejecutado por Antigravity via MCP tools,
 *       no directamente por Node.js (Stitch es solo MCP).
 * 
 * Para uso manual:
 *   1. Lee el .json de la cola
 *   2. Ejecuta mcp_stitch_create_project con el title
 *   3. Ejecuta mcp_stitch_generate_screen_from_text con el prompt
 *   4. Descarga el screenshot URL a output/magnets/
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QUEUE_DIR = path.join(__dirname, '..', 'output', 'stitch_queue');
const MAGNETS_DIR = path.join(__dirname, '..', 'output', 'magnets');

async function downloadScreenshot(url, filename) {
  if (!fs.existsSync(MAGNETS_DIR)) {
    fs.mkdirSync(MAGNETS_DIR, { recursive: true });
  }
  
  const filePath = path.join(MAGNETS_DIR, filename);
  
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filePath, buffer);
    console.log(`📸 Screenshot guardado: ${filePath}`);
    return filePath;
  } catch (err) {
    console.error(`❌ Error descargando screenshot: ${err.message}`);
    return null;
  }
}

async function processQueue() {
  if (!fs.existsSync(QUEUE_DIR)) {
    console.log('📭 No hay cola de Stitch pendiente.');
    return;
  }

  const files = fs.readdirSync(QUEUE_DIR).filter(f => f.endsWith('.json'));
  
  if (files.length === 0) {
    console.log('📭 Cola vacía.');
    return;
  }

  console.log(`📋 Procesando ${files.length} landing(s) en cola...\n`);

  for (const file of files) {
    const filePath = path.join(QUEUE_DIR, file);
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    
    if (data.status === 'COMPLETED') {
      console.log(`⏭️ ${data.businessName} ya procesado. Saltando.`);
      continue;
    }

    console.log(`🏗️ Procesando: ${data.businessName}`);
    console.log(`   Prompt: ${data.prompt.substring(0, 100)}...`);
    console.log(`\n   ⚠️ Ejecutar manualmente via MCP:`);
    console.log(`   Step 1: ${data.mcpInstructions.step1}`);
    console.log(`   Step 2: ${data.mcpInstructions.step2}`);
    console.log(`   Step 3: Descargar screenshot URL a output/magnets/\n`);
  }
}

// Si se proporciona un screenshot URL como argumento, descargarlo
const args = process.argv.slice(2);
if (args[0] === '--download' && args[1] && args[2]) {
  const url = args[1];
  const filename = args[2];
  await downloadScreenshot(url, filename);
} else {
  await processQueue();
}
