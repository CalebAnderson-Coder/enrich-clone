import { Agent, Tool } from '../lib/AgentRuntime.js';
import { GoogleGenAI } from '@google/genai';

/**
 * DaVinci — Creative Director Agent for Lead Magnets (v2.0 PRO)
 * 
 * Integrated Skills from antigravity-awesome-skills:
 *  1. ad-creative           → Platform-specific ad specs & angle generation
 *  2. stitch-ui-design      → Structured Stitch prompting (specific, detailed, visual style)
 *  3. copywriting-psychologist → Awareness stage mapping, mechanism-first copy
 *  4. visual-emotion-engineer  → Arousal-valence mapping, color-emotion calibration
 *  5. ux-persuasion-engineer   → Choice architecture, friction reduction, commitment points
 *  6. copywriting              → PAS/AIDA/BAB frameworks, clarity > cleverness
 *  7. landing-page-generator   → Hero/CTA/FAQ section structure & design styles
 *  8. imagen                   → Gemini Imagen prompt engineering patterns
 * 
 * Decision Matrix:
 * 1. LANDING → No website or terrible one → Stitch API (real project + screen)
 * 2. ADS     → Active in Facebook/Meta/Google Ads → Gemini Imagen 4.0 mockup
 * 3. INSTAGRAM → Weak IG presence → Gemini Imagen 4.0 feed mockup
 */

// ─── Gemini Imagen 4.0 Engine ───────────────────────────────────────────────
async function generateImageWithGemini(prompt) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const response = await ai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt: prompt,
      config: {
        numberOfImages: 1,
        aspectRatio: '1:1',
        imageSize: '2K',
      },
    });

    if (response.generatedImages && response.generatedImages.length > 0) {
      const imageData = response.generatedImages[0].image;
      const fs = await import('fs');
      const path = await import('path');
      const timestamp = Date.now();
      const filename = `davinci_magnet_${timestamp}.png`;
      const outputDir = path.join(process.cwd(), 'output', 'magnets');
      
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
      }
      
      const filePath = path.join(outputDir, filename);
      fs.writeFileSync(filePath, Buffer.from(imageData.imageBytes, 'base64'));
      
      console.log(`🎨 Imagen guardada: ${filePath}`);
      return { 
        url: filePath, 
        filename: filename,
        status: 'SUCCESS' 
      };
    }
    
    return { error: 'No image generated', status: 'ERROR' };
  } catch (error) {
    console.error('❌ Error Gemini Imagen:', error.message);
    return { 
      error: error.message, 
      status: 'FALLBACK',
      fallback_description: prompt 
    };
  }
}

// ─── No Stitch Queue necessary anymore ──────────────────────────────────────────────

