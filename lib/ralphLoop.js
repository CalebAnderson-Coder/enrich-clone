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

            let parsedJson = {};
            // Intenta extraer el JSON usando regex por si el modelo incluyó texto antes/después
            const jsonMatch = responseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
            if (jsonMatch) {
                parsedJson = JSON.parse(jsonMatch[1]);
            } else {
                const fallbackMatch = responseText.match(/\{[\s\S]*?\}/);
                if (fallbackMatch) {
                    parsedJson = JSON.parse(fallbackMatch[0]);
                } else {
                    throw new Error("No se detectó un formato JSON válido en la respuesta del agente.");
                }
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
