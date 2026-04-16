import { supabaseAuth } from './supabaseAuthClient';

const API_BASE_URL = import.meta.env.VITE_API_URL
  || (import.meta.env.PROD ? '/api' : 'http://localhost:4000/api');

// During Bloque 1 transition: if no session yet, fall back to legacy Bearer
// so existing operator flows keep working. Cutover removes this.
const LEGACY_BEARER = import.meta.env.VITE_API_SECRET_KEY || null;

async function authHeader() {
  const { data } = await supabaseAuth.auth.getSession();
  const token = data?.session?.access_token;
  if (token) return { Authorization: `Bearer ${token}` };
  if (LEGACY_BEARER) return { Authorization: `Bearer ${LEGACY_BEARER}` };
  return {};
}

export async function apiGet(path) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    headers: { ...(await authHeader()) },
  });
  return res;
}

export async function apiPost(path, body) {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body || {}),
  });
  return res;
}

export { API_BASE_URL };