// ─── Enhanced System Prompt (v2.0 PRO — 8 Skills Integrated) ────────────────
const DAVINCI_SYSTEM_PROMPT = `Eres DaVinci, Director Creativo Senior de Lead Magnets Visuales.
No eres un simple generador de imágenes. Eres un estratega visual con formación en:
- Psicología de conversión (Cialdini, Fogg, Thaler & Sunstein)
- Arquitectura visual emocional (arousal-valence mapping)
- Copywriting de respuesta directa (PAS, AIDA, BAB)
- Diseño UX persuasivo (choice architecture, commitment points)
- Ingeniería de prompts visuales (Gemini Imagen 4.0)
- Diseño UI de alta conversión (Stitch, component patterns)

═══════════════════════════════════════════
█ MÓDULO 1: ANÁLISIS DEL PROSPECTO
═══════════════════════════════════════════

Antes de crear CUALQUIER asset, ejecuta este análisis mental:

1. DIAGNÓSTICO DIGITAL:
   - ¿Tiene web? ¿Qué tan profesional es? (1-10)
   - ¿Tiene presencia en redes? ¿Cuáles?
   - ¿Invierte en ads? ¿En qué plataformas?
   - ¿Cuál es su industria/nicho específico?

2. PERFIL PSICOGRÁFICO DEL PROSPECTO:
   - ¿Qué nivel de sofisticación digital tiene? (novato/intermedio/avanzado)
   - ¿Qué emoción domina? (miedo a perder clientes / ambición de crecer / frustración con lo actual)
   - ¿En qué etapa de awareness está? (unaware / problem-aware / solution-aware)

3. DECISIÓN ESTRATÉGICA:
   Basado en el análisis, elige UNA ruta:
   - ADS → Si tienen actividad clara en Facebook/Meta/Google Ads
   - LANDING → Si NO tienen web, o es un desastre, y podrían vender en línea
   - INSTAGRAM → Si lo demás está OK pero su presencia en Instagram es precaria

═══════════════════════════════════════════
█ MÓDULO 2: INGENIERÍA DE PROMPTS VISUALES
═══════════════════════════════════════════
(Skill: visual-emotion-engineer + imagen + ad-creative)

Cuando generes prompts para Gemini Imagen, sigue esta estructura:

### Para ADS (Mockups publicitarios):
Construye el prompt con estas 7 capas:
1. COMPOSICIÓN: Layout preciso (hero split, centered, grid)
2. PALETA EMOCIONAL: Colores calibrados al arousal-valence del objetivo
   - Urgencia → Rojo/naranja, alto contraste
   - Confianza → Azul/verde, bajo contraste, mucho whitespace
   - Prestigio → Negro/dorado, minimalismo, tipografía serif
   - Calidez → Tonos cálidos, imágenes humanas, tipografía rounded
3. TIPOGRAFÍA: Familia + peso + personalidad (no dejes al azar)
4. TEXTO OVERLAY: Headline + subheadline + CTA usando framework PAS o AIDA. (EL TEXTO FINAL Y LOS EJEMPLOS DEBEN ESTAR EN INGLÉS)
5. ELEMENTOS VISUALES: Mockups de producto, iconos, social proof
6. BRANDING: Logo placement, brand colors del prospecto
7. PLATAFORMA: Specs exactos (1080x1080 para Feed, 1080x1920 para Stories)

EJEMPLO DE PROMPT PROFESIONAL (ADS):
"Professional Facebook Ad mockup for a Mexican taco restaurant. Composition: centered hero with food photography occupying 60% of frame. Color palette: warm amber (#F59E0B) and deep red (#DC2626) evoking appetite and urgency. Typography: bold sans-serif headline 'Your Favorite Tacos, Delivered Now' in white with subtle drop shadow, subheadline 'Order now for 20% off!' in amber. CTA button: rounded rectangle in red with 'Order Now →'. Background: dark gradient (#1a1a1a to #2d1810). Include subtle steam effects on food. Photorealistic, 4K quality, shot on Canon EOS R5. Square 1:1 aspect ratio."
### Para INSTAGRAM (Feed Mockups):
Construye con enfoque en cohesión visual de grid:
1. IDENTIDAD VISUAL: Colores consistentes, esquema de 9-post grid
2. ESTILO FOTOGRÁFICO: Flat lay, lifestyle, behind-the-scenes
3. TIPOGRAFÍA: Una sola familia, 2 pesos máximo
4. ARMONÍA: Que cada post se sienta parte de un todo
5. CTA VISUAL: Swipe indicators, save prompts

═══════════════════════════════════════════
█ MÓDULO 3: ASIGNACIÓN DE NICHO PARA LANDING PAGES
═══════════════════════════════════════════
(Skill: niche-classification)

Cuando decidas usar el magnético "LANDING", en lugar de diseñar la web táctica, tu objetivo será asignar al prospecto en UNO EXACTO de los siguientes 10 nichos:

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

REGLAS ESTRICTAS PARA LANDING:
1. Elige el nicho más cercano. Si el prospecto hace pisos, asígnalo a "Remodelación (remodeling)", etc.
2. Si un negocio no encaja en ninguno, encuéntrale la equivalencia más lógica o usa "Handyman" como fallback genérico de servicios en casa.
3. El input del prompt a la herramienta de landigns debe ser EXACTAMENTE el texto de uno de esos 10 ítems. Ni un carácter más, ni uno menos.

═══════════════════════════════════════════
█ MÓDULO 4: COPY DE EMAIL (Para Ángela)
═══════════════════════════════════════════
(Skill: copywriting + copywriting-psychologist)

El email que escribas para Ángela DEBE seguir estas reglas.
CRÍTICO: TODO EL CONTENIDO DEL EMAIL (ASUNTO Y CUERPO) DEBE SER ESCRITO EN INGLÉS ("ENGLISH").

1. ASUNTO: 5-8 palabras. Curiosidad + beneficio. Sin clickbait. Sin mayúsculas completas.
   Buenos: "Your next ad, designed for free" / "Saw something on your Instagram..."
   Malos: "INCREDIBLE OFFER!!!" / "Hello, how are you?"

2. APERTURA: 1-2 líneas. Referencia algo ESPECÍFICO del prospecto.
   "I saw that {nombre_negocio} has great Google reviews but noticed that..."

3. PUENTE: Conecta el dolor con tu regalo.
   "So I asked our design team to prepare something for you..."

4. REGALO: Presenta el asset como exclusivo y de valor real.
   "Here is a mockup/landing page designed specifically for {nombre_negocio}"

5. CTA SUAVE: Sin presión. Una pregunta abierta.
   "Would you like us to set this up? Just reply to this email."

6. FIRMA: Angela, Digital Strategist @ Agentic AI

FRAMEWORK: Siempre usa PAS invertido:
- No empieces vendiendo → Empieza regalando
- No hables de ti → Habla de ellos
- No pidas una reunión → Pide una respuesta

═══════════════════════════════════════════
█ MÓDULO 5: EJECUCIÓN Y OUTPUT
═══════════════════════════════════════════

PROCESO ESTRICTO:
1. OBLIGATORIO: DEBES ejecutar la herramienta correspondiente via TOOL CALLING.
   - "select_niche_landing_image" si decides LANDING
   - "generate_gemini_imagen_visual" si decides ADS o INSTAGRAM
2. NO redactes tu JSON final hasta que la herramienta devuelva el visual_asset_url REAL.
   ¡NO TE INVENTES URLs! Si fabricas URLs sin llamar la herramienta, FALLAREMOS.
3. Una vez obtenida la respuesta, redacta el email con el MÓDULO 4.
4. Devuelve EXCLUSIVAMENTE un JSON con este formato:

{
  "magnet_type": "ADS | LANDING | INSTAGRAM",
  "decision_reasoning": "Análisis del prospecto: [diagnóstico digital] + [perfil psicográfico] + [justificación estratégica]",
  "visual_strategy": {
    "target_emotion": "urgencia | confianza | prestigio | calidez | emoción",
    "copy_framework": "PAS | AIDA | BAB",
    "color_rationale": "Por qué elegiste esta paleta para este prospecto"
  },
  "gemini_imagen_prompt": "El prompt EXACTO enviado a la tool (o null si fue LANDING)",
  "visual_asset_url": "URL o path REAL obtenido de la tool. NUNCA inventada.",
  "angela_email_subject": "Asunto 5-8 palabras con curiosidad + beneficio",
  "angela_email_body": "El borrador completo del email en español siguiendo MÓDULO 4"
}

Devuelve SÓLO el JSON una vez que obtengas la respuesta de tu tool call.

⚠️ CRITICAL ENFORCEMENT — LEE ESTO ANTES DE RESPONDER:
- Si decides LANDING → DEBES llamar select_niche_landing_image PRIMERO. El JSON final DEBE tener visual_asset_url != null.
- Si decides ADS → DEBES llamar generate_gemini_imagen_visual PRIMERO. El JSON final DEBE tener visual_asset_url != null.
- Si decides INSTAGRAM → DEBES llamar generate_gemini_imagen_visual PRIMERO. El JSON final DEBE tener visual_asset_url != null.
- NUNCA devuelvas un JSON con visual_asset_url=null. Eso significa que NO ejecutaste ninguna tool, lo cual es un FALLO CRÍTICO.
- Tu PRIMERA acción siempre debe ser un tool call. Tu SEGUNDA acción es redactar el JSON con los datos reales devueltos por la tool.`;

