// CNYRUB TOD/TOM — валютный рынок MOEX (engine currency, market selt, board CETS).
// Те же данные, что на www.moex.com/ru/issue/CNYRUB_TOM/CETS и /CNY000000TOD/CETS.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ВАЖНО: SECID для TOD на бирже = CNY000000TOD (shortname CNYRUB_TOD)
  const TOD = 'CNY000000TOD';
  const TOM = 'CNYRUB_TOM';

  const URL = 'https://iss.moex.com/iss/engines/currency/markets/selt/boards/CETS/securities.json'
    + '?iss.meta=off&iss.only=securities,marketdata'
    + `&securities=${TOM},${TOD}`
    + '&securities.columns=SECID,SHORTNAME,PREVPRICE,PREVDATE'
    + '&marketdata.columns=SECID,LAST,OPEN,HIGH,LOW,LASTTOPREVPRICE,UPDATETIME,SYSTIME,TRADINGSTATUS';

  try {
    const r = await fetch(URL, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return res.status(502).json({ error: `MOEX HTTP ${r.status}` });

    const json = await r.json();
    const sc = json?.securities, md = json?.marketdata;
    if (!md?.columns) return res.status(502).json({ error: 'MOEX не вернул marketdata' });

    const sCol = {}; (sc?.columns || []).forEach((c, i) => { sCol[c] = i; });
    const prevMap = {}, prevDateMap = {};
    for (const row of (sc?.data || [])) {
      prevMap[row[sCol.SECID]] = row[sCol.PREVPRICE];
      prevDateMap[row[sCol.SECID]] = row[sCol.PREVDATE];
    }

    const mCol = {}; md.columns.forEach((c, i) => { mCol[c] = i; });
    const pick = secid => {
      const row = md.data.find(x => x[mCol.SECID] === secid);
      if (!row) return null;
      const o = {}; md.columns.forEach((c, i) => { o[c] = row[i]; });
      const prev = prevMap[secid];
      const live = o.LAST != null;                 // есть живая котировка (идут торги)
      return {
        secid,
        last:       o.LAST ?? prev,                 // нет торгов → закрытие пред. дня
        live,
        open:       o.OPEN,
        high:       o.HIGH,
        low:        o.LOW,
        prev,
        changePct:  o.LASTTOPREVPRICE,
        change:     (o.LAST != null && prev != null) ? +(o.LAST - prev).toFixed(4) : null,
        updateTime: o.UPDATETIME,
        sysTime:    o.SYSTIME,
        status:     o.TRADINGSTATUS,
      };
    };

    const tod = pick(TOD);
    const tom = pick(TOM);
    if (!tod && !tom) return res.status(502).json({ error: 'CNYRUB не найден в выдаче' });

    const spread = (tom?.last != null && tod?.last != null)
      ? +(tom.last - tod.last).toFixed(4) : null;
    const anyLive = (tod && tod.live) || (tom && tom.live);   // идут ли торги
    const asOfDate = prevDateMap[TOM] || prevDateMap[TOD] || null;

    res.setHeader('Cache-Control', 's-maxage=20, stale-while-revalidate=40');
    return res.status(200).json({
      tod, tom, spread,
      closed:       !anyLive,                       // true → показаны цены закрытия
      asOfDate,                                     // дата закрытия (YYYY-MM-DD)
      exchangeTime: tom?.updateTime || tod?.updateTime || null,
      sysTime:      tom?.sysTime || tod?.sysTime || null,
      fetchedAt:    new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
