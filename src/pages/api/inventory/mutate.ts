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

    } else if (action === 'delete_variants') {
      const { product_id } = params;
      const { error } = await sb.from('product_variants').delete().eq('product_id', product_id);
      if (error) throw error;
      return json({ ok: true });

    } else if (action === 'insert_variants') {
      const { variants } = params;
      if (!variants || !variants.length) return json({ ok: true });
      const { error } = await sb.from('product_variants').insert(variants);
      if (error) throw error;
      return json({ ok: true });

    } else if (action === 'merge_variants') {
      // Merge por ID: variantes con id = existentes (preserva stock), sin id = nuevas.
      // Solo borra las que el form no incluyó. Nunca toca stock_almacen/stock_bodega.
      const { product_id, variants: newVariants } = params;
      if (!product_id) throw new Error('product_id requerido');

      const { data: existing, error: fetchErr } = await sb
        .from('product_variants')
        .select('id,color,color_hex,color_hex_2')
        .eq('product_id', product_id);
      if (fetchErr) throw fetchErr;

      const existingIds = new Set((existing || []).map((v: any) => v.id));
      const existingById: Record<string, any> = {};
      (existing || []).forEach((v: any) => { existingById[v.id] = v; });

      const toInsert: any[] = [];
      const toUpdate: { id: string; color: string; color_hex: string | null; color_hex_2: string | null }[] = [];
      const keptIds = new Set<string>();

      for (const v of (newVariants || [])) {
        if (v.id && existingIds.has(v.id)) {
          keptIds.add(v.id);
          const ex = existingById[v.id];
          if (ex.color !== v.color || ex.color_hex !== v.color_hex || ex.color_hex_2 !== v.color_hex_2) {
            toUpdate.push({ id: v.id, color: v.color, color_hex: v.color_hex, color_hex_2: v.color_hex_2 });
          }
        } else {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id: _id, ...insertData } = v;
          toInsert.push(insertData);
        }
      }

      const toDeleteIds = [...existingIds].filter(id => !keptIds.has(id));

      // Orden seguro: insertar primero, luego actualizar, borrar al final.
      // Si insert falla antes del delete, no se pierden variantes existentes.
      if (toInsert.length) {
        const { error } = await sb.from('product_variants').insert(toInsert);
        if (error) throw error;
      }
      for (const u of toUpdate) {
        const { error } = await sb.from('product_variants')
          .update({ color: u.color, color_hex: u.color_hex, color_hex_2: u.color_hex_2 })
          .eq('id', u.id);
        if (error) throw error;
      }
      if (toDeleteIds.length) {
        const { error } = await sb.from('product_variants').delete().in('id', toDeleteIds);
        if (error) throw error;
      }
      return json({ ok: true });

    } else if (action === 'delete_image') {
      const { image_id } = params;
      const { error } = await sb.from('product_images').delete().eq('id', image_id);
      if (error) throw error;
      return json({ ok: true });

    } else if (action === 'insert_images') {
      const { images } = params;
      if (!images || !images.length) return json({ ok: true });
      const { error } = await sb.from('product_images').insert(images);
      if (error) throw error;
      return json({ ok: true });

    } else if (action === 'update_image') {
      const { image_id, fields } = params;
      const { error } = await sb.from('product_images').update(fields).eq('id', image_id);
      if (error) throw error;
      return json({ ok: true });

    } else if (action === 'update_images_color') {
      const { image_ids, color } = params;
      if (!image_ids?.length) return json({ ok: true });
      const { error } = await sb.from('product_images').update({ color }).in('id', image_ids);
      if (error) throw error;
      return json({ ok: true });

    } else if (action === 'update_images_primary') {
      const { product_id, primary_id } = params;
      const { error: e1 } = await sb.from('product_images').update({ is_primary: false }).eq('product_id', product_id);
      if (e1) throw e1;
      if (primary_id) {
        const { error: e2 } = await sb.from('product_images').update({ is_primary: true }).eq('id', primary_id);
        if (e2) throw e2;
      }
      return json({ ok: true });

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
