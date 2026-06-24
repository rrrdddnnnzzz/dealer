// Облигация OZON (Озон 1P-02, ISIN RU000A10EXZ9, борд TQCB) — полная аналитика с MOEX ISS.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const SECID = 'RU000A10EXZ9', BOARD = 'TQCB';

  // ── Модель «справедливого спреда к КС» (методика дисконт-маржи, как в расчёте коллег) ──
  // Купон флоатера = КС + контрактный спред; КС фиксируется за CONTRACT.fixLagDays до периода.
  // Будущая траектория КС берётся из форвардной кривой IRS KEYRATE (FWD_KS, номинальные ставки по годам).
  // Справедливый спред s решаем линейно: PV(купоны=фвдКС+s, дисконт по рыночной YTM) = грязная цена.
  // ⚠ FWD_KS и contractSpread — ручные входы (источник: IRS КС / проспект). Обновлять при смене кривой.
  const CONTRACT = {
    spread: 0.025,        // контрактный спред к КС (2.5%) — из проспекта
    fixLagDays: 5,        // КС фиксируется за 5 дней до начала купонного периода
    // форвардная КС по годам от даты оценки (номинальная, из листа «IRS КС»), доля
    fwdKs: [
      { y: 1, r: 0.1314 }, { y: 2, r: 0.1154 }, { y: 3, r: 0.1242 },
      { y: 4, r: 0.1269 }, { y: 5, r: 0.1286 },
    ],
  };
  const fwdKsAt = years => {
    const yr = Math.max(1, Math.floor(years) + 1);
    const arr = CONTRACT.fwdKs;
    for (const p of arr) if (yr <= p.y) return p.r;
    return arr[arr.length - 1].r;
  };
  // Линейное решение: PV = A + s·B, где A — PV при s=0, B — чувствительность к спреду.
  function fairSpread({ clean, nkd, ytm, matDate, periodDays, face }) {
    if (clean == null || ytm == null || !matDate) return null;
    const today = new Date();
    const mat = new Date(matDate);
    if (!(mat > today)) return null;
    const pd = periodDays || 30, y = ytm / 100, dayMs = 864e5;
    const dirty = (clean / 100) * face + (nkd || 0);
    // даты выплат: шаг назад от погашения по pd дней, берём только будущие
    const dates = [];
    for (let d = new Date(mat); d > today; d = new Date(d.getTime() - pd * dayMs)) dates.unshift(new Date(d));
    let A = 0, B = 0;
    for (const cd of dates) {
      const t = (cd - today) / dayMs / 365;
      if (t <= 0) continue;
      const ks = fwdKsAt(t);
      const df = Math.pow(1 + y, t);
      A += (ks * (pd / 365) * face) / df;   // часть купона от КС
      B += ((pd / 365) * face) / df;          // чувствительность к спреду
    }
    A += face / Math.pow(1 + y, (mat - today) / dayMs / 365);  // возврат номинала
    if (B === 0) return null;
    return (dirty - A) / B;   // доля (например 0.0208)
  }

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
      zspread: m.ZSPREAD ?? null,                                      // Z-спред MOEX к кривой ОФЗ, % (1.89 = 189 бп)
      zspreadWap: m.ZSPREADATWAPRICE ?? null,
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
    // справедливый (вменённый) спред к КС — модель дисконт-маржи по форвардной КС
    const fs = fairSpread({ clean: last, nkd, ytm: out.ytm, matDate: out.matDate, periodDays: out.couponPeriod, face });
    out.fairSpread = fs != null ? +(fs * 100).toFixed(3) : null;        // %
    out.fairSpreadBp = fs != null ? Math.round(fs * 10000) : null;       // базисные пункты
    out.contractSpread = +(CONTRACT.spread * 100).toFixed(2);            // контрактный спред, %
    out.contractSpreadBp = Math.round(CONTRACT.spread * 10000);
    if (out.last == null && out.ytm == null) return res.status(502).json({ error: 'нет данных по облигации' });

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=3600');
    return res.status(200).json({ ...out, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
