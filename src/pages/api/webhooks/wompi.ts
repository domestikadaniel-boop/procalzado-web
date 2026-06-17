import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

export const prerender = false;

// Wompi envía: { event, data: { transaction }, environment, signature: { properties, checksum }, timestamp, sent_at }
interface WompiEvent {
  event: string;
  data: { transaction: any };
  environment: string;
  signature: { properties: string[]; checksum: string };
  timestamp: number;
  sent_at: string;
}

async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(text));
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Lee un valor anidado de un objeto usando una ruta tipo "transaction.id"
function getNested(obj: any, path: string): any {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

async function sendTelegram(token: string, chatId: string, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
  } catch (e) {
    console.error('Telegram notify failed', e);
  }
}

async function sendInvoiceEmail(resendApiKey: string, order: any, items: any[]) {
  const itemsHtml = items.map(it => `
    <tr>
      <td style="padding:8px 0;font-size:13px;color:#000;">${it.product_name}${it.color ? ' — ' + it.color : ''}${it.size ? ' (Talla ' + it.size + ')' : ''}</td>
      <td style="padding:8px 0;font-size:13px;color:#4A4A4A;text-align:center;">${it.quantity}</td>
      <td style="padding:8px 0;font-size:13px;color:#000;text-align:right;">$${(it.total_cents / 100).toLocaleString('es-CO')}</td>
    </tr>
  `).join('');

  const html = `
  <div style="background:#F2F2F2;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" style="max-width:520px;margin:0 auto;background:#FFFFFF;border-radius:12px;overflow:hidden;border:1px solid #E5E5E5;">
      <tr>
        <td style="background:#FF0000;padding:28px 32px;text-align:center;">
          <span style="font-size:24px;font-weight:800;color:#FFFFFF;">procalzado</span>
        </td>
      </tr>
      <tr>
        <td style="padding:32px 32px 16px;">
          <h1 style="margin:0 0 4px;font-size:20px;color:#000;">¡Gracias por tu compra!</h1>
          <p style="margin:0 0 20px;font-size:13px;color:#4A4A4A;">Pedido #${order.order_number} &middot; ${new Date().toLocaleDateString('es-CO')}</p>
          <table role="presentation" width="100%" style="border-top:2px solid #000;border-bottom:1px solid #E5E5E5;margin-bottom:12px;">
            <tr><td style="padding:8px 0;font-size:11px;font-weight:700;text-transform:uppercase;color:#4A4A4A;">Producto</td><td style="padding:8px 0;font-size:11px;font-weight:700;text-transform:uppercase;color:#4A4A4A;text-align:center;">Cant.</td><td style="padding:8px 0;font-size:11px;font-weight:700;text-transform:uppercase;color:#4A4A4A;text-align:right;">Total</td></tr>
          </table>
          <table role="presentation" width="100%">${itemsHtml}</table>
          <table role="presentation" width="100%" style="margin-top:16px;border-top:2px solid #000;">
            <tr><td style="padding:12px 0 0;font-size:15px;font-weight:700;color:#000;">Total pagado</td><td></td><td style="padding:12px 0 0;font-size:15px;font-weight:700;color:#FF0000;text-align:right;">$${(order.total_cents / 100).toLocaleString('es-CO')}</td></tr>
          </table>
          <p style="margin:24px 0 0;font-size:12px;color:#4A4A4A;line-height:1.6;">
            Enviaremos tu pedido a: ${order.shipping_address}${order.shipping_detail ? ', ' + order.shipping_detail : ''}, ${order.shipping_city}, ${order.shipping_department}.<br>
            Cualquier duda, escríbenos por WhatsApp al +57 321 315 4654.
          </p>
        </td>
      </tr>
      <tr>
        <td style="background:#F2F2F2;padding:20px 32px;text-align:center;border-top:1px solid #E5E5E5;">
          <p style="margin:0;font-size:12px;color:#4A4A4A;"><strong style="color:#000;">PROCALZADO</strong> &middot; Distribuidores Autorizados</p>
          <p style="margin:6px 0 0;font-size:11px;color:#FF0000;font-weight:600;">Sé parte de nuestra familia.</p>
        </td>
      </tr>
    </table>
  </div>`;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Procalzado <no-reply@procalzado.com>',
        to: order.buyer_email,
        subject: `Confirmación de pedido #${order.order_number} — Procalzado`,
        html,
      }),
    });
  } catch (e) {
    console.error('Resend invoice email failed', e);
  }
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as any).runtime?.env || {};
    const SUPABASE_URL = env.PUBLIC_SUPABASE_URL || import.meta.env.PUBLIC_SUPABASE_URL;
    const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    const WOMPI_EVENTS_SECRET = env.WOMPI_EVENTS_SECRET || import.meta.env.WOMPI_EVENTS_SECRET;
    const TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN || import.meta.env.TELEGRAM_BOT_TOKEN;
    const TELEGRAM_CHAT_ID = env.TELEGRAM_CHAT_ID || import.meta.env.TELEGRAM_CHAT_ID;
    const RESEND_API_KEY = env.RESEND_API_KEY || import.meta.env.RESEND_API_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY || !WOMPI_EVENTS_SECRET) {
      return new Response('Server misconfigured', { status: 500 });
    }

    const payload: WompiEvent = await request.json();

    // ── VALIDACIÓN DE FIRMA (crítico, sin esto cualquiera podría falsificar un pago) ──
    if (!payload.signature || !payload.signature.properties || !payload.signature.checksum) {
      return new Response('Missing signature', { status: 400 });
    }

    const concatenatedValues = payload.signature.properties
      .map(prop => getNested(payload.data, prop))
      .join('');
    const stringToHash = `${concatenatedValues}${payload.timestamp}${WOMPI_EVENTS_SECRET}`;
    const computedChecksum = await sha256Hex(stringToHash);

    if (computedChecksum.toLowerCase() !== payload.signature.checksum.toLowerCase()) {
      return new Response('Invalid signature', { status: 401 });
    }

    // Solo nos importa el evento de actualización de transacción
    if (payload.event !== 'transaction.updated') {
      return new Response('OK', { status: 200 });
    }

    const transaction = payload.data.transaction;
    const reference = transaction.reference;
    const wompiStatus = transaction.status; // APPROVED, DECLINED, VOIDED, ERROR, PENDING
    const transactionId = transaction.id;

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Idempotencia: si ya procesamos este transaction_id, no lo repetimos
    const { data: existingEvent } = await supabase
      .from('wompi_events')
      .select('id')
      .eq('transaction_id', transactionId)
      .maybeSingle();

    if (existingEvent) {
      return new Response('Already processed', { status: 200 });
    }

    await supabase.from('wompi_events').insert({
      transaction_id: transactionId,
      event_type: payload.event,
      raw_payload: payload as any,
    });

    // Buscar el pedido por la referencia
    const { data: order } = await supabase
      .from('orders')
      .select('*')
      .eq('wompi_reference', reference)
      .single();

    if (!order) {
      return new Response('Order not found', { status: 200 }); // 200 para que Wompi no reintente infinito
    }

    let newStatus = order.status;
    if (wompiStatus === 'APPROVED') newStatus = 'paid';
    else if (wompiStatus === 'DECLINED' || wompiStatus === 'ERROR') newStatus = 'cancelled';
    else if (wompiStatus === 'VOIDED') newStatus = 'cancelled';

    await supabase
      .from('orders')
      .update({
        status: newStatus,
        wompi_transaction_id: transactionId,
        wompi_status: wompiStatus,
        wompi_payment_method: transaction.payment_method_type || '',
        wompi_raw: transaction,
      })
      .eq('id', order.id);

    // Solo notificar y facturar si el pago fue aprobado
    if (wompiStatus === 'APPROVED' && !order.telegram_notified) {
      const { data: items } = await supabase.from('order_items').select('*').eq('order_id', order.id);

      // Notificación a Telegram
      if (TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID) {
        const itemsText = (items || []).map(i =>
          `• ${i.product_name}${i.color ? ' (' + i.color + (i.size ? ', talla ' + i.size : '') + ')' : ''} x${i.quantity}`
        ).join('\n');

        const msg = `🟢 <b>NUEVA VENTA — Pedido #${order.order_number}</b>\n\n` +
          `👤 ${order.buyer_name}\n` +
          `📞 ${order.buyer_phone}\n` +
          `✉️ ${order.buyer_email}\n\n` +
          `${itemsText}\n\n` +
          `💰 Total: $${(order.total_cents / 100).toLocaleString('es-CO')}\n` +
          `📍 ${order.shipping_address}, ${order.shipping_city}, ${order.shipping_department}\n` +
          `💳 ${transaction.payment_method_type || ''}`;

        await sendTelegram(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, msg);
      }

      // Factura por correo al cliente
      if (RESEND_API_KEY) {
        await sendInvoiceEmail(RESEND_API_KEY, order, items || []);
      }

      await supabase.from('orders').update({ telegram_notified: true, invoice_sent: true }).eq('id', order.id);
    }

    return new Response('OK', { status: 200 });

  } catch (err: any) {
    console.error('Wompi webhook error', err);
    return new Response('Internal error', { status: 500 });
  }
};
