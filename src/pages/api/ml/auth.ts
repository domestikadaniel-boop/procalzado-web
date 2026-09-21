import type { APIRoute } from 'astro';
import { env as cfEnv } from 'cloudflare:workers';

export const prerender = false;

export const GET: APIRoute = async () => {
  const ML_APP_ID = (cfEnv as any).ML_APP_ID || import.meta.env.ML_APP_ID;
  const ML_REDIRECT_URI = (cfEnv as any).ML_REDIRECT_URI || import.meta.env.ML_REDIRECT_URI;

  if (!ML_APP_ID || !ML_REDIRECT_URI) {
    return new Response(
      'MercadoLibre no está configurado. Agrega ML_APP_ID y ML_REDIRECT_URI a las variables de entorno.',
      { status: 500 }
    );
  }

  const url = new URL('https://auth.mercadolibre.com.co/authorization');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', ML_APP_ID);
  url.searchParams.set('redirect_uri', ML_REDIRECT_URI);

  return Response.redirect(url.toString(), 302);
};
