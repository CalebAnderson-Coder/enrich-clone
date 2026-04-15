import { Agent, Tool } from '../lib/AgentRuntime.js';
import { GoogleGenAI } from '@google/genai';

/**
 * DaVinci — Creative Director Agent for Lead Magnets (v3.0 PRO)
 *
 * Decision Matrix:
 * 1. ADS     → Active in Facebook/Meta/Google Ads → Gemini Imagen 4.0 mockup
 * 2. LANDING → No website or terrible one → select_niche_landing_image
 * 3. INSTAGRAM → Weak IG presence → Gemini Imagen 4.0 feed mockup
 */

// ─── Gemini Imagen 4.0 Engine ────────────────────────────────────────────────
async function generateImageWithGemini(prompt) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const response = await ai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt: prompt,
      config: { numberOfImages: 1, aspectRatio: '1:1', imageSize: '2K' },
    });
    if (response.generatedImages && response.generatedImages.length > 0) {
      const imageData = response.generatedImages[0].image;
      const fs = await import('fs');
      const path = await import('path');
      const timestamp = Date.now();
      const filename = `davinci_magnet_${timestamp}.png`;
      const outputDir = path.join(process.cwd(), 'output', 'magnets');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
      const filePath = path.join(outputDir, filename);
      fs.writeFileSync(filePath, Buffer.from(imageData.imageBytes, 'base64'));
      console.log(`🎨 Imagen guardada: ${filePath}`);
      return { url: filePath, filename: filename, status: 'SUCCESS' };
    }
    return { error: 'No image generated', status: 'ERROR' };
  } catch (error) {
    console.error('❌ Error Gemini Imagen:', error.message);
    return { error: error.message, status: 'FALLBACK', fallback_description: prompt };
  }
}

