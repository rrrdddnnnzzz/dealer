// Объединённый макро-эндпоинт ЦБ РФ (экономим число serverless-функций).
// ?type=keyrate  — ключевая ставка (SOAP)
// ?type=inflation — инфляция г/г + цель (таблица /hd_base/infl/)
// ?type=cbr       — официальные курсы валют (XML_daily)
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  let type = 'keyrate';
  try { type = new URL(req.url, 'http://x').searchParams.get('type') || 'keyrate'; } catch (_) {}
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
  const pad = n => String(n).padStart(2, '0');
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  try {
    if (type === 'keyrate') {
      const body = `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">`
        + `<soap:Body><KeyRate xmlns="http://web.cbr.ru/"><fromDate>${iso(new Date(Date.now() - 45 * 864e5))}</fromDate><ToDate>${iso(new Date(Date.now() + 864e5))}</ToDate></KeyRate></soap:Body></soap:Envelope>`;
      const r = await fetch('https://www.cbr.ru/DailyInfoWebServ/DailyInfo.asmx', {
        method: 'POST', headers: { 'Content-Type': 'text/xml; charset=utf-8', 'SOAPAction': 'http://web.cbr.ru/KeyRate', 'User-Agent': UA },
        body, signal: AbortSignal.timeout(9000),
      });
      if (!r.ok) return res.status(502).json({ error: `CBR HTTP ${r.status}` });
      const xml = await r.text();
      const blocks = [...xml.matchAll(/<DT>([^<]+)<\/DT>\s*<Rate>([^<]+)<\/Rate>/g)];
      if (!blocks.length) return res.status(502).json({ error: 'CBR не вернул ставку' });
      let latest = null;
      for (const m of blocks) { const dt = m[1]; if (!latest || dt > latest.dt) latest = { dt, rate: parseFloat(m[2].replace(',', '.')) }; }
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({ rate: latest.rate, date: latest.dt.slice(0, 10) });
    }

    if (type === 'inflation') {
      const r = await fetch('https://www.cbr.ru/hd_base/infl/', { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, signal: AbortSignal.timeout(9000) });
      if (!r.ok) return res.status(502).json({ error: `CBR HTTP ${r.status}` });
      const h = await r.text();
      const num = s => { const v = parseFloat(String(s).replace(',', '.')); return isFinite(v) ? v : null; };
      for (const m of h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
        const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => c[1].replace(/<[^>]+>/g, '').trim());
        if (cells.length >= 4 && /^\d{2}\.\d{4}$/.test(cells[0])) {
          res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');
          return res.status(200).json({ date: cells[0], key: num(cells[1]), value: num(cells[2]), target: num(cells[3]), fetchedAt: new Date().toISOString() });
        }
      }
      return res.status(502).json({ error: 'инфляция не найдена' });
    }

    if (type === 'cbr') {
      const r = await fetch('https://www.cbr.ru/scripts/XML_daily.asp', { headers: { 'User-Agent': UA, 'Accept': 'application/xml,text/xml' }, signal: AbortSignal.timeout(9000) });
      if (!r.ok) return res.status(502).json({ error: `CBR HTTP ${r.status}` });
      const buf = await r.arrayBuffer();
      const xml = Buffer.from(buf).toString('latin1');
      const dateM = xml.match(/Date="([^"]+)"/);
      const out = { date: dateM ? dateM[1] : null };
      for (const cc of ['USD', 'EUR', 'CNY', 'KZT', 'BYN', 'GBP', 'JPY']) {
        const m = xml.match(new RegExp(`<CharCode>${cc}</CharCode>\\s*<Nominal>(\\d+)</Nominal>\\s*<Name>[^<]*</Name>\\s*<Value>([\\d,]+)</Value>\\s*<VunitRate>([\\d,.]+)</VunitRate>`));
        if (m) out[cc] = +parseFloat(m[3].replace(',', '.')).toFixed(4);
      }
      if (Object.keys(out).length <= 1) return res.status(502).json({ error: 'ЦБ не вернул курсы' });
      res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({ ...out, fetchedAt: new Date().toISOString() });
    }

    return res.status(400).json({ error: 'unknown type' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
