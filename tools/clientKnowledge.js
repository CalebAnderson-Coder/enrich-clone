import { Tool } from '../lib/AgentRuntime.js';
import { supabase } from '../lib/supabase.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini for generating the query vector
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export const recallClientKnowledge = new Tool({
  name: 'recall_client_knowledge',
  description: `Searches the client's past successful content (reels, posts) for specific topics or styles using semantic similarity.
  Use this to emulate their voice, discover their hooks, or see what they have talked about previously.`,
  parameters: {
    type: 'object',
    properties: {
      prospect_id: {
        type: 'string',
        description: 'The UUID of the prospect.',
      },
      query: {
        type: 'string',
        description: 'What you are looking for (e.g., "how they handle objections about price", "hooks about kitchen remodeling").',
      },
      limit: {
        type: 'number',
        description: 'Number of top results to return. Default 3.',
      },
      similarity_threshold: {
        type: 'number',
        description: 'Minimum similarity score (0 to 1). Default 0.3.',
      }
    },
    required: ['prospect_id', 'query'],
  },
  fn: async (args) => {
    const { prospect_id, query, limit = 3, similarity_threshold = 0.3 } = args;

    if (!supabase) return JSON.stringify({ error: "Supabase not connected" });
    if (!process.env.GEMINI_API_KEY) return JSON.stringify({ error: "GEMINI_API_KEY is not set" });

    try {
      console.log(`  🔍 [Recall] Searching client knowledge for target prospect (${prospect_id}) / query: "${query}"...`);

      // 1. Embed the user query
      const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
      const embedResult = await model.embedContent(query);
      const queryEmbedding = embedResult.embedding.values;

      // 2. Query Supabase via match_client_knowledge RPC
      const { data: matches, error } = await supabase.rpc('match_client_knowledge', {
        query_embedding: `[${queryEmbedding.join(',')}]`,
        match_threshold: similarity_threshold,
        match_count: limit,
        p_id: prospect_id
      });

      if (error) {
        throw error;
      }

      if (!matches || matches.length === 0) {
        return JSON.stringify({ result: "No relevant content found for this query." });
      }

      // Format results
      const results = matches.map(m => ({
        type: m.source_type,
        caption: m.caption,
        transcription: m.transcription,
        engagement_score: m.engagement_score,
        date: m.post_date,
        similarity: m.similarity
      }));

      return JSON.stringify({
        success: true,
        count: results.length,
        results
      });

    } catch (err) {
      console.error(`  ❌ [Recall] Error: ${err.message}`);
      return JSON.stringify({ error: err.message });
    }
  },
});
