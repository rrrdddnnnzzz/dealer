// RUSFAR data proxy — тянет живые данные с MOEX ISS (борд MMIX).
// Значения берём из CURRENTVALUE — ровно то, что показывает сайт moex.com/msn/ru-rusfar.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Реальные SECID на бирже. ON-фикс = RUSFAR, реалтайм o/n = RUSFARRT.
  const SECIDS = ['RUSFAR', 'RUSFARRT', 'RUSFAR1W', 'RUSFAR2W', 'RUSFAR1M', 'RUSFAR3M'];
  const TERM = {
    RUSFAR: 'ON', RUSFARRT: 'RT',
    RUSFAR1W: '1W', RUSFAR2W: '2W', RUSFAR1M: '1M', RUSFAR3M: '3M',
  };

  const URL = `https://iss.moex.com/iss/engines/stock/markets/index/boards/MMIX/securities.json`
    + `?iss.meta=off&iss.only=marketdata&securities=${SECIDS.join(',')}`;

  try {
    const r = await fetch(URL, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return res.status(502).json({ error: `MOEX HTTP ${r.status}` });

    const json = await r.json();
    const md = json?.marketdata;
    if (!md?.columns || !md?.data?.length) {
      return res.status(502).json({ error: 'MOEX не вернул marketdata' });
    }

    const col = {};
    md.columns.forEach((c, i) => { col[c] = i; });

    const out = {};
    for (const row of md.data) {
      const secid = row[col.SECID];
      const term = TERM[secid];
      if (!term) continue;
      out[term] = {
        secid,
        currentValue: row[col.CURRENTVALUE],   // то, что на сайте
        lastValue:    row[col.LASTVALUE],
        open:         row[col.OPENVALUE],
        change:       row[col.LASTCHANGE],      // изменение к предыдущему фиксу
        changePrc:    row[col.LASTCHANGEPRC],
        high:         row[col.HIGH],
        low:          row[col.LOW],
        updateTime:   row[col.UPDATETIME],
        tradeDate:    row[col.TRADEDATE],
      };
    }

    if (!Object.keys(out).length) {
      return res.status(502).json({ error: 'RUSFAR не найден в выдаче MOEX' });
    }

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({ data: out, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
