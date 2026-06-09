// Официальная инфляция РФ (ЦБ РФ, таблица /hd_base/infl/): инфляция г/г, цель, ключевая ставка.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
  try {
    const r = await fetch('https://www.cbr.ru/hd_base/infl/', {
      headers: { 'User-Agent': UA, 'Accept': 'text/html' }, signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return res.status(502).json({ error: `CBR HTTP ${r.status}` });
    const h = await r.text();

    const num = s => { const v = parseFloat(String(s).replace(',', '.')); return isFinite(v) ? v : null; };
    // строки таблицы: <td>ММ.ГГГГ</td><td>ключевая</td><td>инфляция г/г</td><td>цель</td>
    const rows = [...h.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
    for (const m of rows) {
      const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
        .map(c => c[1].replace(/<[^>]+>/g, '').trim());
      if (cells.length >= 4 && /^\d{2}\.\d{4}$/.test(cells[0])) {
        // первая дата-строка = самая свежая
        return finish({ date: cells[0], key: num(cells[1]), value: num(cells[2]), target: num(cells[3]) });
      }
    }
    return res.status(502).json({ error: 'инфляция не найдена в таблице ЦБ' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }

  function finish(d) {
    res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400'); // инфляция обновляется раз в месяц
    return res.status(200).json({ ...d, fetchedAt: new Date().toISOString() });
  }
}
