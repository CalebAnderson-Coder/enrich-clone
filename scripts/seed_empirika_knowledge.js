import 'dotenv/config';
import { ApifyClient } from 'apify-client';
import { createClient } from '@supabase/supabase-js';
import { Groq } from 'groq-sdk';
import fs from 'fs-extra';
import path from 'path';

// Supabase Setup
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';
const supabase = supabaseUrl ? createClient(supabaseUrl, supabaseKey) : null;

// Apify Setup
const APIFY_TOKEN = process.env.APIFY_API_TOKEN;
const apifyClient = new ApifyClient({ token: APIFY_TOKEN });

// Groq Setup
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const TMP_DIR = path.join(process.cwd(), 'tmp');

async function downloadFile(url, dest) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  const destStream = fs.createWriteStream(dest);
  
  if (response.body.pipe) { 
     response.body.pipe(destStream);
  } else {
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        destStream.write(value);
      }
      destStream.end();
  }

  return new Promise((resolve, reject) => {
    destStream.on('finish', resolve);
    destStream.on('error', reject);
  });
}

async function run() {
  if (!supabase || !APIFY_TOKEN) {
    console.error('❌ Faltan credenciales: SUPABASE o APIFY_API_TOKEN en .env');
    return;
  }

  const targetUsername = 'empirikagroup';
  console.log(`\n🚀 Iniciando extracción profunda (hasta 500 posts) para la cuenta propia de Carlos: @${targetUsername}...`);

  const input = {
    addParentData: false,
    directUrls: [ `https://www.instagram.com/${targetUsername}/` ],
    enhanceUserSearchWithFacebookPage: false,
    isUserTaggedFeedURL: false,
    resultsLimit: 500,
    resultsType: "posts",
    searchLimit: 1
  };

  try {
    console.log('  🕸️ [Apify] Descargando de la caché (Data pre-existente para evitar costos)...');
    
    // Obtenemos los datasets que sabemos que existen del run anterior
    const res1 = await apifyClient.dataset('awUh1sQdsapcLSiO9').listItems();
    const res2 = await apifyClient.dataset('oCP8UzhYPxnopPjeO').listItems();
    let items = [...res1.items, ...res2.items];
    
    console.log(`  ✅ [Apify] ¡Completado! Se descargaron ${items.length} posts/videos locales de la caché.`);

    await fs.ensureDir(TMP_DIR);

    for (let i = 0; i < items.length; i++) {
        const p = items[i];
        if (p.error) continue;

        console.log(`  -> Procesando [${i + 1}/${items.length}]: ${p.url}`);

        // Revisar si ya está transcrito
        const { data: existing } = await supabase
            .from('carlos_knowledge')
            .select('transcription')
            .eq('source_url', p.url || p.videoUrl)
            .maybeSingle();

        if (existing && existing.transcription && !existing.transcription.includes('[Error de Transcripción')) {
            console.log(`     ⏭️ Ya existe transcripción para este post. Saltando inferencia...`);
            continue; // Nos saltamos todo el proceso pesado si ya lo logramos antes
        }

        let transcriptionText = null;

        // Si es video, usamos Whisper para extraer audio
        if (p.videoUrl && process.env.GROQ_API_KEY) {
            const tmpFile = path.join(TMP_DIR, `empirika_vid_${i}.mp4`);
            try {
                console.log(`     Descargando video para transcripción...`);
                await downloadFile(p.videoUrl, tmpFile);
                
                console.log(`     Transcribiendo audio vía Groq (Whisper)...`);
                const transcriptionResult = await groq.audio.transcriptions.create({
                    file: fs.createReadStream(tmpFile),
                    model: 'whisper-large-v3',
                    prompt: 'Spanish marketing concepts. Agencia, IA, automatización, CRM, leads.',
                    language: 'es',
                });
                transcriptionText = transcriptionResult.text || null;
            } catch (err) {
                console.error(`     ❌ Error transcribiendo video: ${err.message}`);
                transcriptionText = `[Error de Transcripción: ${err.message}]`;
            } finally {
                // Ensure tmp file is deleted
                if (fs.existsSync(tmpFile)) {
                    try {
                        await fs.remove(tmpFile);
                    } catch (fsErr) {
                        console.error(`     ⚠️ Advertencia: No se pudo borrar ${tmpFile} ahora mismo (${fsErr.code})`);
                    }
                }
            }
        }

        const likes = p.likesCount || 0;
        const comments = p.commentsCount || 0;
        const score = likes + (comments * 3);
        const followers = p.ownerUsername === targetUsername ? (p.ownerFollowersCount || 1) : 1;

        const record = {
            source_type: p.type === 'Video' ? 'instagram_reel' : 'instagram_post',
            caption: p.caption || '',
            transcription: transcriptionText,
            hashtags: p.hashtags || [],
            topic_tags: [], // Categorization could be injected here later
            likes_count: likes,
            comments_count: comments,
            engagement_score: score / followers, // Actual formula adjusted
            post_date: p.timestamp ? new Date(p.timestamp).toISOString() : null,
            source_url: p.url,       
            raw_data: p             
        };

        const { error: upsertError } = await supabase
            .from('carlos_knowledge')
            .upsert([record], { onConflict: 'source_url', ignoreDuplicates: false });

        if (upsertError) {
             console.error(`     ❌ Error insertando en supabase: ${upsertError.message}`);
        } else {
             console.log(`     ✅ Guardado exitosamente en carlos_knowledge.`);
        }
    }

    console.log(`\n🎉 Extracción finalizada. La base de datos de conocimiento de Carlos Empirika ahora tiene ${items.length} piezas indexadas y transcritas.`);
    
  } catch (err) {
    console.error('❌ Ocurrió un error general:', err);
  }
}

run();
