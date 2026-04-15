// ============================================================
// agents/manager-daemon.js — Loop 24/7 autónomo del Manager
// Ejecuta ciclos de prospección, revisión, despacho y reporte
// en horas fijas sin intervención humana.
// ============================================================

import { manager } from './manager.js';

const CICLOS = [
  {
    horas: [8],
    nombre: 'PROSPECCION_MANANA',
    tarea: 'Ciclo autónomo: pide a Scout 10 leads HOT nuevos priorizando los nichos con mejor historial en memoria. Para cada HOT, pide a Carlos el attack_angle. Guarda resumen con tag [CICLO_MANANA].'
  },
  {
    horas: [12],
    nombre: 'REVISION_MEDIODIA',
    tarea: 'Ciclo autónomo: revisa leads de [CICLO_MANANA] sin outreach. Pide a Angela mensajes para los top 3 HOT pendientes. Guarda estado con tag [CICLO_MEDIODIA].'
  },
  {
    horas: [18],
    nombre: 'DESPACHO_TARDE',
    tarea: 'Ciclo autónomo: despacha mensajes listos de [CICLO_MEDIODIA] con Sam. Registra cuántos salieron y a qué canales. Guarda con tag [CICLO_TARDE].'
  },
  {
    horas: [23],
    nombre: 'REPORTE_NOCTURNO',
    tarea: 'Ciclo de aprendizaje: analiza todos los tags del día. ¿Qué nicho tuvo más HOT? ¿Qué agente tuvo más errores? ¿Qué ciudad fue más productiva? Guarda 3 lecciones con tag [LECCIONES_DIA]: 1) qué priorizar mañana, 2) qué evitar, 3) ajuste de comportamiento para algún agente.'
  },
];

const enEjecucion = new Set();

async function ejecutarCiclo(ciclo) {
  if (enEjecucion.has(ciclo.nombre)) return;
  enEjecucion.add(ciclo.nombre);
  console.log(`[Daemon] 🚀 ${ciclo.nombre} — ${new Date().toISOString()}`);
  try {
    await manager.chat(ciclo.tarea);
    console.log(`[Daemon] ✅ ${ciclo.nombre} completado`);
  } catch (err) {
    console.error(`[Daemon] ❌ ${ciclo.nombre} error:`, err.message);
  } finally {
    enEjecucion.delete(ciclo.nombre);
  }
}

function tick() {
  const hora = new Date().getHours();
  CICLOS.filter(c => c.horas.includes(hora)).forEach(ejecutarCiclo);
}

export function startManagerDaemon() {
  console.log('[Daemon] 🤖 Arrancando — ciclos: 8h, 12h, 18h, 23h');
  tick();
  setInterval(tick, 60 * 60 * 1000);
}
