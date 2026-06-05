// Ключевая ставка ЦБ РФ — официальный SOAP-сервис cbr.ru.
// Возвращает самое свежее значение из диапазона последних дней.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const now = new Date();
  const from = new Date(now.getTime() - 45 * 864e5);   // 45 дней назад
  const to = new Date(now.getTime() + 1 * 864e5);       // +1 день (запас по таймзоне)

  const body = `<?xml version="1.0" encoding="utf-8"?>`
    + `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">`
    + `<soap:Body><KeyRate xmlns="http://web.cbr.ru/">`
    + `<fromDate>${iso(from)}</fromDate><ToDate>${iso(to)}</ToDate>`
    + `</KeyRate></soap:Body></soap:Envelope>`;

  try {
    const r = await fetch('https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'SOAPAction': 'http://web.cbr.ru/KeyRate',
        'User-Agent': 'Mozilla/5.0',
      },
      body,
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return res.status(502).json({ error: `CBR HTTP ${r.status}` });

    const xml = await r.text();
    const blocks = [...xml.matchAll(/<DT>([^<]+)<\/DT>\s*<Rate>([^<]+)<\/Rate>/g)];
    if (!blocks.length) return res.status(502).json({ error: 'CBR не вернул ставку' });

    let latest = null;
    for (const m of blocks) {
      const dt = m[1];
      const rate = parseFloat(m[2].replace(',', '.'));
      if (!latest || dt > latest.dt) latest = { dt, rate };
    }

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).json({ rate: latest.rate, date: latest.dt.slice(0, 10) });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
