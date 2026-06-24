// Свечи CNYRUB (валютный рынок MOEX) — для собственного live-графика.
// Тот же источник ISS, без сторонних виджетов. Параметры: ?secid=&interval=
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // разбор query (надёжно через req.url)
  let secidParam = null, intervalParam = null;
  try {
    const u = new URL(req.url, 'http://x');
    secidParam = u.searchParams.get('secid');
    intervalParam = u.searchParams.get('interval');
  } catch (_) {}

  const ALLOWED = { 'CNY000000TOD': 1, 'CNYRUB_TOM': 1 };
  const secid = ALLOWED[secidParam] ? secidParam : 'CNY000000TOD';

  // MOEX-интервалы: 1=1мин, 10=10мин, 60=1час, 24=1день
  const INTERVALS = { '1': 1, '10': 10, '60': 60, '24': 24 };
  const interval = INTERVALS[intervalParam] || 10;

  // глубина истории под интервал
  const backDays = interval === 1 ? 1 : interval === 10 ? 4 : interval === 60 ? 12 : 160;

  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = new Date();
  const from = iso(new Date(now.getTime() - backDays * 864e5));
  const till = iso(new Date(now.getTime() + 1 * 864e5));

  const base = `https://iss.moex.com/iss/engines/currency/markets/selt/securities/${secid}/candles.json`
    + `?iss.meta=off&interval=${interval}&from=${from}&till=${till}`;

  // ISS отдаёт максимум 500 свечей с начала диапазона — листаем до конца,
  // чтобы получить самые свежие (важно для 1-мин интервала).
  async function page(start) {
    const r = await fetch(`${base}&start=${start}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) throw new Error(`MOEX HTTP ${r.status}`);
    const json = await r.json();
    const c = json?.candles;
    if (!c?.columns) return { col: null, rows: [] };
    const col = {}; c.columns.forEach((x, i) => { col[x] = i; });
    return { col, rows: c.data || [] };
  }

  try {
    let all = [], col = null, start = 0, got;
    do {
      const p = await page(start);
      if (!col) col = p.col;
      got = p.rows.length;
      all = all.concat(p.rows);
      start += 500;
    } while (got === 500 && start < 6000);   // защита от бесконечного цикла

    if (!col || !all.length) {
      return res.status(200).json({ secid, interval, candles: [] });
    }

    let candles = all.map(row => ({
      t: String(row[col.begin]),
      o: row[col.open], h: row[col.high], l: row[col.low], c: row[col.close],
    })).filter(k => k.c != null);

    // последние ~90 свечей
    if (candles.length > 90) candles = candles.slice(-90);

    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=3600');
    return res.status(200).json({ secid, interval, candles });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
