

async function launchCampaign() {
  console.log("🚀 Iniciando el Despliegue de Campaña con todos los Agentes...");
  const url = "http://localhost:3001/api/dispatch";
  const payload = {
    agent: "Manager",
    brandId: "eca1d833-77e3-4690-8cf1-2a44db20dcf8",
    task: `Inicia AHORA MISMO la nueva campaña para la agencia. Tu brandId es: eca1d833-77e3-4690-8cf1-2a44db20dcf8. Asigna tareas específicas y solicita ejecución rápida a todos los agentes de tu equipo: Scout (prospección de empresas de remodelación), Angela (escribe los primeros correos fríos para estas empresas), Helena (crea posts de Instagram de "antes y después" de remodelación), Sam (crea diseños para el post), Kai (crea landing pages para remodelaciones), y Carlos Empirika (escribe la estrategia de ventas). No pidas más IDs, usa este brandId y CREA los jobs usando la herramienta create_marketing_job para cada uno. ¡Actúa en este instante y dame el reporte de acción!`
  };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    const data = await res.json();
    console.log("\n==================================");
    console.log("✅ RESPUESTA DEL MANAGER: ");
    console.log("==================================\n");
    console.log(data.response);
  } catch (error) {
    console.error("❌ Error al lanzar la campaña:", error.message);
  }
}

launchCampaign();
