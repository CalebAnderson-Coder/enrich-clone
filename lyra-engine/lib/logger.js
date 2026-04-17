/**
 * Lyra — Logger Module
 * Records post drafts and execution results to Supabase.
 *
 * Table: lyra_posts (will be auto-created if missing)
 */

/**
 * Log a post execution to Supabase.
 * @param {{ postText: string, researchContext: string, published: boolean, error?: string, linkedinUrn?: string }} data
 */
export async function logPost(data) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.warn('[Lyra:Logger] Supabase not configured — logging to stdout only');
    console.log('[Lyra:Logger] Post result:', JSON.stringify(data, null, 2));
    return;
  }

  const row = {
    post_text: data.postText,
    research_context: data.researchContext?.slice(0, 2000), // Truncate for storage
    published: data.published,
    error: data.error || null,
    linkedin_urn: data.linkedinUrn || null,
    created_at: new Date().toISOString(),
  };

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/lyra_posts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify(row),
    });

    if (res.ok) {
      console.log('[Lyra:Logger] ✅ Logged to Supabase');
    } else {
      // Table might not exist yet — log but don't crash
      const errText = await res.text();
      console.warn(`[Lyra:Logger] Supabase ${res.status}: ${errText}`);
      console.log('[Lyra:Logger] Falling back to stdout');
      console.log('[Lyra:Logger] Post result:', JSON.stringify(row, null, 2));
    }
  } catch (err) {
    console.warn('[Lyra:Logger] Supabase error:', err.message);
    console.log('[Lyra:Logger] Post result:', JSON.stringify(row, null, 2));
  }
}
