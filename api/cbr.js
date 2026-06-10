// Официальные курсы ЦБ РФ (дневной фиксинг) — XML_daily.asp. За 1 единицу валюты, ₽.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  try {
    const r = await fetch('https://www.cbr.ru/scripts/XML_daily.asp', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/xml,text/xml' },
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return res.status(502).json({ error: `CBR HTTP ${r.status}` });
    // числа ASCII-безопасны — декодируем как latin-1, чтобы не ломать парсинг
    const buf = await r.arrayBuffer();
    const xml = Buffer.from(buf).toString('latin1');

    const dateM = xml.match(/Date="([^"]+)"/);
    const out = { date: dateM ? dateM[1] : null };
    for (const cc of ['USD', 'EUR', 'CNY', 'KZT', 'BYN', 'GBP', 'JPY']) {
      const m = xml.match(new RegExp(`<CharCode>${cc}</CharCode>\\s*<Nominal>(\\d+)</Nominal>\\s*<Name>[^<]*</Name>\\s*<Value>([\\d,]+)</Value>\\s*<VunitRate>([\\d,.]+)</VunitRate>`));
      if (m) out[cc] = +parseFloat(m[3].replace(',', '.')).toFixed(4);
    }
    if (Object.keys(out).length <= 1) return res.status(502).json({ error: 'ЦБ не вернул курсы' });

    res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400'); // фиксинг раз в день
    return res.status(200).json({ ...out, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
