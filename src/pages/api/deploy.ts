import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const env = (locals as any).runtime?.env;
    const hookUrl = env?.CLOUDFLARE_DEPLOY_HOOK;

    if (!hookUrl) {
      return new Response(JSON.stringify({ error: 'Deploy hook no configurado.' }), { status: 500 });
    }

    const res = await fetch(hookUrl, { method: 'POST' });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: 'Error al disparar el deploy.' }), { status: 502 });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
