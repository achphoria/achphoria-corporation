// PostgREST tiruan (in-memory) untuk tes lokal ach-bridge. Hanya mendukung query yang dipakai fungsi.
// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
/* ---------------- fake PostgREST ---------------- */
export class FakeDb {
  tables: Record<string, Row[]> = { ach_inbox: [], ach_outbox: [], ach_tg_allow: [], ach_tg_chats: [], ach_agents: [], ach_tasks: [], ach_tg_logmsg: [], ach_erp_audit: [] };
  seq: Record<string, number> = { ach_inbox: 0, ach_outbox: 0, ach_erp_audit: 0 };
  rpc: Row[] = [];
  /** Panggilan RPC ERP (v5) + jawaban tiruan: fungsi (body) → {status, json}. */
  erpCalls: { fn: string; body: Row }[] = [];
  erp: Record<string, (b: Row) => { status: number; json: unknown }> = {
    ach_erp_query: (b) => ({ status: 200, json: { columns: ['n'], rows: [{ n: 3 }], row_count: 1, truncated: false, max_rows: b.p_max_rows } }),
    ach_erp_schema: () => ({ status: 200, json: [{ table: 'pos_orders', kind: 'table', restricted: true, columns: [{ name: 'id', type: 'uuid' }] }] }),
  };
  keys: Record<string, string[]> = { ach_inbox: ['bot', 'update_id'], ach_tg_allow: ['from_id'], ach_tg_chats: ['bot', 'chat_id'], ach_tg_logmsg: ['task_id', 'chat_id'] };
  handle(url: URL, method: string, prefer: string, body: unknown): Response {
    const path = url.pathname.replace(/^\/rest\/v1\//, '');
    if (path.startsWith('rpc/ach_erp_')) {
      const fn = path.slice(4);
      this.erpCalls.push({ fn, body: body as Row });
      const r = this.erp[fn]?.(body as Row) ?? { status: 404, json: { message: 'function not found' } };
      return Response.json(r.json, { status: r.status });
    }
    if (path.startsWith('rpc/')) return this.reportActivity(body as Row);
    const t = this.tables[path];
    if (path === 'ach_tasks') for (const r of t) r.id ??= crypto.randomUUID();
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
      if (v.startsWith('eq.')) return val === decodeURIComponent(v.slice(3));
      if (v === 'is.null') return val === 'null';
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
  /** Tiruan ringkas ach_report_activity: catat argumen, perbarui/buat tugas, kembalikan task_id. */
  reportActivity(b: Row): Response {
    this.rpc.push(b);
    let taskId: string | null = null;
    const task = b.p_task ? String(b.p_task).trim() : '';
    if (task) {
      const st = b.p_task_status || 'Sedang kerja';
      const mine = this.tables.ach_tasks.filter((t) => t.agent_id === b.p_agent_id && String(t.title).toLowerCase() === task.toLowerCase())
        .sort((x, y) => Number(x.status === 'Selesai') - Number(y.status === 'Selesai'));
      if (mine.length) { mine[0].id ??= crypto.randomUUID(); mine[0].status = st; mine[0].updated_at = new Date().toISOString(); taskId = mine[0].id; }
      else { taskId = crypto.randomUUID(); this.tables.ach_tasks.push({ id: taskId, agent_id: b.p_agent_id, title: task, status: st, updated_at: new Date().toISOString() }); }
    }
    const a = this.tables.ach_agents.find((x) => x.id === b.p_agent_id);
    if (a) {
      if (b.p_status) a.status = b.p_status;
      if (b.p_location !== null && b.p_location !== undefined) a.location = b.p_location === '' ? null : b.p_location;
      if (b.p_activity !== null && b.p_activity !== undefined) a.activity = b.p_activity;
    }
    return Response.json({ ok: true, agent_id: b.p_agent_id, task_id: taskId, log_id: null });
  }
}

