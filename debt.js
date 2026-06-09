// Акция OZON — рынок акций MOEX (engine stock, market shares, board TQBR).
// Те же данные, что на www.moex.com/ru/stocks/ozon. Возвращает котировку + точки для спарклайна.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const SECID = 'OZON';
  const MD_URL = `https://iss.moex.com/iss/engines/stock/markets/shares/boards/TQBR/securities/${SECID}.json`
    + '?iss.meta=off&iss.only=securities,marketdata'
    + '&securities.columns=SECID,SHORTNAME,SECNAME,PREVPRICE,PREVDATE,LOTSIZE,DECIMALS'
    + '&marketdata.columns=SECID,LAST,OPEN,HIGH,LOW,BID,OFFER,LASTTOPREVPRICE,CHANGE,WAPRICE,VALTODAY_RUR,VOLTODAY,NUMTRADES,ISSUECAPITALIZATION,UPDATETIME,SYSTIME,TRADINGSTATUS';

  // свечи для спарклайна (10-мин, последний торговый день)
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = new Date();
  const from = iso(new Date(now.getTime() - 4 * 864e5));
  const till = iso(new Date(now.getTime() + 1 * 864e5));
  const CANDLE_URL = `https://iss.moex.com/iss/engines/stock/markets/shares/securities/${SECID}/candles.json`
    + `?iss.meta=off&interval=10&from=${from}&till=${till}`;

  const opts = { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, signal: AbortSignal.timeout(9000) };

  try {
    const [mdRes, cRes] = await Promise.allSettled([
      fetch(MD_URL, opts).then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))),
      fetch(CANDLE_URL, opts).then(r => r.ok ? r.json() : null),
    ]);

    if (mdRes.status !== 'fulfilled') {
      return res.status(502).json({ error: `MOEX: ${mdRes.reason?.message || 'нет данных'}` });
    }
    const json = mdRes.value;
    const sc = json?.securities, md = json?.marketdata;
    if (!md?.columns || !md?.data?.length) return res.status(502).json({ error: 'MOEX не вернул marketdata' });

    const s = {}; if (sc?.data?.[0]) sc.columns.forEach((c, i) => { s[c] = sc.data[0][i]; });
    const m = {}; md.columns.forEach((c, i) => { m[c] = md.data[0][i]; });

    const prev = s.PREVPRICE;
    const quote = {
      secid: SECID,
      name: s.SECNAME || s.SHORTNAME || 'OZON',
      last: m.LAST,
      open: m.OPEN, high: m.HIGH, low: m.LOW,
      bid: m.BID, offer: m.OFFER,
      changePct: m.LASTTOPREVPRICE,
      change: (m.CHANGE != null) ? m.CHANGE : (m.LAST != null && prev != null ? +(m.LAST - prev).toFixed(2) : null),
      prev,
      waprice: m.WAPRICE,
      valToday: m.VALTODAY_RUR,
      volToday: m.VOLTODAY,
      numTrades: m.NUMTRADES,
      cap: m.ISSUECAPITALIZATION,
      updateTime: m.UPDATETIME,
      sysTime: m.SYSTIME,
      status: m.TRADINGSTATUS,
      tradeDate: s.PREVDATE,
    };

    // спарклайн
    let spark = [];
    if (cRes.status === 'fulfilled' && cRes.value?.candles?.data?.length) {
      const c = cRes.value.candles;
      const col = {}; c.columns.forEach((x, i) => { col[x] = i; });
      let maxDate = '';
      for (const row of c.data) { const d = String(row[col.begin]).slice(0, 10); if (d > maxDate) maxDate = d; }
      spark = c.data
        .filter(row => String(row[col.begin]).slice(0, 10) === maxDate)
        .map(row => ({ t: String(row[col.begin]).slice(11, 16), v: row[col.close] }))
        .filter(p => p.v != null);
    }

    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');
    return res.status(200).json({ quote, spark, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
