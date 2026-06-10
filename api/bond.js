// Облигация OZON (Озон 1P-02, ISIN RU000A10EXZ9, борд TQCB) — полная аналитика с MOEX ISS.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const SECID = 'RU000A10EXZ9', BOARD = 'TQCB';
  const URL = `https://iss.moex.com/iss/engines/stock/markets/bonds/boards/${BOARD}/securities/${SECID}.json?iss.meta=off`;
  const opts = { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, signal: AbortSignal.timeout(9000) };
  const pad = n => String(n).padStart(2, '0');
  const isoD = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // история цены (дневные свечи, ~60 дней) для графика
  async function history() {
    try {
      const from = isoD(new Date(Date.now() - 60 * 864e5)), till = isoD(new Date());
      const cr = await fetch(`https://iss.moex.com/iss/engines/stock/markets/bonds/securities/${SECID}/candles.json?iss.meta=off&interval=24&from=${from}&till=${till}`, opts);
      if (!cr.ok) return [];
      const cj = await cr.json(); const c = cj?.candles; if (!c?.data?.length) return [];
      const col = {}; c.columns.forEach((x, i) => { col[x] = i; });
      return c.data.map(row => ({ t: String(row[col.begin]).slice(0, 10), v: row[col.close] })).filter(p => p.v != null);
    } catch (_) { return []; }
  }
  try {
    const [r, hist] = await Promise.all([fetch(URL, opts), history()]);
    if (!r.ok) return res.status(502).json({ error: `MOEX HTTP ${r.status}` });
    const j = await r.json();
    const sc = j?.securities, md = j?.marketdata;
    const s = {}, m = {};
    if (sc?.data?.[0]) sc.columns.forEach((c, i) => { s[c] = sc.data[0][i]; });
    if (md?.data?.[0]) md.columns.forEach((c, i) => { m[c] = md.data[0][i]; });

    const face = s.FACEVALUE ?? 1000;
    const last = m.LAST ?? m.LCURRENTPRICE ?? s.PREVPRICE ?? null;     // % от номинала
    const nkd = s.ACCRUEDINT ?? m.ACCRUEDINT ?? null;                  // НКД, ₽
    const durDays = m.DURATION ?? null;
    const out = {
      secid: SECID, isin: SECID, name: s.SHORTNAME || s.SECNAME || 'Облигация OZON', board: BOARD,
      last, change: m.LASTCHANGE ?? null, changePct: m.LASTCHANGEPRCNT ?? null,
      ytm: m.YIELD ?? s.YIELDATPREVWAPRICE ?? null,                    // доходность к погашению, %
      nkd, face, faceUnit: s.FACEUNIT || 'SUR',
      durationDays: durDays, durationYears: durDays != null ? +(durDays / 365).toFixed(2) : null,
      bid: m.BID ?? null, offer: m.OFFER ?? null, waprice: m.WAPRICE ?? null,
      couponPeriod: s.COUPONPERIOD ?? null, couponValue: s.COUPONVALUE ?? null, couponPercent: s.COUPONPERCENT ?? null,
      nextCoupon: s.NEXTCOUPON || null, matDate: s.MATDATE || null, offerDate: s.OFFERDATE || null,
      valToday: m.VALTODAY ?? null, numTrades: m.NUMTRADES ?? null,
      listLevel: s.LISTLEVEL ?? null,
      dirty: (last != null && face != null) ? +((last / 100) * face + (nkd || 0)).toFixed(2) : null,  // грязная цена, ₽
      updateTime: m.UPDATETIME || null, sysTime: m.SYSTIME || null,
      history: hist,
    };
    if (out.last == null && out.ytm == null) return res.status(502).json({ error: 'нет данных по облигации' });

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
    return res.status(200).json({ ...out, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
