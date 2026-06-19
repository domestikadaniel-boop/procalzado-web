import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { env as cfEnv } from 'cloudflare:workers';

export const prerender = false;

// ── Tipos esperados del body ──
interface CheckoutItem {
  productId: string;
  slug: string;
  name: string;
  brand?: string;
  color?: string;
  size?: string;
  price: number; // precio unitario en pesos (no centavos) — solo referencia, no se confía en este valor
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

// ── Validación estricta server-side (nunca confiar solo en el cliente) ──
const NAME_RE = /^[A-Za-zÁÉÍÓÚáéíóúÑñÜü\s]{2,80}$/;
const PHONE_RE = /^[0-9]{7,15}$/;
const DOC_RE = /^[0-9]{4,15}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{1,24}$/;
const DOC_TYPE_RE = /^(CC|CE|NIT|PP|TI)$/;
const TEXT_FIELD_RE = /^.{1,200}$/; // límite genérico de longitud para ciudad/depto/dirección
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateBody(body: any): string | null {
  if (!body || typeof body !== 'object') return 'Solicitud inválida';

  if (!Array.isArray(body.items) || body.items.length === 0) return 'El carrito está vacío';
  if (body.items.length > 50) return 'Demasiados productos en el carrito';

  for (const item of body.items) {
    if (!item || typeof item !== 'object') return 'Producto inválido';
    if (!item.productId || typeof item.productId !== 'string' || !UUID_RE.test(item.productId)) return 'Producto inválido';
    if (!Number.isInteger(item.qty) || item.qty <= 0 || item.qty > 50) return 'Cantidad inválida';
    if (item.color && (typeof item.color !== 'string' || item.color.length > 60)) return 'Color inválido';
    if (item.size && (typeof item.size !== 'string' || item.size.length > 20)) return 'Talla inválida';
  }

  const b = body.buyer;
  if (!b || typeof b !== 'object') return 'Faltan datos del comprador';
  if (typeof b.name !== 'string' || !NAME_RE.test(b.name.trim())) return 'Nombre inválido: solo letras y espacios, entre 2 y 80 caracteres';
  if (typeof b.email !== 'string' || !EMAIL_RE.test(b.email.trim())) return 'Correo electrónico inválido';
  if (typeof b.phone !== 'string' || !PHONE_RE.test(b.phone.trim())) return 'Teléfono inválido: solo números, entre 7 y 15 dígitos';
  if (b.documentType && !DOC_TYPE_RE.test(b.documentType)) return 'Tipo de documento inválido';
  if (typeof b.documentNumber !== 'string' || !DOC_RE.test(b.documentNumber.trim())) return 'Número de documento inválido: solo números';

  const s = body.shipping;
  if (!s || typeof s !== 'object') return 'Faltan datos de envío';
  if (typeof s.department !== 'string' || !TEXT_FIELD_RE.test(s.department.trim())) return 'Departamento inválido';
  if (typeof s.city !== 'string' || !TEXT_FIELD_RE.test(s.city.trim())) return 'Ciudad inválida';
  if (typeof s.address !== 'string' || !TEXT_FIELD_RE.test(s.address.trim())) return 'Dirección inválida';
  if (s.detail && (typeof s.detail !== 'string' || s.detail.length > 200)) return 'Detalle de dirección inválido';

  if (body.userId && (typeof body.userId !== 'string' || !UUID_RE.test(body.userId))) return 'Usuario inválido';

  return null; // sin errores
}

// ── Rate limiting simple por IP usando Supabase (sin bindings nuevos de Cloudflare) ──
async function checkRateLimit(supabase: any, ip: string): Promise<boolean> {
  const windowStart = new Date(Date.now() - 60_000).toISOString(); // ventana de 60s
  const { count } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', windowStart)
    .eq('client_ip', ip);
  return (count || 0) < 5; // máx 5 intentos de checkout por IP por minuto
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const SUPABASE_URL = (cfEnv as any).PUBLIC_SUPABASE_URL || import.meta.env.PUBLIC_SUPABASE_URL;
    const SERVICE_KEY = (cfEnv as any).SUPABASE_SERVICE_ROLE_KEY || import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    const WOMPI_PUBLIC_KEY = (cfEnv as any).WOMPI_PUBLIC_KEY || import.meta.env.WOMPI_PUBLIC_KEY;
    const WOMPI_INTEGRITY_SECRET = (cfEnv as any).WOMPI_INTEGRITY_SECRET || import.meta.env.WOMPI_INTEGRITY_SECRET;

    if (!SUPABASE_URL || !SERVICE_KEY || !WOMPI_PUBLIC_KEY || !WOMPI_INTEGRITY_SECRET) {
      return new Response(JSON.stringify({ error: 'Configuración del servidor incompleta' }), { status: 500 });
    }

    // Límite de tamaño del body (previene payloads gigantes)
    const contentLength = request.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > 50_000) {
      return new Response(JSON.stringify({ error: 'Solicitud demasiado grande' }), { status: 413 });
    }

    let body: CheckoutBody;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400 });
    }

    const validationError = validateBody(body);
    if (validationError) {
      return new Response(JSON.stringify({ error: validationError }), { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';
    const underLimit = await checkRateLimit(supabase, clientIp);
    if (!underLimit) {
      return new Response(JSON.stringify({ error: 'Demasiados intentos. Espera un minuto e intenta de nuevo.' }), { status: 429 });
    }

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
        buyer_name: body.buyer.name.trim(),
        buyer_email: body.buyer.email.trim().toLowerCase(),
        buyer_phone: body.buyer.phone.trim(),
        buyer_document_type: body.buyer.documentType || 'CC',
        buyer_document_number: body.buyer.documentNumber.trim(),
        shipping_department: body.shipping.department.trim(),
        shipping_city: body.shipping.city.trim(),
        shipping_address: body.shipping.address.trim(),
        shipping_detail: (body.shipping.detail || '').trim(),
        subtotal_cents: subtotalCents,
        shipping_cents: shippingCents,
        total_cents: totalCents,
        wompi_reference: reference,
        client_ip: clientIp,
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
