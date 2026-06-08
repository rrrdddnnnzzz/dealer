// Живые курсы валютных пар.
// Все пары — fxratesapi.com (без ключа, интрадей, работает с серверов Vercel).
// BYN/RUB — MOEX ISS (биржевой), как надёжный «якорь».
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
  const opts = { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(9000) };
  const jget = async url => { const r = await fetch(url, opts); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };

  const mskTime = ts => { // epoch (сек) → ЧЧ:ММ:СС МСК
    try { return new Date(ts * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Moscow' }); }
    catch (_) { return null; }
  };
  const pad = n => String(n).padStart(2, '0');
  const yesterday = () => { const d = new Date(Date.now() - 864e5); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const pct = (cur, prev) => (cur != null && prev != null && prev !== 0) ? +(((cur - prev) / prev) * 100).toFixed(2) : null;

  const FX_KEY = process.env.FXRATES_KEY || process.env.FXRATESAPI_KEY || '';
  // fxratesapi: курсы к USD (currencies — за 1 USD)
  async function fx(date) {
    const base = date ? `https://api.fxratesapi.com/historical?date=${date}&` : 'https://api.fxratesapi.com/latest?';
    const key = FX_KEY ? `&api_key=${FX_KEY}` : '';
    const j = await jget(`${base}base=USD&currencies=RUB,EUR,KZT${key}`);
    const r = j?.rates; if (!r) return null;
    return { rub: r.RUB, eur: r.EUR, kzt: r.KZT, time: mskTime(j.timestamp) };
  }
  // MOEX: только BYN/RUB
  async function moexByn() {
    const url = 'https://iss.moex.com/iss/engines/currency/markets/selt/boards/CETS/securities.json'
      + '?iss.meta=off&iss.only=marketdata&securities=BYNRUB_TOM'
      + '&marketdata.columns=SECID,LAST,LASTTOPREVPRICE,UPDATETIME';
    const j = await jget(url);
    const row = j?.marketdata?.data?.[0];
    if (!row) return null;
    const col = {}; j.marketdata.columns.forEach((c, i) => { col[c] = i; });
    return { last: row[col.LAST], pct: row[col.LASTTOPREVPRICE], time: row[col.UPDATETIME] };
  }

  try {
    // historical (для %) запрашиваем только при наличии ключа — бережём лимит без ключа
    const [now, prev, byn] = await Promise.all([
      fx(null).catch(() => null),
      FX_KEY ? fx(yesterday()).catch(() => null) : Promise.resolve(null),
      moexByn().catch(() => null),
    ]);

    const pairs = [];
    const t = now?.time;

    if (now?.rub != null) {
      pairs.push({ pair: 'USD/RUB', val: +now.rub.toFixed(4), pct: pct(now.rub, prev?.rub), dec: 2, src: 'FX', time: t });
      if (now.eur) pairs.push({ pair: 'EUR/RUB', val: +(now.rub / now.eur).toFixed(4), pct: pct(now.rub / now.eur, (prev?.rub && prev?.eur) ? prev.rub / prev.eur : null), dec: 2, src: 'FX', time: t });
      if (now.kzt) pairs.push({ pair: 'KZT/RUB', val: +(now.rub / now.kzt).toFixed(4), pct: pct(now.rub / now.kzt, (prev?.rub && prev?.kzt) ? prev.rub / prev.kzt : null), dec: 4, src: 'FX', time: t });
    }

    if (byn?.last != null)
      pairs.push({ pair: 'BYN/RUB', val: byn.last, pct: byn.pct, dec: 2, src: 'MOEX', time: byn.time });

    if (now?.kzt != null) {
      pairs.push({ pair: 'USD/KZT', val: +now.kzt.toFixed(2), pct: pct(now.kzt, prev?.kzt), dec: 2, src: 'FX', time: t });
      if (now.eur) pairs.push({ pair: 'EUR/KZT', val: +(now.kzt / now.eur).toFixed(2), pct: pct(now.kzt / now.eur, (prev?.kzt && prev?.eur) ? prev.kzt / prev.eur : null), dec: 2, src: 'FX', time: t });
    }

    if (!pairs.length) return res.status(502).json({ error: 'нет данных по парам' });

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=600');
    return res.status(200).json({ pairs, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
