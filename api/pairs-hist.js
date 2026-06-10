// Историческая дневная динамика валютных пар (~30 дней) для мини-тренда в плашках.
// USD/RUB, EUR/RUB, KZT/RUB, USD/KZT, EUR/KZT — fxratesapi /timeseries (один запрос).
// BYN/RUB — дневные свечи MOEX ISS.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
  const opts = { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(9000) };
  const FX_KEY = process.env.FXRATES_KEY || process.env.FXRATESAPI_KEY || '';
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const days = Math.min(120, Math.max(7, parseInt((new URL(req.url, 'http://x')).searchParams.get('days')) || 30));
  const start = iso(new Date(Date.now() - days * 864e5));
  const end = iso(new Date());

  async function fxSeries() {
    try {
      const key = FX_KEY ? `&api_key=${FX_KEY}` : '';
      const r = await fetch(`https://api.fxratesapi.com/timeseries?start_date=${start}&end_date=${end}&base=USD&currencies=RUB,EUR,KZT${key}`, opts);
      if (!r.ok) return null;
      const j = await r.json(); const rates = j?.rates; if (!rates) return null;
      const keys = Object.keys(rates).sort();
      const out = { 'USD/RUB': [], 'EUR/RUB': [], 'KZT/RUB': [], 'USD/KZT': [], 'EUR/KZT': [] };
      for (const k of keys) {
        const x = rates[k]; if (!x || x.RUB == null) continue;
        out['USD/RUB'].push(+x.RUB.toFixed(4));
        if (x.EUR) out['EUR/RUB'].push(+(x.RUB / x.EUR).toFixed(4));
        if (x.KZT) out['KZT/RUB'].push(+(x.RUB / x.KZT).toFixed(5));
        if (x.KZT) out['USD/KZT'].push(+x.KZT.toFixed(3));
        if (x.KZT && x.EUR) out['EUR/KZT'].push(+(x.KZT / x.EUR).toFixed(3));
      }
      return out;
    } catch (_) { return null; }
  }
  async function bynSeries() {
    try {
      const from = iso(new Date(Date.now() - (days + 15) * 864e5));
      const r = await fetch(`https://iss.moex.com/iss/engines/currency/markets/selt/securities/BYNRUB_TOM/candles.json?iss.meta=off&interval=24&from=${from}&till=${end}`, opts);
      if (!r.ok) return null;
      const j = await r.json(); const c = j?.candles; if (!c?.data?.length) return null;
      const col = {}; c.columns.forEach((x, i) => { col[x] = i; });
      return c.data.map(row => row[col.close]).filter(v => v != null).slice(-days);
    } catch (_) { return null; }
  }

  try {
    const [fx, byn] = await Promise.all([fxSeries(), bynSeries()]);
    const history = {};
    if (fx) Object.assign(history, fx);
    if (byn) history['BYN/RUB'] = byn;
    if (!Object.keys(history).length) return res.status(502).json({ error: 'нет истории' });
    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ history, days, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
