/**
 * ACHPHORIA · Edge Function "ach-bridge" — jembatan Telegram <-> asisten AI.
 * Deploy: supabase functions deploy ach-bridge --project-ref ckoejqzownrujikefgwb --no-verify-jwt --use-api
 * (verify_jwt=false juga diset di supabase/config.toml). Logika ada di handler.ts.
 */
import { createHandler } from './handler.ts';

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

const waitUntil = typeof EdgeRuntime !== 'undefined' && EdgeRuntime && typeof EdgeRuntime.waitUntil === 'function'
  ? (p: Promise<unknown>) => EdgeRuntime!.waitUntil(p)
  : undefined;

Deno.serve(createHandler({
  env: (k) => Deno.env.get(k),
  fetch: (input, init) => fetch(input, init),
  waitUntil,
}));
