/**
 * ACHPHORIA ach-bridge v6 — rute FX (mode AI).
 * PC (bot Windows) pakai header x-fx-key (= secret FX_DEVICE_KEY).
 * AI (box) pakai header x-ach-key (= secret BRIDGE_KEY), sama seperti /api.
 * Semua akses DB lewat service role; tabel ach_fx_* privat (RLS, tanpa policy).
 */
// deno-lint-ignore no-explicit-any
export type Json = any;

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const FX_ACTIONS = ['open', 'close', 'modify', 'close_all', 'pause', 'resume', 'set_watchlist'] as const;
export const FX_STATUSES = ['pending', 'executing', 'done', 'rejected', 'expired', 'failed'] as const;
export const FX_TFS = ['M15', 'H1'] as const;
const DEVICE_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const SYMBOL_RE = /^[A-Za-z0-9._]{2,20}$/;
const SIDE_RE = /^(buy|sell)$/i;

const str = (v: unknown, max = 500): string | null => (v === undefined || v === null ? null : String(v).slice(0, max));
const num = (v: unknown, name: string, min: number, max: number, required = false): number | null => {
  if (v === undefined || v === null || v === '') { if (required) throw new HttpError(400, `${name} wajib`); return null; }
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} harus angka ${min}..${max}`);
  return n;
};

export function deviceOf(v: unknown, fallback = 'pc1'): string {
  const d = str(v, 40);
  if (!d) return fallback;
  if (!DEVICE_RE.test(d)) throw new HttpError(400, 'device_id hanya huruf kecil, angka, - dan _ (maks 32)');
  return d;
}

/** Validasi ketat body perintah AI. Mengembalikan baris siap insert. */
export function validateCommand(body: Json, device: string, now: Date): Json {
  const action = String(body?.action ?? '');
  if (!(FX_ACTIONS as readonly string[]).includes(action)) throw new HttpError(400, 'action: ' + FX_ACTIONS.join(' | '));
  const row: Json = {
    created_by: 'ai', device_id: device, action, status: 'pending',
    reason: str(body?.reason, 500),
    timeframe: null, symbol: null, side: null, order_type: null,
    sl_price: null, tp_price: null, risk_percent: null, lots: null,
    max_slippage_points: null, ticket: null,
  };
  if (body?.timeframe != null && body.timeframe !== '') {
    const tf = String(body.timeframe).toUpperCase();
    if (!(FX_TFS as readonly string[]).includes(tf)) throw new HttpError(400, 'timeframe: M15 | H1');
    row.timeframe = tf;
  }
  const needsSymbol = action === 'open'; // close/modify pakai ticket
  if (needsSymbol || (body?.symbol != null && body.symbol !== '')) {
    const sym = str(body?.symbol, 20);
    if (!sym || !SYMBOL_RE.test(sym)) throw new HttpError(400, 'symbol tidak valid (contoh EURUSD, XAUUSD)');
    row.symbol = sym.toUpperCase();
  }
  if (action === 'open') {
    const side = str(body?.side, 8);
    if (!side || !SIDE_RE.test(side)) throw new HttpError(400, 'open butuh side: buy | sell');
    row.side = side.toLowerCase();
    row.order_type = 'market';
    if (body?.order_type != null && String(body.order_type).toLowerCase() !== 'market') throw new HttpError(400, 'order_type hanya market untuk sekarang');
    row.sl_price = num(body?.sl_price ?? body?.sl, 'sl_price', 1e-9, 1e9, true);
    row.tp_price = num(body?.tp_price ?? body?.tp, 'tp_price', 0, 1e9);
    row.risk_percent = num(body?.risk_percent ?? body?.risk, 'risk_percent', 0.1, 10, true);
    row.lots = num(body?.lots, 'lots', 0.01, 5);
    row.max_slippage_points = num(body?.max_slippage_points, 'max_slippage_points', 0, 10000);
  } else if (action === 'close') {
    row.ticket = num(body?.ticket, 'ticket', 1, 9e15, true);
  } else if (action === 'modify') {
    row.ticket = num(body?.ticket, 'ticket', 1, 9e15, true);
    row.sl_price = num(body?.sl_price ?? body?.sl, 'sl_price', 1e-9, 1e9, true);
    row.tp_price = num(body?.tp_price ?? body?.tp, 'tp_price', 0, 1e9);
  } else if (action === 'set_watchlist') {
    const raw = body?.symbols ?? body?.watchlist;
    const list = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
    const syms = [...new Set(list.map((s: unknown) => String(s).trim().toUpperCase()).filter(Boolean))];
    if (!syms.length || syms.length > 12) throw new HttpError(400, 'watchlist: 1..12 simbol');
    for (const s of syms) if (!SYMBOL_RE.test(s)) throw new HttpError(400, `simbol tidak valid: ${s}`);
    row.symbol = syms.join(',');
  }
  const mins = num(body?.expires_in_min, 'expires_in_min', 1, 60) ?? 10;
  row.expires_at = new Date(now.getTime() + mins * 60000).toISOString();
  return row;
}

const MAX_STATE_BYTES = 1_500_000;

/** Validasi & rapikan snapshot dari PC. */
export function validateState(body: Json): Json {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'body harus objek JSON');
  const mode = String(body.mode ?? 'manual');
  if (mode !== 'manual' && mode !== 'ai') throw new HttpError(400, 'mode: manual | ai');
  const keep = (v: unknown, fallback: unknown) => (v && typeof v === 'object' ? v : fallback);
  const row: Json = {
    heartbeat_at: new Date().toISOString(),
    mode,
    bot_running: !!body.bot_running,
    dry_run: !!body.dry_run,
    account: keep(body.account, {}),
    positions: Array.isArray(body.positions) ? body.positions.slice(0, 200) : [],
    risk_status: keep(body.risk_status, {}),
    symbols: keep(body.symbols, {}),
    link: keep(body.link, {}),
  };
  if (body.market !== undefined) row.market = keep(body.market, {});
  const size = JSON.stringify(row).length;
  if (size > MAX_STATE_BYTES) throw new HttpError(413, `snapshot terlalu besar (${size} byte, maks ${MAX_STATE_BYTES})`);
  return row;
}

const JOURNAL_EVENTS = ['opened', 'closed', 'modified', 'rejected', 'paused', 'resumed', 'note'];

export function validateJournal(body: Json): Json[] {
  const items = Array.isArray(body?.events) ? body.events : [body];
  if (items.length > 50) throw new HttpError(400, 'maks 50 event per kiriman');
  return items.map((e: Json) => {
    const event = String(e?.event ?? '');
    if (!JOURNAL_EVENTS.includes(event)) throw new HttpError(400, 'event: ' + JOURNAL_EVENTS.join(' | '));
    return {
      event, ticket: num(e?.ticket, 'ticket', 0, 9e15),
      symbol: e?.symbol ? String(e.symbol).slice(0, 20).toUpperCase() : null,
      side: e?.side ? String(e.side).slice(0, 8).toLowerCase() : null,
      lots: num(e?.lots, 'lots', 0, 1000),
      price: num(e?.price, 'price', 0, 1e9),
      sl: num(e?.sl, 'sl', 0, 1e9),
      tp: num(e?.tp, 'tp', 0, 1e9),
      profit: num(e?.profit, 'profit', -1e12, 1e12),
      reason: str(e?.reason, 500),
      extra: e?.extra && typeof e.extra === 'object' ? e.extra : {},
    };
  });
}

const RESULT_STATUSES = ['done', 'rejected', 'failed', 'expired'];

export function validateResult(body: Json): Json {
  const status = String(body?.status ?? '');
  if (!RESULT_STATUSES.includes(status)) throw new HttpError(400, 'status: ' + RESULT_STATUSES.join(' | '));
  const result = body?.result && typeof body.result === 'object' ? body.result : {};
  const out: Json = { ...result };
  for (const k of ['ticket', 'fill_price', 'lots']) if (out[k] !== undefined) out[k] = num(out[k], k, -1e12, 1e12);
  if (out.error !== undefined) out.error = str(out.error, 500);
  if (out.reason !== undefined) out.reason = str(out.reason, 500);
  return { status, result: out };
}

export interface FxDeps {
  db: (path: string, init?: { method?: string; body?: unknown; prefer?: string }) => Promise<Json>;
  env: (k: string) => string | undefined;
  now: () => Date;
  safeEqual: (a: string | null | undefined, b: string | null | undefined) => Promise<boolean>;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Router /fx. `rest` = segmen setelah 'fx'. */
export function createFx(deps: FxDeps) {
  const q = encodeURIComponent;
  return async function handleFx(req: Request, rest: string[], url: URL): Promise<Response> {
    const head = rest[0] ?? '';
    // siapa pemanggil? PC = x-fx-key (FX_DEVICE_KEY), AI = x-ach-key (BRIDGE_KEY). Tiap rute hanya untuk satu pihak.
    const devKey = deps.env('FX_DEVICE_KEY'), aiKey = deps.env('BRIDGE_KEY');
    const who = devKey && req.headers.get('x-fx-key') && await deps.safeEqual(req.headers.get('x-fx-key'), devKey) ? 'device'
      : aiKey && req.headers.get('x-ach-key') && await deps.safeEqual(req.headers.get('x-ach-key'), aiKey) ? 'ai' : null;
    const M = req.method;
    const route =
      head === 'state' && M === 'POST' ? 'device:pushState'
      : head === 'state' && M === 'GET' ? 'ai:getState'
      : head === 'command' && M === 'POST' ? 'ai:postCommand'
      : head === 'commands' && M === 'GET' && rest.length === 1 ? (who === 'ai' ? 'ai:listCommands' : 'device:pollCommands')
      : head === 'commands' && M === 'POST' && rest.length === 3 && rest[2] === 'result' ? 'device:postResult'
      : head === 'journal' && M === 'POST' ? 'device:postJournal'
      : head === 'journal' && M === 'GET' ? 'ai:getJournal'
      : null;
    if (!route) return json({ ok: false, error: 'not found' }, 404);
    if (!who || route.split(':')[0] !== who) return json({ ok: false, error: 'unauthorized' }, 401);
    let body: Json = null;
    if (M === 'POST') {
      try { body = await req.json(); } catch { return json({ ok: false, error: 'body harus JSON' }, 400); }
    }
    try {
      switch (route) {
        case 'device:pushState': return json(await pushState(body));
        case 'ai:getState': return json(await getState(url));
        case 'ai:postCommand': return json(await postCommand(body), 201);
        case 'ai:listCommands': return json(await listCommands(url, false));
        case 'device:pollCommands': return json(await listCommands(url, true));
        case 'device:postResult': return json(await postResult(rest[1], body));
        case 'device:postJournal': return json(await postJournal(body), 201);
        case 'ai:getJournal': return json(await getJournal(url));
      }
      return json({ ok: false, error: 'not found' }, 404);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      return json({ ok: false, error: (e as Error).message ?? 'internal' }, status >= 500 ? 500 : status);
    }
  };

  async function pushState(b: Json) {
    const device = deviceOf(b?.device_id);
    const row = { device_id: device, ...validateState(b), updated_at: deps.now().toISOString() };
    const rows = await deps.db('ach_fx_state?on_conflict=device_id&select=device_id,updated_at', {
      method: 'POST', prefer: 'resolution=merge-duplicates,return=representation', body: row,
    });
    return { ok: true, device_id: device, updated_at: rows?.[0]?.updated_at ?? row.updated_at };
  }

  async function getState(url: URL) {
    const device = deviceOf(url.searchParams.get('device'));
    const rows: Json[] = await deps.db(`ach_fx_state?device_id=eq.${q(device)}&select=*`);
    if (!rows.length) return { ok: true, device_id: device, state: null };
    return { ok: true, device_id: device, state: rows[0] };
  }

  async function postCommand(b: Json) {
    const device = deviceOf(b?.device_id);
    const row = validateCommand(b, device, deps.now());
    const rows = await deps.db('ach_fx_commands?select=id,status,expires_at,action,symbol,device_id', {
      method: 'POST', prefer: 'return=representation', body: row,
    });
    return { ok: true, command: rows?.[0] ?? row };
  }

  async function listCommands(url: URL, claim: boolean) {
    const device = deviceOf(url.searchParams.get('device'));
    const recent = !claim;
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || (recent ? 20 : 10), 1), 100);
    let path = `ach_fx_commands?device_id=eq.${q(device)}&order=created_at.desc&limit=${limit}&select=*`;
    if (!recent) {
      const nowIso = deps.now().toISOString();
      // tandai yang kedaluwarsa (best effort) supaya AI melihat statusnya
      try {
        await deps.db(`ach_fx_commands?device_id=eq.${q(device)}&status=eq.pending&expires_at=lte.${q(nowIso)}`, {
          method: 'PATCH', prefer: 'return=minimal',
          body: { status: 'expired', result: { reason: 'kedaluwarsa sebelum diambil PC' }, updated_at: nowIso },
        });
      } catch { /* abaikan */ }
      path += `&status=eq.pending&expires_at=gt.${q(nowIso)}`;
      const rows: Json[] = await deps.db(path);
      if (!rows.length) return { ok: true, device_id: device, commands: [] };
      const ids = rows.map((r) => r.id).join(',');
      const claimed: Json[] = await deps.db(
        `ach_fx_commands?id=in.(${ids})&status=eq.pending&select=*&order=created_at.asc`,
        { method: 'PATCH', prefer: 'return=representation', body: { status: 'executing', updated_at: deps.now().toISOString() } },
      );
      return { ok: true, device_id: device, commands: claimed };
    }
    const rows: Json[] = await deps.db(path);
    return { ok: true, device_id: device, commands: rows };
  }

  async function postResult(id: string, b: Json) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, 'id perintah tidak valid');
    const device = deviceOf(b?.device_id);
    const upd = validateResult(b);
    const rows: Json[] = await deps.db(
      `ach_fx_commands?id=eq.${q(id)}&device_id=eq.${q(device)}&status=eq.executing&select=id,status,result`,
      { method: 'PATCH', prefer: 'return=representation', body: { ...upd, updated_at: deps.now().toISOString() } },
    );
    if (!rows.length) throw new HttpError(409, 'perintah tidak ditemukan / bukan milik device ini / tidak berstatus executing');
    return { ok: true, command: rows[0] };
  }

  async function postJournal(b: Json) {
    const device = deviceOf(b?.device_id);
    const rows = validateJournal(b).map((r) => ({ ...r, device_id: device }));
    await deps.db('ach_fx_journal', { method: 'POST', prefer: 'return=minimal', body: rows });
    return { ok: true, device_id: device, count: rows.length };
  }

  async function getJournal(url: URL) {
    const device = deviceOf(url.searchParams.get('device'));
    const days = Math.min(Math.max(Number(url.searchParams.get('days')) || 7, 1), 90);
    const since = new Date(deps.now().getTime() - days * 86400000).toISOString();
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 200, 1), 1000);
    const rows: Json[] = await deps.db(
      `ach_fx_journal?device_id=eq.${q(device)}&created_at=gte.${q(since)}&order=created_at.desc&limit=${limit}&select=*`);
    return { ok: true, device_id: device, days, count: rows.length, events: rows };
  }
}
