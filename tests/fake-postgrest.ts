// PostgREST tiruan (in-memory) untuk tes lokal ach-bridge. Hanya mendukung query yang dipakai fungsi.
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
/* ---------------- fake PostgREST ---------------- */
export class FakeDb {
  tables: Record<string, Row[]> = { ach_inbox: [], ach_outbox: [], ach_tg_allow: [], ach_tg_chats: [], ach_agents: [], ach_tasks: [] };
  seq: Record<string, number> = { ach_inbox: 0, ach_outbox: 0 };
  rpc: Row[] = [];
  keys: Record<string, string[]> = { ach_inbox: ['bot', 'update_id'], ach_tg_allow: ['from_id'], ach_tg_chats: ['bot', 'chat_id'] };
  handle(url: URL, method: string, prefer: string, body: unknown): Response {
    const path = url.pathname.replace(/^\/rest\/v1\//, '');
    if (path.startsWith('rpc/')) { this.rpc.push(body as Row); return Response.json({ ok: true, agent_id: (body as Row).p_agent_id }); }
    const t = this.tables[path];
    if (!t) return Response.json({ message: 'relation does not exist' }, { status: 404 });
    const filters: [string, string][] = [];
    let order: string | null = null, limit = Infinity, onConflict: string[] | null = null;
    for (const [k, v] of url.searchParams) {
      if (k === 'select') continue;
      else if (k === 'order') order = v;
      else if (k === 'limit') limit = Number(v);
      else if (k === 'on_conflict') onConflict = v.split(',');
      else filters.push([k, v]);
    }
    const match = (r: Row) => filters.every(([k, v]) => {
      const val = r[k] === null || r[k] === undefined ? 'null' : String(r[k]);
      if (v.startsWith('eq.')) return val === v.slice(3);
      if (v.startsWith('in.(')) return v.slice(4, -1).split(',').map((s) => s.replace(/^"|"$/g, '')).includes(val);
      throw new Error('filter tak didukung: ' + v);
    });
    const rep = prefer.includes('return=representation');
    if (method === 'GET') {
      let rows = t.filter(match);
      if (order) {
        const [col, dir] = order.split(',')[0].split('.');
        rows = [...rows].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
      }
      return Response.json(rows.slice(0, limit));
    }
    if (method === 'POST') {
      const items = (Array.isArray(body) ? body : [body]) as Row[];
      const out: Row[] = [];
      for (const it of items) {
        const keys = onConflict ?? this.keys[path] ?? [];
        const dup = keys.length && keys.every((k) => it[k] !== null && it[k] !== undefined) ? t.find((r) => keys.every((k) => String(r[k]) === String(it[k]))) : undefined;
        if (dup) {
          if (prefer.includes('merge-duplicates')) { Object.assign(dup, it); out.push(dup); }
          else if (prefer.includes('ignore-duplicates')) continue;
          else return Response.json({ message: 'duplicate key' }, { status: 409 });
        } else {
          const row: Row = { ...it };
          if (path in this.seq) row.id = ++this.seq[path];
          row.created_at ??= new Date().toISOString();
          if (path === 'ach_inbox') row.status ??= 'baru';
          t.push(row); out.push(row);
        }
      }
      return rep ? Response.json(out, { status: 201 }) : new Response(null, { status: 201 });
    }
    if (method === 'PATCH') {
      const rows = t.filter(match);
      for (const r of rows) Object.assign(r, body);
      return rep ? Response.json(rows) : new Response(null, { status: 204 });
    }
    return new Response('?', { status: 405 });
  }
}

