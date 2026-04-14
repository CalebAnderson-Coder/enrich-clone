import { runtime } from '../index.js';

async function launchFleet() {
  console.log('🚀 Launching the Grand Fleet Mission: 35 Leads + Full Cascade...');
  
  const missionPrompt = `MISSION: EXTREME AUTOMATION LAUNCH
Target: 35 Roofing leads in Miami, FL.

TASKS:
1. Delega a 'scout' para encontrar 35 leads bilingües de Roofing en Miami y guardarlos en la DB. 
2. IMPORTANTE: Una vez guardados, delega SECUENCIALMENTE el enriquecimiento para cada uno de los mejores (HOT/WARM):
   - Helena, Sam, Kai para Auditoría Técnica.
   - Carlos para Attack Angle.
   - Angela para Email/WhatsApp Draft.
3. Devuélveme un reporte de cuántos leads se encontraron y cuántos drafts están listos.`;

  try {
    const result = await runtime.run('Manager', missionPrompt, {
      currentAgent: 'Manager',
      maxIterations: 50 // High iterations for long sequence
    });
    
    console.log('✅ Mission Result:', result.response);
  } catch (err) {
    console.error('❌ Mission Failed:', err);
  }
}

launchFleet();
