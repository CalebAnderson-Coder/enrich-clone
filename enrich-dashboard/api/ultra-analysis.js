import { GoogleGenerativeAI } from '@google/generative-ai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { leadDetails, existingAnalysis } = req.body;

  if (!leadDetails || !leadDetails.business_name) {
    return res.status(400).json({ error: 'Faltan detalles de prospecto' });
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const prompt = `
Eres un genial estratega de ventas B2B y Growth Hacker experto en Ads.
He prospectado al siguiente negocio local:

Nombre: ${leadDetails.business_name}
Industria: ${leadDetails.industry || 'Servicios Varios'}
Puntaje de precisión: ${leadDetails.qualification_score}/100
Rating: ${leadDetails.rating || 'N/A'} con ${leadDetails.review_count || 0} reseñas.
${existingAnalysis ? `Análisis previo del negocio: ${existingAnalysis}` : ''}

Tu cliente (la agencia dueña del dashboard) quiere acercarse a este lead. Para facilitar el cierre de la venta, genera un Ultra Análisis que sea útil tanto para el vendedor como para enamorar al prospecto si se lo enviáramos de regalo como excusa de contacto.

Provee ÚNICAMENTE la respuesta usando este formato de JSON estricto (no añadas bloques de código markdown, sólo el objeto puro JSON):
{
  "executive_summary": "Un párrafo impactante sobre su oportunidad de mercado.",
  "creative_ad_1": {
    "hook": "Un título gancho brutal para un anuncio de Facebook o Instagram Ads",
    "copy": "El cuerpo del texto persuasivo del anuncio",
    "visual_concept": "Descripción de qué debe ir en el video o imagen"
  },
  "creative_ad_2": {
    "hook": "Un título alternativo enfocado en urgencia o prueba social",
    "copy": "El cuerpo del texto del anuncio",
    "visual_concept": "Descripción visual de la pauta"
  },
  "pitch_angle": "Cómo debería nuestro asesor empezar la conversación por WhatsApp / Email (1-2 frases super ganadoras)."
}

DEBE ESTAR 100% EN ESPAÑOL. LA RESPUESTA DEBE SER ÚNICAMENTE EL JSON. No uses bloques \`\`\`.
`;

    const result = await model.generateContent(prompt);
    let output = result.response.text();

    // Eliminar posibles bloques de código que la IA añade por terquedad
    output = output.replace(/```json/gi, '').replace(/```/g, '').trim();
    
    // Checkear y parsear
    let parsedData = {};
    try {
      parsedData = JSON.parse(output);
    } catch (parseError) {
      // Fallback intentando cazar el objeto JSON interno
      const match = output.match(/\{[\s\S]*?\}/);
      if (match) {
        parsedData = JSON.parse(match[0]);
      } else {
        throw new Error("Could not parse JSON from Gemini response");
      }
    }

    return res.status(200).json(parsedData);
  } catch (error) {
    console.error("Error generating ultra analysis:", error);
    return res.status(500).json({ error: 'Error del servidor procesando a la IA.', details: error.message });
  }
}