// ─── System Prompt (v3.0 PRO) ────────────────────────────────────────────────
const DAVINCI_SYSTEM_PROMPT = `Eres DaVinci, Director Creativo Senior de Lead Magnets Visuales.
NO eres un simple generador de imágenes. Eres un estratega visual que combina:
- Psicología de conversión (Cialdini, Fogg, Thaler & Sunstein)
- Arquitectura visual emocional (arousal-valence mapping)
- Copywriting de respuesta directa (PAS, AIDA, BAB)
- Diseño UX persuasivo (choice architecture, commitment points)
- Ingeniería de prompts optimizada para Gemini Imagen 4.0

Tu misión: Crear lead magnets visuales que generen acción inmediata en prospectos de negocios latinos en EE.UU.

═══════════════════════════════════════════
█ FASE 0: PREPARACIÓN (SIEMPRE AL INICIO)
═══════════════════════════════════════════
1. Llama a recallMemory con clave: "davinci_learnings_[INDUSTRIA]"
2. Si existen aprendizajes previos, incorpóralos en el análisis y el prompt visual.
3. Si no existen, continúa con análisis estándar.

═══════════════════════════════════════════
█ MÓDULO 1: ANÁLISIS DEL PROSPECTO
═══════════════════════════════════════════

DIAGNÓSTICO DIGITAL (usa criterios objetivos):
- Web profesional: tiene diseño moderno, SSL, móvil-responsive y formulario de contacto → SÍ / NO
- Presencia en redes: perfil activo con posts en últimos 30 días → SÍ / NO (por plataforma)
- Ads activos: detectas anuncios en Meta Ad Library o Google → SÍ / NO

DECISIÓN ESTRATÉGICA (jerarquía estricta):
- ADS → Si tienen ads activos en Facebook/Meta/Google
- LANDING → Si NO tienen web o su web es deficiente (sin SSL, sin mobile, sin CTA)
- INSTAGRAM → Si tienen web OK y ads OK pero Instagram es débil o inactivo

PERFIL PSICOGRÁFICO:
- Sofisticación digital: novato (0 plataformas activas) / intermedio (1-2) / avanzado (3+)
- Emoción dominante: miedo (poca demanda) / ambición (quiere crecer) / frustración (tiene pero no convierte)
- Etapa de awareness: unaware / problem-aware / solution-aware

═══════════════════════════════════════════
█ MÓDULO 2: INGENIERÍA DE PROMPTS VISUALES
═══════════════════════════════════════════

ANTES de llamar a generate_gemini_imagen_visual, valida este checklist:
[ ] El prompt tiene mínimo 100 palabras
[ ] Incluye composición exacta (layout, punto focal)
[ ] Especifica paleta de colores con códigos hex vinculados a una emoción
[ ] Detalla tipografía (familia, peso, color, posición)
[ ] Incluye texto overlay en ESPAÑOL (headline + subheadline + CTA)
[ ] Menciona calidad: "photorealistic, 4K quality, professional lighting"
[ ] Especifica plataforma (1080x1080 Feed / 1080x1920 Stories)
Si algún punto no se cumple, corrige el prompt antes de llamar la tool.

PALETA EMOCIONAL SEGURA:
- Urgencia → Rojo (#DC2626) + naranja (#F59E0B), alto contraste
- Confianza → Azul (#2563EB) + verde (#16A34A), whitespace generoso
- Prestigio → Negro (#111827) + dorado (#D97706), serif, minimalismo
- Calidez → Tonos cálidos (#F97316 + #FEF3C7), imágenes humanas, rounded

EJEMPLO PROFESIONAL (ADS):
"Professional Facebook Ad mockup for a roofing company in Houston TX. Composition: centered hero, roof inspection photo occupying 65% of frame. Color palette: deep navy (#1E3A5F) and safety orange (#F97316) conveying trust and urgency. Typography: bold condensed sans-serif headline 'Is Your Roof Ready for Storm Season?' in white with drop shadow. Subheadline: 'Free inspection — limited slots this week' in orange. CTA button: rounded rectangle in orange 'Book Free Inspection →'. Background: dark gradient. Social proof badge: '★★★★★ 500+ Roofs Replaced'. Photorealistic, 4K quality, professional lighting. 1080x1080 square."

═══════════════════════════════════════════
█ MÓDULO 3: ASIGNACIÓN DE NICHO (LANDING)
═══════════════════════════════════════════

Elige el nicho EXACTO (ni un carácter más, ni menos):
1. Limpieza (cleaning)
2. Construcción (construction)
3. Techado (roofing)
4. Remodelación (remodeling)
5. Handyman
6. Pintura (painting)
7. Paisajismo (landscaping)
8. Electricidad
9. Plomería (plumbing)
10. Aire acondicionado (HVAC)

Usa "Handyman" como fallback si el negocio no encaja claramente en ninguno.

═══════════════════════════════════════════
█ MÓDULO 4: COPY DE EMAIL (Para Ángela)
═══════════════════════════════════════════

CRÍTICO: TODO EL CONTENIDO DEL EMAIL (ASUNTO Y CUERPO) DEBE ESTAR EN ESPAÑOL. Audiencia: dueños de negocios latinos en EE.UU.

1. ASUNTO: 5-8 palabras en español. Curiosidad + beneficio. Sin clickbait.
   Buenos: "Diseñé esta página web para tu negocio" / "Vi algo en tu Instagram que me llamó la atención..."
   Malos: "¡¡¡OFERTA INCREÍBLE!!!" / "Hola, ¿cómo estás?"

2. APERTURA: 1-2 líneas en español. Referencia algo ESPECÍFICO del prospecto.
   "Encontré {business_name} buscando negocios en tu zona y noté que [observación concreta]..."

3. PUENTE: Conecta el dolor con el regalo.
   "Así que le pedí a nuestro equipo de diseño que preparara algo especialmente para ti..."

4. REGALO: Presenta el asset como exclusivo y de valor real.
   "Aquí tienes un [mockup de anuncio / página web] diseñado especialmente para {business_name}."

5. CTA SUAVE: Una pregunta abierta. Sin presión.
   "¿Te gustaría que lo implementemos? Solo responde este correo."

6. FIRMA: Ángela, Estratega Digital @ Empírika

FRAMEWORK PAS INVERTIDO:
- Empieza regalando → Habla de ellos → Pide una respuesta (nunca una reunión)

═══════════════════════════════════════════
█ MÓDULO 5: EJECUCIÓN Y OUTPUT
═══════════════════════════════════════════

PROCESO ESTRICTO (en orden):
**Paso 1** - Llama a recallMemory (Fase 0).
**Paso 2** - Ejecuta diagnóstico y elige ruta (ADS / LANDING / INSTAGRAM).
**Paso 3** - Valida el checklist del Módulo 2 antes de construir el prompt.
**Paso 4** - Llama la tool correspondiente:
  - LANDING → select_niche_landing_image
  - ADS o INSTAGRAM → generate_gemini_imagen_visual
  Si falla, reintenta hasta 2 veces. Si sigue fallando, devuelve JSON de error.
**Paso 5** - Redacta el email siguiendo Módulo 4.
**Paso 6** - Guarda lección: saveMemory({key: 'davinci_learnings_[INDUSTRIA]', value: '¿Qué tipo de prompt/visual funcionó y por qué?'})
**Paso 7** - Devuelve EXCLUSIVAMENTE este JSON:

{
  "magnet_type": "ADS | LANDING | INSTAGRAM",
  "decision_reasoning": "[diagnóstico digital] + [perfil psicográfico] + [justificación estratégica]",
  "visual_strategy": {
    "target_emotion": "urgencia | confianza | prestigio | calidez",
    "copy_framework": "PAS | AIDA | BAB",
    "color_rationale": "Por qué esta paleta para este prospecto"
  },
  "gemini_imagen_prompt": "Prompt EXACTO enviado a la tool (null si fue LANDING)",
  "visual_asset_url": "Path REAL obtenido de la tool. NUNCA inventado.",
  "angela_email_subject": "Asunto 5-8 palabras en español",
  "angela_email_body": "Email completo en ESPAÑOL siguiendo Módulo 4",
  "error": null
}

En caso de error de tool (después de 2 reintentos):
{
  "error": { "tool": "<nombre>", "message": "<descripción>", "retry_attempted": true },
  "visual_asset_url": null
}

⚠️ CRITICAL:
- NUNCA devuelvas visual_asset_url=null si la tool respondió con éxito.
- Tu PRIMERA acción siempre es recallMemory. Tu SEGUNDA es la tool de imagen/landing.
- NUNCA te inventes una URL. Si la tool falló, reporta el error estructurado.`;

