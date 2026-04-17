/**
 * Lyra — Publisher Module (Buffer API)
 * Publishes posts to LinkedIn via Buffer's REST API.
 *
 * Endpoint: POST https://api.bufferapp.com/1/updates/create.json
 * Auth: access_token query parameter (from Buffer OAuth or Personal Access Token)
 * Docs: https://buffer.com/developers/api/updates#updatescreate
 *
 * Required env vars:
 *   BUFFER_ACCESS_TOKEN  — Your Buffer access token
 *   BUFFER_PROFILE_ID    — The Buffer profile ID for your LinkedIn account
 */

/**
 * Publish a text post to LinkedIn via Buffer.
 * @param {string} postText - The full text of the LinkedIn post.
 * @param {{ now?: boolean }} options - If now=true, publishes immediately. Otherwise queues in Buffer.
 * @returns {{ ok: boolean, updateId?: string, error?: string }}
 */
export async function publish(postText, options = {}) {
  const accessToken = process.env.BUFFER_ACCESS_TOKEN;
  const profileId = process.env.BUFFER_PROFILE_ID;

  if (!accessToken || !profileId) {
    return {
      ok: false,
      error:
        'BUFFER_ACCESS_TOKEN and BUFFER_PROFILE_ID are required. ' +
        'Get your token at https://buffer.com/developers/apps — ' +
        'Get your profile ID by calling GET /profiles.json with your token.',
    };
  }

  const publishNow = options.now !== false; // default: publish immediately
  console.log(
    `[Lyra:Publish] ${publishNow ? '📤 Publishing NOW' : '📋 Queuing'} via Buffer API...`
  );

  // Buffer API expects application/x-www-form-urlencoded
  const params = new URLSearchParams();
  params.append('text', postText);
  params.append('profile_ids[]', profileId);
  if (publishNow) {
    params.append('now', 'true');
  }

  const url = `https://api.bufferapp.com/1/updates/create.json?access_token=${accessToken}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data = await res.json();

    if (data.success) {
      const updateId = data.updates?.[0]?.id || 'queued';
      const status = data.updates?.[0]?.status || 'unknown';
      console.log(`[Lyra:Publish] ✅ Buffer ${status} (ID: ${updateId})`);
      return { ok: true, updateId, status };
    }

    // Handle specific error codes
    if (res.status === 401 || data.code === 401) {
      return {
        ok: false,
        error: `Buffer token expired or invalid (401). Regenerate at https://buffer.com/developers/apps. Details: ${JSON.stringify(data)}`,
      };
    }

    if (res.status === 429) {
      return {
        ok: false,
        error: 'Buffer rate limit exceeded (60 req/min). Try again in 60 seconds.',
      };
    }

    return {
      ok: false,
      error: `Buffer API error (${res.status}): ${JSON.stringify(data)}`,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Network error: ${err.message}`,
    };
  }
}

/**
 * Fetch all connected Buffer profiles.
 * Use this during setup to find your LinkedIn profile ID.
 * @returns {Array<{ id: string, service: string, service_username: string }>}
 */
export async function listProfiles() {
  const accessToken = process.env.BUFFER_ACCESS_TOKEN;
  if (!accessToken) throw new Error('BUFFER_ACCESS_TOKEN required');

  const url = `https://api.bufferapp.com/1/profiles.json?access_token=${accessToken}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch profiles: ${res.status} ${await res.text()}`);
  }

  const profiles = await res.json();

  console.log('[Lyra:Publish] Connected Buffer profiles:');
  for (const p of profiles) {
    const label = p.service === 'linkedin' ? '👔' : '🔗';
    console.log(`  ${label} ${p.service} — @${p.service_username || p.formatted_username} — ID: ${p.id}`);
  }

  return profiles;
}

/**
 * Check pending updates in the Buffer queue for a profile.
 * @returns {{ total: number, updates: Array }}
 */
export async function getPendingUpdates() {
  const accessToken = process.env.BUFFER_ACCESS_TOKEN;
  const profileId = process.env.BUFFER_PROFILE_ID;
  if (!accessToken || !profileId) throw new Error('BUFFER_ACCESS_TOKEN and BUFFER_PROFILE_ID required');

  const url = `https://api.bufferapp.com/1/profiles/${profileId}/updates/pending.json?access_token=${accessToken}`;
  const res = await fetch(url);

  if (!res.ok) {
    throw new Error(`Failed to fetch pending updates: ${res.status}`);
  }

  const data = await res.json();
  console.log(`[Lyra:Publish] 📋 ${data.total} pending updates in Buffer queue`);
  return data;
}
