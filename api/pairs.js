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
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // последний торговый день (пропускаем выходные) — для расчёта изменения «к пред. закрытию»
  const prevBiz = () => { const d = new Date(); do { d.setDate(d.getDate() - 1); } while (d.getDay() === 0 || d.getDay() === 6); return iso(d); };
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
  // MOEX: только BYN/RUB (с фоллбэком на закрытие пред. дня, когда нет торгов)
  async function moexByn() {
    const url = 'https://iss.moex.com/iss/engines/currency/markets/selt/boards/CETS/securities.json'
      + '?iss.meta=off&iss.only=securities,marketdata&securities=BYNRUB_TOM'
      + '&securities.columns=SECID,PREVPRICE,PREVDATE'
      + '&marketdata.columns=SECID,LAST,LASTTOPREVPRICE,UPDATETIME';
    const j = await jget(url);
    const md = j?.marketdata, sc = j?.securities;
    const row = md?.data?.[0];
    if (!row) return null;
    const col = {}; md.columns.forEach((c, i) => { col[c] = i; });
    const scol = {}; (sc?.columns || []).forEach((c, i) => { scol[c] = i; });
    const srow = sc?.data?.[0] || [];
    const prev = srow[scol.PREVPRICE], prevDate = srow[scol.PREVDATE];
    const live = row[col.LAST] != null;                 // идут ли торги
    return { last: row[col.LAST] ?? prev, live, pct: row[col.LASTTOPREVPRICE], time: row[col.UPDATETIME], prevDate };
  }

  try {
    // latest + закрытие предыдущего торгового дня (для изменения %) + MOEX BYN
    const [now, prev, byn] = await Promise.all([
      fx(null).catch(() => null),
      fx(prevBiz()).catch(() => null),
      moexByn().catch(() => null),
    ]);

    const pairs = [];
    const t = now?.time;

    if (now?.rub != null) {
      pairs.push({ pair: 'USD/RUB', val: +now.rub.toFixed(4), pct: pct(now.rub, prev?.rub), dec: 2, src: 'FX', time: t });
      if (now.eur) pairs.push({ pair: 'EUR/RUB', val: +(now.rub / now.eur).toFixed(4), pct: pct(now.rub / now.eur, (prev?.rub && prev?.eur) ? prev.rub / prev.eur : null), dec: 2, src: 'FX', time: t });
      if (now.kzt) pairs.push({ pair: 'KZT/RUB', val: +(now.rub / now.kzt).toFixed(4), pct: pct(now.rub / now.kzt, (prev?.rub && prev?.kzt) ? prev.rub / prev.kzt : null), dec: 4, src: 'FX', time: t });
    }

    if (byn?.last != null) {
      const dm = byn.prevDate ? byn.prevDate.slice(5).split('-').reverse().join('.') : '';
      pairs.push({ pair: 'BYN/RUB', val: byn.last, pct: byn.live ? byn.pct : null, dec: 2, src: 'MOEX',
        time: byn.live ? byn.time : `закрытие ${dm}` });
    }

    if (now?.kzt != null) {
      pairs.push({ pair: 'USD/KZT', val: +now.kzt.toFixed(2), pct: pct(now.kzt, prev?.kzt), dec: 2, src: 'FX', time: t });
      if (now.eur) pairs.push({ pair: 'EUR/KZT', val: +(now.kzt / now.eur).toFixed(2), pct: pct(now.kzt / now.eur, (prev?.kzt && prev?.eur) ? prev.kzt / prev.eur : null), dec: 2, src: 'FX', time: t });
    }

    if (!pairs.length) return res.status(502).json({ error: 'нет данных по парам' });

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=3600');
    return res.status(200).json({ pairs, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
