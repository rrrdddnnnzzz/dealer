// Живые курсы валютных пар.
// USD/RUB, EUR/RUB, USD/KZT, EUR/KZT — Yahoo Finance (без ключа, ~раз в минуту).
// KZT/RUB — кросс USDRUB / USDKZT. BYN/RUB — MOEX ISS (биржевой, живой).
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
  const opts = { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: AbortSignal.timeout(9000) };

  // ── Yahoo: цена + предыдущее закрытие ──
  async function yahoo(sym) {
    const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
    for (const h of hosts) {
      try {
        const r = await fetch(`https://${h}/v8/finance/chart/${sym}?interval=1d&range=1d`, opts);
        if (!r.ok) continue;
        const j = await r.json();
        const m = j?.chart?.result?.[0]?.meta;
        if (m && m.regularMarketPrice != null) {
          return { price: m.regularMarketPrice, prev: m.chartPreviousClose ?? m.previousClose ?? null, time: m.regularMarketTime || null };
        }
      } catch (_) {}
    }
    return null;
  }

  // ── MOEX: BYNRUB_TOM ──
  async function moexByn() {
    try {
      const url = 'https://iss.moex.com/iss/engines/currency/markets/selt/boards/CETS/securities.json'
        + '?iss.meta=off&iss.only=marketdata&securities=BYNRUB_TOM'
        + '&marketdata.columns=SECID,LAST,LASTTOPREVPRICE,UPDATETIME';
      const r = await fetch(url, opts);
      if (!r.ok) return null;
      const j = await r.json();
      const row = j?.marketdata?.data?.[0];
      if (!row) return null;
      const col = {}; j.marketdata.columns.forEach((c, i) => { col[c] = i; });
      const last = row[col.LAST];
      if (last == null) return null;
      return { price: last, pct: row[col.LASTTOPREVPRICE], time: row[col.UPDATETIME] };
    } catch (_) { return null; }
  }

  const pctFrom = (cur, prev) => (cur != null && prev != null && prev !== 0) ? +(((cur - prev) / prev) * 100).toFixed(2) : null;
  // epoch (сек) → ЧЧ:ММ:СС по Москве
  const hhmm = epoch => {
    if (!epoch) return null;
    try {
      return new Date(epoch * 1000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Moscow' });
    } catch (_) { return null; }
  };

  try {
    const [usdrub, eurrub, usdkzt, eurkzt, byn] = await Promise.all([
      yahoo('USDRUB=X'), yahoo('EURRUB=X'), yahoo('USDKZT=X'), yahoo('EURKZT=X'), moexByn(),
    ]);

    // кросс KZT/RUB = USDRUB / USDKZT
    let kztrub = null;
    if (usdrub?.price && usdkzt?.price) {
      const cur = usdrub.price / usdkzt.price;
      const prev = (usdrub.prev && usdkzt.prev) ? usdrub.prev / usdkzt.prev : null;
      kztrub = { price: +cur.toFixed(4), pct: pctFrom(cur, prev), time: hhmm(Math.max(usdrub.time || 0, usdkzt.time || 0)) };
    }

    const pairs = [
      usdrub && { pair: 'USD/RUB', val: usdrub.price, pct: pctFrom(usdrub.price, usdrub.prev), dec: 2, src: 'Yahoo', time: hhmm(usdrub.time) },
      eurrub && { pair: 'EUR/RUB', val: eurrub.price, pct: pctFrom(eurrub.price, eurrub.prev), dec: 2, src: 'Yahoo', time: hhmm(eurrub.time) },
      kztrub  && { pair: 'KZT/RUB', val: kztrub.price, pct: kztrub.pct, dec: 4, src: 'кросс', time: kztrub.time },
      byn     && { pair: 'BYN/RUB', val: byn.price, pct: byn.pct, dec: 2, src: 'MOEX', time: byn.time },
      usdkzt  && { pair: 'USD/KZT', val: usdkzt.price, pct: pctFrom(usdkzt.price, usdkzt.prev), dec: 2, src: 'Yahoo', time: hhmm(usdkzt.time) },
      eurkzt  && { pair: 'EUR/KZT', val: eurkzt.price, pct: pctFrom(eurkzt.price, eurkzt.prev), dec: 2, src: 'Yahoo', time: hhmm(eurkzt.time) },
    ].filter(Boolean);

    if (!pairs.length) return res.status(502).json({ error: 'нет данных по парам' });

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({ pairs, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
