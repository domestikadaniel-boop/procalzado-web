import type { APIRoute } from 'astro';
import { env as cfEnv } from 'cloudflare:workers';

export const prerender = false;

export const POST: APIRoute = async () => {
  try {
    const hookUrl = (cfEnv as any).CLOUDFLARE_DEPLOY_HOOK;

    if (!hookUrl) {
      return new Response(JSON.stringify({ error: 'Deploy hook no configurado.' }), {
        status: 500, headers: { 'Content-Type': 'application/json' }
      });
    }

    const res = await fetch(hookUrl, { method: 'POST' });

    if (!res.ok) {
      const body = await res.text();
      return new Response(JSON.stringify({ error: `Error ${res.status}: ${body}` }), {
        status: 502, headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
};
