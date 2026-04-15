/**
 * El "Ralph Loop" - Bucle iterativo de auto-corrección (Oh-My-Philosophy)
 * Interroga al agente, extrea JSON y lo valida usando Zod.
 * Si falla, alimenta el error devuelta al agente para que lo corrija.
 */
export async function executeWithRalphLoop(runtime, agentName, prompt, zodSchema, context = {}) {
    let currentAttempt = 1;
    const maxRetries = context.maxIterations || 3;
    let currentPrompt = prompt;

    // Se asegura de que el prompt entienda que DEBE devolver JSON puro.
    currentPrompt += `\n\nIMPORTANTE (Zod Contract): Tu respuesta DEBE ser ÚNICAMENTE un objeto JSON puro (si quieres, dentro de un bloque \`\`\`json). Debe coincidir estructuralmente con este esquema, o fallará catastróficamente:\n${Object.keys(zodSchema.shape).join(', ')}`;

    while (currentAttempt <= maxRetries) {
        console.log(`\n⚙️ [Ralph Loop] Validando Agente: ${agentName} (Intento ${currentAttempt}/${maxRetries})...`);
        try {
            const result = await runtime.run(agentName, currentPrompt, context);
            const responseText = result.response;

            let parsedJson = null;

            // 1. Try to extract from ```json ... ``` fenced block first
            const fencedMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
            if (fencedMatch) {
                try {
                    parsedJson = JSON.parse(fencedMatch[1]);
                } catch (e) {
                    // fenced block wasn't valid JSON, fall through to balance-walker
                }
            }

            // 2. Fallback: balance-walk the string to find the outermost { ... }
            if (!parsedJson) {
                parsedJson = extractOutermostJson(responseText);
            }

            if (!parsedJson) {
                throw new Error("No se detectó un formato JSON válido en la respuesta del agente.");
            }

            // Aquí sucede la magia: si falla la validación tira una excepción "ZodError"
            const validatedData = zodSchema.parse(parsedJson);
            
            console.log(`✅ [Ralph Loop] Estructura JSON validada con éxito.`);
            return {
                data: validatedData,
                rawResponse: responseText,
                isValid: true
            };

        } catch (error) {
            console.error(`⚠️ [Ralph Loop] Falló la validación Zod en el intento ${currentAttempt}:`);
            console.error(error.message);
            
            if (currentAttempt === maxRetries) {
                console.error(`🚨 [Halt Protocol] Se agotaron los intentos de auto-corrección para ${agentName}.`);
                return {
                    isValid: false,
                    error: error.message
                };
            }

            // Retroalimenta el error al modelo
            currentPrompt = `Aviso del Sistema (Ralph Loop): Tu intento anterior falló la validación del esquema con el siguiente error:\n${error.message}\n\nPor favor, corrige el JSON y devuélvelo de nuevo. ESTRICTAMENTE SÓLO EL JSON QUE PASE LA VALIDACIÓN.`;
            currentAttempt++;
        }
    }
}

/**
 * Walks a string character-by-character to find and extract the outermost
 * complete JSON object. This correctly handles deeply nested objects where
 * a greedy/non-greedy regex would fail (the original bug).
 * @param {string} text
 * @returns {object|null}
 */
function extractOutermostJson(text) {
    const start = text.indexOf('{');
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = start; i < text.length; i++) {
        const ch = text[i];

        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;

        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) {
                try {
                    return JSON.parse(text.slice(start, i + 1));
                } catch {
                    return null;
                }
            }
        }
    }
    return null;
}
