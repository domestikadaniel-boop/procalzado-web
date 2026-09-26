import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { env as cfEnv } from 'cloudflare:workers';
import { getMLAccessToken, syncVariantToML } from '../../../lib/mercadolibre';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const SUPABASE_URL = (cfEnv as any).PUBLIC_SUPABASE_URL || import.meta.env.PUBLIC_SUPABASE_URL;
    const SERVICE_KEY = (cfEnv as any).SUPABASE_SERVICE_ROLE_KEY || import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return new Response('Server misconfigured', { status: 500 });
    }

    let payload: any;
    try {
      payload = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    // Solo procesar notificaciones de órdenes
    const topic: string = payload.topic || '';
    if (topic !== 'orders_v2' && topic !== 'orders') {
      return new Response('OK', { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Extraer el ID de la orden desde la URL del recurso (/orders/1234567)
    const orderId = String(payload.resource || '').split('/').pop();
    if (!orderId) return new Response('OK', { status: 200 });

    const idempotencyKey = `ml_order_${orderId}`;

    // Idempotencia con lock optimista:
    // 1. Verificación rápida inicial
    const { data: existing } = await supabase
      .from('inventory_movements')
      .select('id')
      .eq('from_location', idempotencyKey)
      .limit(1)
      .maybeSingle();
    if (existing) return new Response('Already processed', { status: 200 });

    // 2. Insertar lock placeholder inmediatamente
    const { data: lockRow } = await supabase.from('inventory_movements').insert({
      type: 'venta',
      product_name: `__lock_${orderId}`,
      color: '', size: '', quantity: 0,
      location: 'bodega', user_email: 'mercadolibre.com',
      from_location: idempotencyKey,
    }).select('id').single();

    if (!lockRow) return new Response('OK', { status: 200 });

    // 3. Esperar para que cualquier request concurrente también inserte su lock
    await new Promise(r => setTimeout(r, 150));

    // 4. Ver si soy el primero (id menor = llegué antes)
    const { data: allLocks } = await supabase
      .from('inventory_movements')
      .select('id')
      .eq('from_location', idempotencyKey)
      .order('id', { ascending: true })
      .limit(5);

    if (!allLocks || allLocks[0]?.id !== lockRow.id) {
      // Soy el duplicado — elimino mi lock y salgo
      await supabase.from('inventory_movements').delete().eq('id', lockRow.id);
      return new Response('Already processing', { status: 200 });
    }

    const token = await getMLAccessToken(supabase);
    if (!token) return new Response('No ML token', { status: 200 });

    // Obtener la orden completa desde la API de ML
    const r = await fetch(`https://api.mercadolibre.com/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return new Response('OK', { status: 200 });
    const order = await r.json();

    // Solo descontar cuando la orden está pagada
    if (order.status !== 'paid') return new Response('OK', { status: 200 });

    let lockUsed = false;
    for (const orderItem of (order.order_items || [])) {
      const mlItemId: string = orderItem.item?.id;
      const mlVariationId: number | null = orderItem.item?.variation_id || null;
      const qty: number = orderItem.quantity || 1;
      if (!mlItemId) continue;

      let variantQuery = supabase
        .from('product_variants')
        .select('id,stock_almacen,color,size,product_id')
        .eq('ml_item_id', mlItemId);

      if (mlVariationId) {
        variantQuery = variantQuery.eq('ml_variation_id', mlVariationId);
      }

      const { data: variant } = await variantQuery.maybeSingle();
      if (!variant) continue;

      const { data: prod } = await supabase
        .from('products')
        .select('name,brand')
        .eq('id', variant.product_id)
        .maybeSingle();

      const newStock = Math.max(0, (variant.stock_almacen || 0) - qty);

      await supabase.from('product_variants')
        .update({ stock_almacen: newStock })
        .eq('id', variant.id);

      const movData = {
        type: 'venta',
        product_name: prod?.name || orderItem.item?.title || '',
        brand_name: prod?.brand || null,
        color: variant.color || '',
        size: String(variant.size || ''),
        quantity: qty,
        location: 'bodega',
        user_email: 'mercadolibre.com',
        from_location: idempotencyKey,
      };

      if (!lockUsed) {
        // Reusar el lock placeholder como el primer registro real
        await supabase.from('inventory_movements').update(movData).eq('id', lockRow.id);
        lockUsed = true;
      } else {
        await supabase.from('inventory_movements').insert(movData);
      }

      syncVariantToML(supabase, variant.id);
    }

    // Si ningún item coincidió en la BD, limpiar el lock placeholder
    if (!lockUsed) {
      await supabase.from('inventory_movements').delete().eq('id', lockRow.id);
    }

    return new Response('OK', { status: 200 });
  } catch (err: any) {
    console.error('ML webhook error', err);
    return new Response('Internal error', { status: 500 });
  }
};
