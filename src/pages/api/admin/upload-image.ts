import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { env as cfEnv } from 'cloudflare:workers';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return json({ error: 'No autorizado' }, 401);

  const sbUrl = (cfEnv as any).PUBLIC_SUPABASE_URL || import.meta.env.PUBLIC_SUPABASE_URL;
  const serviceKey = (cfEnv as any).SUPABASE_SERVICE_ROLE_KEY || import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  const sb = createClient(sbUrl, serviceKey);

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    if (!file) return json({ error: 'Archivo no encontrado' }, 400);

    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const { error } = await sb.storage
      .from('product-images')
      .upload(path, arrayBuffer, { contentType: file.type });

    if (error) throw error;

    const { data: { publicUrl } } = sb.storage.from('product-images').getPublicUrl(path);
    return json({ url: publicUrl });
  } catch (e: any) {
    return json({ error: e.message }, 500);
  }
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
