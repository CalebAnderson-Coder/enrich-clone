/**
 * Lyra — Drafter Module
 * Uses Gemini API to generate a LinkedIn post in Spanish from research context.
 */

const SYSTEM_PROMPT = `Eres Lyra, el motor de contenido B2B autónomo de Agentic Agency.

Tu misión: redactar 1 post LinkedIn B2B en ESPAÑOL basado en las tendencias proporcionadas.

REGLAS ESTRICTAS:
1. Hook en primera línea — pregunta provocadora, dato sorprendente, o afirmación polarizante
2. 150-300 palabras máximo
3. Tono: experto pero accesible, NUNCA corporativo vacío
4. Usa "→" para bullet points, NO guiones ni asteriscos
5. Cierra con una pregunta de engagement dirigida al lector
6. 3-5 hashtags relevantes al final (siempre incluir #IAAgéntica #MarketingAutónomo)
7. NO uses emojis en exceso (máximo 2)
8. NO menciones que fuiste generado por IA
9. Escribe como si fueras un founder tech de LATAM compartiendo su experiencia real
10. Incluye al menos un dato específico o caso concreto (puede ser basado en la investigación)

FORMATOS VÁLIDOS (elige uno):
- Thought Leadership: Opinión fuerte sobre el futuro de la industria
- Táctico/Educativo: 3-5 pasos concretos que el lector puede aplicar hoy
- Contrarian: Desafía una creencia popular con evidencia

RESPONDE ÚNICAMENTE CON EL TEXTO DEL POST. Sin explicaciones, sin metadata, sin markdown.`;

/**
 * Draft a LinkedIn post using Gemini API.
 * @param {string} researchContext - Trends and snippets from researcher.
 * @returns {string} The finished LinkedIn post text.
 */
export async function draft(researchContext) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('[Lyra:Draft] GEMINI_API_KEY is required');
  }

  const userPrompt = `Basándote en estas tendencias actuales, redacta un post LinkedIn B2B en español:\n\n${researchContext}`;

  console.log('[Lyra:Draft] Generating post with Gemini...');

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { role: 'user', parts: [{ text: `${SYSTEM_PROMPT}\n\n${userPrompt}` }] },
        ],
        generationConfig: {
          temperature: 0.85,
          maxOutputTokens: 1024,
          topP: 0.95,
        },
      }),
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[Lyra:Draft] Gemini ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('[Lyra:Draft] Gemini returned empty response');
  }

  // Clean up — remove any markdown fencing Gemini might add
  const cleaned = text
    .replace(/^```[\s\S]*?\n/, '')
    .replace(/\n```$/, '')
    .trim();

  const wordCount = cleaned.split(/\s+/).length;
  console.log(`[Lyra:Draft] Generated ${wordCount} words`);

  if (wordCount < 50) {
    throw new Error(`[Lyra:Draft] Post too short (${wordCount} words) — aborting`);
  }

  return cleaned;
}