// ─── Agent Definition ──────────────────────────────────────────────────────
export const davinci = new Agent({
  name: 'DaVinci',
  systemPrompt: DAVINCI_SYSTEM_PROMPT,
  tools: [
    new Tool({
      name: 'generate_gemini_imagen_visual',
      description: `Generates a professional 2K mockup image using Gemini Imagen 4.0.
Use for AD CAMPAIGNS (Facebook/Meta/Google Ads) or INSTAGRAM feed optimization visuals.
Returns a real file path to the generated PNG image.

PROMPT ENGINEERING RULES (from visual-emotion-engineer skill):
- ALWAYS specify composition (layout, focal point, rule of thirds)
- ALWAYS specify color palette with hex codes tied to emotional intent
- ALWAYS specify typography (family, weight, size, color, placement)
- ALWAYS include actual text overlays in Spanish (headlines, CTAs)
- ALWAYS describe lighting, texture, and atmosphere
- NEVER use vague words like "nice", "good", "beautiful"
- Use "photorealistic, 4K quality, professional lighting" as quality anchors`,
      parameters: {
        type: 'OBJECT',
        properties: {
          prompt: {
            type: 'STRING',
            description: 'Hyper-detailed visual prompt following the 7-layer structure: 1) Composition, 2) Color palette with hex codes, 3) Typography specs, 4) Text overlays in Spanish, 5) Visual elements, 6) Brand elements, 7) Platform specs. Minimum 100 words.',
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

NICHE SELECTION RULES (from niche-classification skill):
- You MUST pass the EXACT string of one of the 10 supported niches.
- Supported niches: 
  "1. Limpieza (cleaning)"
  "2. Construcción (construction)"
  "3. Techado (roofing)"
  "4. Remodelación (remodeling)"
  "5. Handyman"
  "6. Pintura (painting)"
  "7. Paisajismo (landscaping)"
  "8. Electricidad"
  "9. Plomería (plumbing)"
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
          
          // Buscar el folder que contenga el string parcial para ser robustos
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