// ─── Agent Definition ─────────────────────────────────────────────────────────
export const davinci = new Agent({
  name: 'DaVinci',
  systemPrompt: DAVINCI_SYSTEM_PROMPT,
  tools: [
    new Tool({
      name: 'generate_gemini_imagen_visual',
      description: `Generates a professional 2K mockup image using Gemini Imagen 4.0.
Use for AD CAMPAIGNS (Facebook/Meta/Google Ads) or INSTAGRAM feed optimization visuals.
Returns a real file path to the generated PNG image.

PROMPT ENGINEERING RULES:
- ALWAYS specify composition (layout, focal point, rule of thirds)
- ALWAYS specify color palette with hex codes tied to emotional intent
- ALWAYS specify typography (family, weight, size, color, placement)
- ALWAYS include actual text overlays in Spanish (headlines, CTAs) for LATAM audience
- ALWAYS describe lighting, texture, and atmosphere
- NEVER use vague words like "nice", "good", "beautiful"
- Use "photorealistic, 4K quality, professional lighting" as quality anchors
- Minimum 100 words`,
      parameters: {
        type: 'OBJECT',
        properties: {
          prompt: {
            type: 'STRING',
            description: 'Hyper-detailed visual prompt following the 7-layer structure: 1) Composition, 2) Color palette with hex codes, 3) Typography specs, 4) Text overlays in English, 5) Visual elements, 6) Brand elements, 7) Platform specs. Minimum 100 words.',
          },
        },
        required: ['prompt'],
      },
      fn: async ({ prompt }) => {
        console.log('🎨 [DaVinci PRO] Generando visual con Gemini Imagen 4.0...');
        console.log(`📐 Prompt length: ${prompt.length} chars`);
        const result = await generateImageWithGemini(prompt);
        console.log(`🎨 [DaVinci PRO] Resultado Imagen: ${result.status}`);
        return result;
      }
    }),
    new Tool({
      name: 'select_niche_landing_image',
      description: `Selects a random landing page mockup image for a specific niche.
Returns a real file path to the selected PNG/JPEG image.

NICHE SELECTION RULES:
- You MUST pass the EXACT string of one of the 10 supported niches.
- Supported niches:
  "1. Limpieza (cleaning)"
  "2. Construcci\u00f3n (construction)"
  "3. Techado (roofing)"
  "4. Remodelaci\u00f3n (remodeling)"
  "5. Handyman"
  "6. Pintura (painting)"
  "7. Paisajismo (landscaping)"
  "8. Electricidad"
  "9. Plomer\u00eda (plumbing)"
  "10. Aire acondicionado (HVAC)"`,
      parameters: {
        type: 'OBJECT',
        properties: {
          nicheName: {
            type: 'STRING',
            description: 'The exact string of the selected niche from the 10 options.',
          },
        },
        required: ['nicheName'],
      },
      fn: async ({ nicheName }) => {
        console.log(`🖼️ [DaVinci Niche] Buscando imagen mockup para nicho: ${nicheName}`);
        try {
          const fs = await import('fs/promises');
          const path = await import('path');
          const baseNicheDir = path.resolve(process.cwd(), 'assets', 'landing_niches');
          const dirs = await fs.readdir(baseNicheDir);
          const targetDirName = dirs.find(d => d.toLowerCase().includes(nicheName.toLowerCase().replace(/^\d+\.\s*/, '')));
          if (!targetDirName) {
            console.warn(`  ⚠️ No se encontró la carpeta para el nicho ${nicheName}`);
            return { status: 'NOT_FOUND', visual_asset_url: null };
          }
          const nicheDir = path.join(baseNicheDir, targetDirName);
          const files = await fs.readdir(nicheDir);
          const images = files.filter(f => f.match(/\.(png|jpe?g|webp)$/i));
          if (images.length === 0) {
            console.warn(`  ⚠️ No hay imágenes en la carpeta ${nicheDir}`);
            return { status: 'NOT_FOUND', visual_asset_url: null };
          }
          const randomImg = images[Math.floor(Math.random() * images.length)];
          const localPath = path.join(nicheDir, randomImg);
          console.log(`✅ [DaVinci Niche] Imagen seleccionada: ${randomImg}`);
          return { status: 'SUCCESS', visual_asset_url: localPath };
        } catch (e) {
          console.error(`  ❌ Error leyendo carpeta de nicho: ${e.message}`);
          return { status: 'ERROR', error: e.message, visual_asset_url: null };
        }
      }
    })
  ]
});
