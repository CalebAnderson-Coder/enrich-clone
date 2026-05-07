/**
 * apply_017_agent_autonomy.mjs
 * Applies migrations/017_agent_autonomy.sql to the Supabase project via
 * the direct DB query API (same approach used by _createTable.mjs).
 *
 * Usage:
 *   node scripts/apply_017_agent_autonomy.mjs
 *
 * Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 * (loaded automatically from .env via dotenv/config)
 *
 * NOTE: This script is idempotent — safe to run multiple times.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const PROJECT_REF = SUPABASE_URL.match(/https:\/\/([^.]+)/)?.[1];
if (!PROJECT_REF) {
  console.error('ERROR: Could not parse project ref from SUPABASE_URL:', SUPABASE_URL);
  process.exit(1);
}

const migrationPath = join(__dirname, '..', 'migrations', '017_agent_autonomy.sql');
const sql = readFileSync(migrationPath, 'utf8');

const dbUrl = `https://db.${PROJECT_REF}.supabase.co/query`;
console.log(`Applying 017_agent_autonomy.sql → ${dbUrl}`);

const res = await fetch(dbUrl, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ query: sql }),
});

console.log(`Status: ${res.status} ${res.statusText}`);
const body = await res.text();
console.log('Response:', body.slice(0, 800));

if (!res.ok) {
  console.error('Migration FAILED.');
  process.exit(1);
}

console.log('Migration 017 applied successfully.');
console.log('Tables created: agent_messages, agent_processes, agent_state');
