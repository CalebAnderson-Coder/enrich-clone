import cron from 'node-cron';
import { supabase } from '../lib/supabase.js';
import { Groq } from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs-extra';
import path from 'path';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const TMP_DIR = path.join(process.cwd(), 'tmp');

async function downloadFile(url, dest) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
  const destStream = fs.createWriteStream(dest);
  
  if (response.body.pipe) { 
     // node-fetch style
     response.body.pipe(destStream);
  } else {
     // Web Streams API (Node 18+)
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

export async function processTranscriptions() {
  if (!supabase) return;

  console.log('  [Transcription Worker] Looking for pending videos/captions to embed...');

  // 1. Fetch pending records
  const { data: records, error } = await supabase
    .from('client_knowledge')
    .select('*')
    .is('transcription', null)
    .limit(5);

  if (error) {
    console.error('  [Transcription Worker] Supabase select error:', error.message);
    return;
  }

  if (!records || records.length === 0) {
    return; // Nothing to do
  }

  await fs.ensureDir(TMP_DIR);

  for (const record of records) {
    try {
      console.log(`    -> Processing: ${record.source_url}`);
      let transcriptionText = 'N/A';

      // 2. Transcribe Video if possible
      const videoUrl = record.raw_data?.videoUrl;
      if (videoUrl && process.env.GROQ_API_KEY) {
        const tmpFile = path.join(TMP_DIR, `${record.id}.mp4`);
        console.log(`       Downloading video...`);
        await downloadFile(videoUrl, tmpFile);

        console.log(`       Transcribing via Groq Whisper...`);
        // We use Groq's whisper
        const transcriptionResult = await groq.audio.transcriptions.create({
          file: fs.createReadStream(tmpFile),
          model: 'whisper-large-v3',
          prompt: 'Spanish and English words.',
          language: 'es',
        });
        
        transcriptionText = transcriptionResult.text || '';
        
        // Clean up
        await fs.remove(tmpFile);
      }

      // 3. Generate Embedding
      console.log(`       Generating vector embedding...`);
      const fullContentToEmbed = `CAPTION:\n${record.caption || ''}\n\nTRANSCRIPTION:\n${transcriptionText !== 'N/A' ? transcriptionText : ''}`;
      
      let embeddingBuffer = null;
      if (process.env.GEMINI_API_KEY) {
        // use text-embedding-004
        const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
        const result = await model.embedContent(fullContentToEmbed);
        embeddingBuffer = result.embedding.values; // Array of floats
      }

      // 4. Update Database
      const { error: updateError } = await supabase
        .from('client_knowledge')
        .update({
          transcription: transcriptionText,
          embedding: embeddingBuffer ? `[${embeddingBuffer.join(',')}]` : null
        })
        .eq('id', record.id);
        
      if (updateError) throw updateError;
      
      console.log(`       ✅ Completed and vectored.`);
      
    } catch (err) {
      console.error(`       ❌ Error on ${record.id}:`, err.message);
      // We'll set transcription to ERROR so it doesn't loop forever
      await supabase
        .from('client_knowledge')
        .update({ transcription: `ERROR: ${err.message}` })
        .eq('id', record.id);
    }
  }
}

// Start cron job (every 2 minutes)
export function startTranscriptionWorker() {
  console.log('🤖 Starting Transcription Worker background service...');
  cron.schedule('*/2 * * * *', () => {
    processTranscriptions().catch(console.error);
  });
}
