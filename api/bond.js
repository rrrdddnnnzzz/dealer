// Облигация OZON (Озон 1P-02, ISIN RU000A10EXZ9, борд TQCB) — полная аналитика с MOEX ISS.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const SECID = 'RU000A10EXZ9', BOARD = 'TQCB';
  const URL = `https://iss.moex.com/iss/engines/stock/markets/bonds/boards/${BOARD}/securities/${SECID}.json?iss.meta=off`;
  try {
    const r = await fetch(URL, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }, signal: AbortSignal.timeout(9000) });
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
    };
    if (out.last == null && out.ytm == null) return res.status(502).json({ error: 'нет данных по облигации' });

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
    return res.status(200).json({ ...out, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
