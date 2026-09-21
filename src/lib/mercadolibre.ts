import type { SupabaseClient } from '@supabase/supabase-js';

const ML_API = 'https://api.mercadolibre.com';

export async function getMLAccessToken(sb: SupabaseClient): Promise<string | null> {
  const { data: cred } = await sb.from('ml_credentials').select('*').limit(1).maybeSingle();
  if (!cred?.refresh_token) return null;

  if (cred.expires_at && new Date(cred.expires_at).getTime() > Date.now() + 5 * 60 * 1000) {
    return cred.access_token;
  }

  const res = await fetch(`${ML_API}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: cred.app_id,
      client_secret: cred.app_secret,
      refresh_token: cred.refresh_token,
    }).toString(),
  });

  if (!res.ok) {
    console.error('ML token refresh failed', await res.text());
    return null;
  }

  const data = await res.json();
  const expiresAt = new Date(Date.now() + (data.expires_in || 21600) * 1000).toISOString();

  await sb.from('ml_credentials').update({
    access_token: data.access_token,
    refresh_token: data.refresh_token || cred.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }).eq('id', cred.id);

  return data.access_token;
}

export async function syncVariantToML(sb: SupabaseClient, variantId: string): Promise<void> {
  try {
    const { data: v } = await sb
      .from('product_variants')
      .select('ml_item_id,ml_variation_id,stock_almacen,stock_bodega')
      .eq('id', variantId)
      .single();

    if (!v?.ml_item_id) return;

    const token = await getMLAccessToken(sb);
    if (!token) return;

    const totalStock = (v.stock_almacen || 0) + (v.stock_bodega || 0);
    const url = v.ml_variation_id
      ? `${ML_API}/items/${v.ml_item_id}/variations/${v.ml_variation_id}`
      : `${ML_API}/items/${v.ml_item_id}`;

    const mlRes = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ available_quantity: Math.max(0, totalStock) }),
    });

    if (!mlRes.ok) console.error(`ML sync failed for ${v.ml_item_id}`, await mlRes.text());
  } catch (e) {
    console.error('syncVariantToML error', e);
  }
}
