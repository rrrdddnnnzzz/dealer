export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Получаем ВСЕ инструменты на борде MMIX (где живут RUSFAR1W/1M/3M)
  // и ищем какой secid отвечает за overnight
  const URLS = [
    // Все бумаги борда MMIX
    'https://iss.moex.com/iss/engines/stock/markets/index/boards/MMIX/securities.json?iss.meta=off&iss.only=securities,marketdata&securities.columns=SECID,SHORTNAME,NAME&marketdata.columns=SECID,LASTVALUE,CURRENTVALUE,UPDATETIME',
    // Поиск всех RUSFAR через securities search
    'https://iss.moex.com/iss/securities.json?q=RUSFAR&iss.meta=off&iss.only=securities&securities.columns=secid,shortname,name,is_traded,marketprice_boardid',
  ];

  const results = [];
  for (const url of URLS) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(9000) });
      const text = await r.text();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch(e) {}
      results.push({
        url: url.replace('https://iss.moex.com',''),
        status: r.status,
        securities_cols: parsed?.securities?.columns,
        securities_data: parsed?.securities?.data,
        marketdata_data: parsed?.marketdata?.data,
      });
    } catch(e) {
      results.push({ url, error: e.message });
    }
  }
  return res.status(200).json(results);
}
