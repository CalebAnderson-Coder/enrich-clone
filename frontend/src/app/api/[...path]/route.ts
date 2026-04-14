import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL = process.env.BACKEND_URL || 'http://localhost:3001';
// In development/local this will be available, fallback to the one in .env
const API_SECRET_KEY = process.env.API_SECRET_KEY || 'sk_live_51MxxXYZ123SecureEnrichToken2026';

export async function GET(request: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const params = await props.params;
  return handleProxy(request, params);
}

export async function POST(request: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const params = await props.params;
  return handleProxy(request, params);
}

export async function PUT(request: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const params = await props.params;
  return handleProxy(request, params);
}

export async function DELETE(request: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const params = await props.params;
  return handleProxy(request, params.path);
}

export async function PATCH(request: NextRequest, props: { params: Promise<{ path: string[] }> }) {
  const params = await props.params;
  return handleProxy(request, params.path);
}

async function handleProxy(req: Request, pathSegments: string[]) {
  try {
    const path = pathSegments.join('/');
    const targetUrl = `${BACKEND_URL}/api/${path}${new URL(req.url).search}`;
    
    console.log(`[Frontend Proxy] FETCHING: ${targetUrl} [${req.method}]`);

    const headers = new Headers(req.headers);
    headers.delete('host');
    headers.delete('connection');
    headers.set('Authorization', `Bearer ${API_SECRET_KEY}`);

    // Improved body handling
    let body: any = undefined;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      try {
        body = await req.clone().arrayBuffer();
      } catch (e) {
        console.warn('[Frontend Proxy] Could not clone request body:', e);
      }
    }

    const res = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
      // @ts-ignore
      duplex: body ? 'half' : undefined,
    });

    if (!res.ok) {
      console.error(`[Frontend Proxy] BACKEND ERROR [${res.status}]: ${targetUrl}`);
    }

    const responseHeaders = new Headers(res.headers);
    // Let Next.js handle content-encoding
    responseHeaders.delete('content-encoding');

    return new NextResponse(res.body, {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('API Proxy Error:', error);
    return new NextResponse(JSON.stringify({ error: 'Internal API Proxy Error' }), { 
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
