// Внутридневная кривая RUSFARREALTIME o/n — свечи MOEX (10-мин интервал).
// Берём последний торговый день в диапазоне (устойчиво к таймзоне Vercel и выходным).
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = new Date();
  const from = iso(new Date(now.getTime() - 4 * 864e5));  // запас на выходные
  const till = iso(new Date(now.getTime() + 1 * 864e5));

  const URL = `https://iss.moex.com/iss/engines/stock/markets/index/securities/RUSFARRT/candles.json`
    + `?iss.meta=off&interval=10&from=${from}&till=${till}`;

  try {
    const r = await fetch(URL, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return res.status(502).json({ error: `MOEX HTTP ${r.status}` });

    const json = await r.json();
    const c = json?.candles;
    if (!c?.columns || !c?.data?.length) {
      return res.status(200).json({ date: null, points: [] });
    }

    const col = {}; c.columns.forEach((x, i) => { col[x] = i; });

    // Последняя торговая дата в выдаче
    let maxDate = '';
    for (const row of c.data) {
      const d = String(row[col.begin]).slice(0, 10);
      if (d > maxDate) maxDate = d;
    }

    const points = c.data
      .filter(row => String(row[col.begin]).slice(0, 10) === maxDate)
      .map(row => ({ t: String(row[col.begin]).slice(11, 16), v: row[col.close] }))
      .filter(p => p.v != null);

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=3600');
    return res.status(200).json({ date: maxDate, points });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
