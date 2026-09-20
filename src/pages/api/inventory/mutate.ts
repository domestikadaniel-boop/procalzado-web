import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { env as cfEnv } from 'cloudflare:workers';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const sbUrl = (cfEnv as any).PUBLIC_SUPABASE_URL || import.meta.env.PUBLIC_SUPABASE_URL;
  const serviceKey = (cfEnv as any).SUPABASE_SERVICE_ROLE_KEY || import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

  // Verificar sesión del usuario con el anon key
  const authHeader = request.headers.get('Authorization');
  if (!authHeader) return json({ error: 'No autorizado' }, 401);

  // Crear cliente con service role (bypass RLS) para las mutaciones
  const sb = createClient(sbUrl, serviceKey);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Body inválido' }, 400); }

  const { action, ...params } = body;

  try {
    if (action === 'update_stock') {
      const { vid, field, value } = params;
      const { data, error } = await sb
        .from('product_variants')
        .update({ [field]: value })
        .eq('id', vid)
        .select('id,stock_almacen,stock_bodega');
      if (error) throw error;
      if (!data || !data.length) throw new Error('Variante no encontrada');
      return json({ data: data[0] });

    } else if (action === 'transfer') {
      const { vid, from_field, to_field, from_value, to_value } = params;
      const { data, error } = await sb
        .from('product_variants')
        .update({ [from_field]: from_value, [to_field]: to_value })
        .eq('id', vid)
        .select('id,stock_almacen,stock_bodega');
      if (error) throw error;
      if (!data || !data.length) throw new Error('Variante no encontrada');
      return json({ data: data[0] });

    } else if (action === 'log_movement') {
      const { type, product_name, brand_name, color, size, quantity, location, from_location, to_location, user_email } = params;
      const { error } = await sb.from('inventory_movements').insert({
        type, product_name, brand_name, color, size, quantity,
        location: location || null,
        from_location: from_location || null,
        to_location: to_location || null,
        user_email,
      });
      if (error) throw error;
      return json({ ok: true });

    } else if (action === 'get_movements') {
      const { data, error } = await sb
        .from('inventory_movements')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
      if (error) throw error;
      return json({ data });

    } else {
      return json({ error: 'Acción desconocida' }, 400);
    }
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
