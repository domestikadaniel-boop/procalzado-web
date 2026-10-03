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

    const topic: string = payload.topic || '';
    if (topic !== 'orders_v2' && topic !== 'orders') {
      return new Response('OK', { status: 200 });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const orderId = String(payload.resource || '').split('/').pop();
    if (!orderId) return new Response('OK', { status: 200 });

    const token = await getMLAccessToken(supabase);
    if (!token) return new Response('No ML token', { status: 200 });

    const r = await fetch(`https://api.mercadolibre.com/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) return new Response('OK', { status: 200 });
    const order = await r.json();

    if (order.status === 'paid') {
      return await handlePaidOrder(supabase, orderId, order);
    } else if (order.status === 'cancelled') {
      return await handleCancelledOrder(supabase, orderId, order, token);
    }

    return new Response('OK', { status: 200 });
  } catch (err: any) {
    console.error('ML webhook error', err);
    return new Response('Internal error', { status: 500 });
  }
};

async function handlePaidOrder(supabase: any, orderId: string, order: any) {
  const paidKey = `ml_order_${orderId}`;

  // Verificar si ya fue procesado (excluir locks huérfanos)
  const { data: existing } = await supabase
    .from('inventory_movements')
    .select('id,product_name')
    .eq('from_location', paidKey)
    .limit(1)
    .maybeSingle();

  if (existing && !existing.product_name?.startsWith('__lock_')) {
    return new Response('Already processed', { status: 200 });
  }

  // Si hay un lock huérfano de una ejecución anterior, eliminarlo
  if (existing?.product_name?.startsWith('__lock_')) {
    await supabase.from('inventory_movements').delete().eq('id', existing.id);
  }

  // Lock optimista contra webhooks duplicados simultáneos
  const { data: lockRow } = await supabase.from('inventory_movements').insert({
    type: 'venta',
    product_name: `__lock_${orderId}`,
    color: '', size: '', quantity: 0,
    location: 'bodega', user_email: 'mercadolibre.com',
    from_location: paidKey,
  }).select('id').single();

  if (!lockRow) return new Response('OK', { status: 200 });

  await new Promise(r => setTimeout(r, 150));

  const { data: allLocks } = await supabase
    .from('inventory_movements')
    .select('id')
    .eq('from_location', paidKey)
    .order('id', { ascending: true })
    .limit(5);

  if (!allLocks || allLocks[0]?.id !== lockRow.id) {
    await supabase.from('inventory_movements').delete().eq('id', lockRow.id);
    return new Response('Already processing', { status: 200 });
  }

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
    await supabase.from('product_variants').update({ stock_almacen: newStock }).eq('id', variant.id);

    const movData = {
      type: 'venta',
      product_name: prod?.name || orderItem.item?.title || '',
      brand_name: prod?.brand || null,
      color: variant.color || '',
      size: String(variant.size || ''),
      quantity: qty,
      location: 'bodega',
      user_email: 'mercadolibre.com',
      from_location: paidKey,
    };

    if (!lockUsed) {
      await supabase.from('inventory_movements').update(movData).eq('id', lockRow.id);
      lockUsed = true;
    } else {
      await supabase.from('inventory_movements').insert(movData);
    }

    syncVariantToML(supabase, variant.id);
  }

  if (!lockUsed) {
    await supabase.from('inventory_movements').delete().eq('id', lockRow.id);
  }

  return new Response('OK', { status: 200 });
}

async function handleCancelledOrder(supabase: any, orderId: string, order: any, token: string) {
  const paidKey = `ml_order_${orderId}`;
  const cancelKey = `ml_cancel_${orderId}`;

  // Si la cancelación ya fue procesada, salir
  const { data: cancelExists } = await supabase
    .from('inventory_movements')
    .select('id')
    .eq('from_location', cancelKey)
    .limit(1)
    .maybeSingle();
  if (cancelExists) return new Response('Already cancelled', { status: 200 });

  // Limpiar lock huérfano si existe
  const { data: orphanLock } = await supabase
    .from('inventory_movements')
    .select('id,product_name')
    .eq('from_location', paidKey)
    .like('product_name', '__lock_%')
    .maybeSingle();
  if (orphanLock) {
    await supabase.from('inventory_movements').delete().eq('id', orphanLock.id);
  }

  // Verificar si llegamos a descontar stock para esta orden
  const { data: paidMovs } = await supabase
    .from('inventory_movements')
    .select('*')
    .eq('from_location', paidKey)
    .not('product_name', 'like', '__lock_%');

  if (!paidMovs || paidMovs.length === 0) {
    // Nunca se pagó ni se descontó — nada que restaurar
    return new Response('OK', { status: 200 });
  }

  // Restaurar stock usando los mismos items de la orden
  let firstInsert = true;
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

    const newStock = (variant.stock_almacen || 0) + qty;
    await supabase.from('product_variants').update({ stock_almacen: newStock }).eq('id', variant.id);

    await supabase.from('inventory_movements').insert({
      type: 'devolucion_ml',
      product_name: prod?.name || orderItem.item?.title || '',
      brand_name: prod?.brand || null,
      color: variant.color || '',
      size: String(variant.size || ''),
      quantity: qty,
      location: 'bodega',
      user_email: 'mercadolibre.com',
      from_location: cancelKey,
    });

    syncVariantToML(supabase, variant.id);
    firstInsert = false;
  }

  return new Response('OK', { status: 200 });
}
