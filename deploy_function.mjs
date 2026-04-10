import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

// Bundle the function using esbuild
const functionDir = path.join('supabase', 'functions', 'twilio-webhook');
const indexFile = path.join(functionDir, 'index.ts');
const code = fs.readFileSync(indexFile, 'utf8');

const projectRef = 'pzxlgpnnizdambzepngf';
const accessToken = 'sbp_344d82e87bdb4f2f2efb7106b873335a40501e01';

// Deploy via Management API
const url = `https://api.supabase.com/v1/projects/${projectRef}/functions/twilio-webhook`;

const body = JSON.stringify({
  verify_jwt: false,
  body: code,
  name: 'twilio-webhook',
  entrypoint_path: 'index.ts'
});

const res = await fetch(url, {
  method: 'PATCH',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body
});

const json = await res.json();
if (res.ok) {
  console.log('✅ Deployed! Status:', res.status);
  console.log('Function:', json.name, '| Updated:', json.updated_at);
} else {
  // Try POST if PATCH fails (first-time creation)
  const res2 = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/functions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body
  });
  const json2 = await res2.json();
  console.log(res2.status, JSON.stringify(json2));
}
