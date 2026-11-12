// TTM: watches the TRON blockchain for USDT (TRC20) arriving at the TTM deposit address and activates the matching member.
// Needs no exchange login. It only READS public blockchain data. Optional secret TRONGRID_KEY (free from trongrid.io) for higher limits.
// Deploy: Supabase Dashboard -> Edge Functions -> Deploy a new function -> name usdt-check -> paste this file -> turn OFF "Verify JWT".
const URL_ = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const TG = Deno.env.get('TRONGRID_KEY') || '';
const USDT = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

async function rest(path: string, opt: RequestInit = {}) {
  const r = await fetch(URL_ + path, { ...opt, headers: { ...H, ...(opt.headers || {}) } });
  const t = await r.text();
  let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { /* ignore */ }
  return { ok: r.ok, status: r.status, json: j, text: t };
}

Deno.serve(async () => {
  const out: any = { seen: 0, applied: 0, unmatched: 0 };
  try {
    const b = await rest('/rest/v1/ttm_billing?id=eq.main&select=cfg');
    const addr = b.json && b.json[0] && b.json[0].cfg && b.json[0].cfg.address;
    if (!addr) return new Response(JSON.stringify({ error: 'no address set' }), { status: 200 });
    const since = Date.now() - 6 * 3600e3;
    const tr = await fetch(`https://api.trongrid.io/v1/accounts/${addr}/transactions/trc20?only_to=true&only_confirmed=true&limit=100&contract_address=${USDT}&min_timestamp=${since}`,
      { headers: TG ? { 'TRON-PRO-API-KEY': TG } : {} });
    if (!tr.ok) return new Response(JSON.stringify({ error: 'trongrid ' + tr.status }), { status: 200 });
    const items: any[] = ((await tr.json()).data) || [];
    for (const t of items) {
      if (!t.token_info || t.token_info.address !== USDT || t.to !== addr) continue;
      const txid = t.transaction_id as string;
      const amount = Number(t.value) / Math.pow(10, Number(t.token_info.decimals || 6));
      const when = new Date(t.block_timestamp);
      out.seen++;
      const have = await rest(`/rest/v1/ttm_payments?txid=eq.${txid}&select=txid`);
      if (have.ok && have.json && have.json.length) continue;
      if (amount < 5) continue;                                  // ignore dust / spam transfers
      const cents = Math.round(amount * 100);
      let order: any = null;
      if (Math.abs(amount * 100 - cents) < 1e-6) {               // exactly 2 decimals, like our unique amounts
        const a = (cents / 100).toFixed(2);
        const lo = new Date(when.getTime() - 10 * 60e3).toISOString(), hi = when.toISOString();
        const m = await rest(`/rest/v1/ttm_orders?status=in.(open,expired)&amount=eq.${a}&created_at=lte.${hi}&expires_at=gte.${lo}&order=created_at.desc&limit=1&select=id`);
        if (m.ok && m.json && m.json[0]) order = m.json[0];
      }
      if (order) {
        const r = await rest('/rest/v1/rpc/ttm_activate_order', { method: 'POST', body: JSON.stringify({ p_order: order.id, p_txid: txid, p_from: t.from, p_amount: amount, p_time: when.toISOString() }) });
        if (r.ok) { out.applied++; continue; }
      }
      await rest('/rest/v1/ttm_payments?on_conflict=txid', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({ txid, from_addr: t.from, amount, tx_time: when.toISOString(), status: 'unmatched', note: 'no matching order' }),
      });
      out.unmatched++;
    }
  } catch (e) { out.error = String(e); }
  return new Response(JSON.stringify(out), { headers: { 'Content-Type': 'application/json' } });
});
