// Долговой рынок: кривая бескупонной доходности ОФЗ (ZCYC), индекс RGBI, ставка RUONIA (ЦБ).
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
  const opts = { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(9000) };
  const jget = async url => { const r = await fetch(url, opts); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };

  // ── ОФЗ G-curve (бескупонная доходность) ──
  async function ofz() {
    const j = await jget('https://iss.moex.com/iss/engines/stock/zcyc.json?iss.meta=off&iss.only=yearyields');
    const yy = j?.yearyields; if (!yy?.data?.length) return null;
    const col = {}; yy.columns.forEach((c, i) => { col[c] = i; });
    const pts = yy.data.map(r => ({ y: r[col.period], v: r[col.value] })).filter(p => p.v != null);
    const tradetime = yy.data[0]?.[col.tradetime];
    const tradedate = yy.data[0]?.[col.tradedate];
    return { points: pts, time: tradetime, date: tradedate };
  }
  // ── RGBI индекс ──
  async function rgbi() {
    const j = await jget('https://iss.moex.com/iss/engines/stock/markets/index/securities/RGBI.json?iss.meta=off&iss.only=marketdata&marketdata.columns=SECID,CURRENTVALUE,LASTVALUE,LASTCHANGEPRC,UPDATETIME');
    const row = j?.marketdata?.data?.[0]; if (!row) return null;
    const c = {}; j.marketdata.columns.forEach((k, i) => { c[k] = i; });
    return { value: row[c.CURRENTVALUE] ?? row[c.LASTVALUE], changePrc: row[c.LASTCHANGEPRC], time: row[c.UPDATETIME] };
  }
  // ── RUONIA (ЦБ SOAP) ──
  async function ruonia() {
    const pad = n => String(n).padStart(2, '0');
    const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">`
      + `<soap:Body><Ruonia xmlns="http://web.cbr.ru/"><fromDate>${iso(new Date(Date.now() - 20 * 864e5))}</fromDate><ToDate>${iso(new Date())}</ToDate></Ruonia></soap:Body></soap:Envelope>`;
    const r = await fetch('https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx', {
      method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'http://web.cbr.ru/Ruonia', 'User-Agent': UA },
      body, signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return null;
    const xml = await r.text();
    const rows = [...xml.matchAll(/<D0>([^<]+)<\/D0>\s*<ruo>([^<]+)<\/ruo>(?:\s*<vol>([^<]+)<\/vol>)?/g)];
    if (!rows.length) return null;
    let latest = null;
    for (const m of rows) { const dt = m[1]; if (!latest || dt > latest.dt) latest = { dt, rate: parseFloat(m[2]), vol: m[3] ? parseFloat(m[3]) : null }; }
    return { rate: +latest.rate.toFixed(2), date: latest.dt.slice(0, 10), vol: latest.vol };
  }

  try {
    const [o, r, ru] = await Promise.all([ofz().catch(() => null), rgbi().catch(() => null), ruonia().catch(() => null)]);
    if (!o && !r && !ru) return res.status(502).json({ error: 'нет данных долгового рынка' });
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=3600');
    return res.status(200).json({ ofz: o, rgbi: r, ruonia: ru, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
