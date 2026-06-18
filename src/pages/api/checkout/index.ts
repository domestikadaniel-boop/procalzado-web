import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

// ── Tipos esperados del body ──
interface CheckoutItem {
  productId: string;
  slug: string;
  name: string;
  brand?: string;
  color?: string;
  size?: string;
  price: number; // precio unitario en pesos (no centavos)
  img?: string;
  qty: number;
}

interface CheckoutBody {
  items: CheckoutItem[];
  buyer: {
    name: string;
    email: string;
    phone: string;
    documentType?: string;
    documentNumber?: string;
  };
  shipping: {
    department: string;
    city: string;
    address: string;
    detail?: string;
  };
  userId?: string | null; // si el comprador está logueado
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as any).runtime?.env || {};
    const SUPABASE_URL = env.PUBLIC_SUPABASE_URL || import.meta.env.PUBLIC_SUPABASE_URL;
    const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    const WOMPI_PUBLIC_KEY = env.WOMPI_PUBLIC_KEY || import.meta.env.WOMPI_PUBLIC_KEY;
    const WOMPI_INTEGRITY_SECRET = env.WOMPI_INTEGRITY_SECRET || import.meta.env.WOMPI_INTEGRITY_SECRET;

    if (!SUPABASE_URL || !SERVICE_KEY || !WOMPI_PUBLIC_KEY || !WOMPI_INTEGRITY_SECRET) {
      return new Response(JSON.stringify({ error: 'Configuración del servidor incompleta' }), { status: 500 });
    }

    const body: CheckoutBody = await request.json();

    if (!body.items || body.items.length === 0) {
      return new Response(JSON.stringify({ error: 'El carrito está vacío' }), { status: 400 });
    }
    if (!body.buyer?.email || !body.buyer?.name || !body.buyer?.phone) {
      return new Response(JSON.stringify({ error: 'Faltan datos del comprador' }), { status: 400 });
    }
    if (!body.shipping?.city || !body.shipping?.address) {
      return new Response(JSON.stringify({ error: 'Faltan datos de envío' }), { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Calcular totales en SERVIDOR (nunca confiar en precios que vengan del cliente)
    const productIds = body.items.map(i => i.productId).filter(Boolean);
    const { data: dbProducts, error: prodErr } = await supabase
      .from('products')
      .select('id, name, price, sale_price, show_price')
      .in('id', productIds);

    if (prodErr || !dbProducts) {
      return new Response(JSON.stringify({ error: 'No se pudieron validar los productos', detail: prodErr?.message || 'sin datos' }), { status: 500 });
    }

    let subtotalCents = 0;
    const validatedItems: any[] = [];

    for (const item of body.items) {
      const dbProd = dbProducts.find(p => p.id === item.productId);
      if (!dbProd) continue; // ignorar items que ya no existen
      const realPrice = dbProd.show_price ? (dbProd.sale_price || dbProd.price || 0) : 0;
      const lineTotalCents = Math.round(realPrice * 100) * item.qty;
      subtotalCents += lineTotalCents;
      validatedItems.push({
        product_id: item.productId,
        product_name: dbProd.name,
        product_slug: item.slug || '',
        product_image: item.img || '',
        brand: item.brand || '',
        color: item.color || '',
        size: item.size || '',
        quantity: item.qty,
        unit_price_cents: Math.round(realPrice * 100),
        total_cents: lineTotalCents,
      });
    }

    if (validatedItems.length === 0) {
      return new Response(JSON.stringify({ error: 'Ningún producto válido en el carrito' }), { status: 400 });
    }

    const shippingCents = 0; // ajustar si manejas costo de envío fijo o calculado
    const totalCents = subtotalCents + shippingCents;

    if (totalCents <= 0) {
      return new Response(JSON.stringify({ error: 'El total del pedido no es válido' }), { status: 400 });
    }

    // Referencia única para Wompi
    const reference = `PCZ-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

    // Crear el pedido en estado pending
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        user_id: body.userId || null,
        status: 'pending',
        buyer_name: body.buyer.name,
        buyer_email: body.buyer.email,
        buyer_phone: body.buyer.phone,
        buyer_document_type: body.buyer.documentType || 'CC',
        buyer_document_number: body.buyer.documentNumber || '',
        shipping_department: body.shipping.department || '',
        shipping_city: body.shipping.city,
        shipping_address: body.shipping.address,
        shipping_detail: body.shipping.detail || '',
        subtotal_cents: subtotalCents,
        shipping_cents: shippingCents,
        total_cents: totalCents,
        wompi_reference: reference,
      })
      .select()
      .single();

    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: 'No se pudo crear el pedido', detail: orderErr?.message || 'sin datos' }), { status: 500 });
    }

    // Insertar los items del pedido
    const itemsToInsert = validatedItems.map(it => ({ ...it, order_id: order.id }));
    await supabase.from('order_items').insert(itemsToInsert);

    // Generar firma de integridad de Wompi
    // Fórmula: sha256(referencia + montoEnCentavos + moneda + secretoIntegridad)
    const signaturePayload = `${reference}${totalCents}COP${WOMPI_INTEGRITY_SECRET}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(signaturePayload);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const integritySignature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

    return new Response(JSON.stringify({
      orderId: order.id,
      reference,
      amountInCents: totalCents,
      currency: 'COP',
      publicKey: WOMPI_PUBLIC_KEY,
      integritySignature,
      customerEmail: body.buyer.email,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: 'Error procesando el checkout', detail: String(err?.message || err) }), { status: 500 });
  }
};
