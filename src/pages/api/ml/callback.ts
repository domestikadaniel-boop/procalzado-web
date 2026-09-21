import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { env as cfEnv } from 'cloudflare:workers';

export const prerender = false;

export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const oauthError = url.searchParams.get('error');

  if (oauthError) {
    return html(`<h2 style="color:red">Error de autorización: ${oauthError}</h2>`);
  }
  if (!code) return new Response('Código de autorización faltante', { status: 400 });

  const ML_APP_ID = (cfEnv as any).ML_APP_ID || import.meta.env.ML_APP_ID;
  const ML_APP_SECRET = (cfEnv as any).ML_APP_SECRET || import.meta.env.ML_APP_SECRET;
  const ML_REDIRECT_URI = (cfEnv as any).ML_REDIRECT_URI || import.meta.env.ML_REDIRECT_URI;
  const SUPABASE_URL = (cfEnv as any).PUBLIC_SUPABASE_URL || import.meta.env.PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = (cfEnv as any).SUPABASE_SERVICE_ROLE_KEY || import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!ML_APP_ID || !ML_APP_SECRET || !ML_REDIRECT_URI) {
    return new Response('Variables de entorno ML no configuradas', { status: 500 });
  }

  const res = await fetch('https://api.mercadolibre.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: ML_APP_ID,
      client_secret: ML_APP_SECRET,
      code,
      redirect_uri: ML_REDIRECT_URI,
    }).toString(),
  });

  if (!res.ok) {
    const err = await res.text();
    return html(`<h2 style="color:red">Error al obtener token:</h2><pre>${err}</pre>`);
  }

  const data = await res.json();
  const expiresAt = new Date(Date.now() + (data.expires_in || 21600) * 1000).toISOString();

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: existing } = await sb.from('ml_credentials').select('id').limit(1).maybeSingle();

  if (existing) {
    await sb.from('ml_credentials').update({
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: expiresAt,
      ml_user_id: String(data.user_id),
      updated_at: new Date().toISOString(),
    }).eq('id', existing.id);
  } else {
    await sb.from('ml_credentials').insert({
      app_id: ML_APP_ID,
      app_secret: ML_APP_SECRET,
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: expiresAt,
      ml_user_id: String(data.user_id),
    });
  }

  return html(`
    <h2 style="color:green">✅ MercadoLibre conectado correctamente</h2>
    <p>Vendedor ID: <strong>${data.user_id}</strong></p>
    <p>Ya puedes cerrar esta pestaña y volver al inventario.</p>
  `);
};

function html(body: string) {
  return new Response(
    `<html><head><title>ML Auth</title></head>
     <body style="font-family:sans-serif;text-align:center;padding:3rem;">${body}</body></html>`,
    { headers: { 'Content-Type': 'text/html' } }
  );
}
