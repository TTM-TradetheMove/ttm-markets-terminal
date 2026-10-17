// TTM history export - paste into the browser console while on any forexfactory.com page, press Enter.
// It opens each month in a hidden frame, reads the tracked releases, then downloads bias_history_seed.json.
(async () => {
  const YEARS_BACK = 3;                       // change this to go further back
  const TITLES = new Set(["ADP Non-Farm Employment Change", "Advance GDP q/q", "Average Hourly Earnings m/m", "CB Consumer Confidence", "CPI Flash Estimate y/y", "CPI m/m", "CPI y/y", "Core CPI m/m", "Core CPI y/y", "Core PCE Price Index m/m", "Core PPI m/m", "Core Retail Sales m/m", "Federal Funds Rate", "ISM Manufacturing PMI", "ISM Services PMI", "JOLTS Job Openings", "Main Refinancing Rate", "Non-Farm Employment Change", "Official Bank Rate", "PPI m/m", "Prelim UoM Consumer Sentiment", "Retail Sales m/m", "Unemployment Claims", "Unemployment Rate"]);
  const CURS = new Set(["EUR", "GBP", "USD"]);
  const MON = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const now = new Date(), out = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const fr = document.createElement('iframe');
  fr.style.cssText = 'position:fixed;left:-9999px;width:1200px;height:900px';
  document.body.appendChild(fr);
  for (let i = 0; i < YEARS_BACK * 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const m = MON[d.getMonth()], y = d.getFullYear();
    fr.src = '/calendar?month=' + m + '.' + y;
    await new Promise(r => fr.onload = r);
    await sleep(1500);
    const doc = fr.contentDocument; let last = 0;
    for (let k = 0; k < 25; k++) {            // scroll so lazy rows load
      fr.contentWindow.scrollTo(0, doc.body.scrollHeight); await sleep(500);
      if (doc.body.scrollHeight === last) break; last = doc.body.scrollHeight;
    }
    let date = '', kept = 0;
    doc.querySelectorAll('tr.calendar__row').forEach(tr => {
      const de = tr.querySelector('.calendar__date'), dt = de ? de.innerText.replace(/\s+/g, ' ').trim() : '';
      if (dt) date = dt;
      const t = s => { const e = tr.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : ''; };
      const cur = t('.calendar__currency'), title = t('.calendar__event');
      if (!CURS.has(cur) || !TITLES.has(title)) return;
      out.push({month: y + '-' + String(d.getMonth() + 1).padStart(2, '0'), date, currency: cur, title,
                actual: t('.calendar__actual'), forecast: t('.calendar__forecast'), previous: t('.calendar__previous')});
      kept++;
    });
    console.log(m + ' ' + y + ': ' + kept + ' releases');
    await sleep(1500);
  }
  fr.remove();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], {type: 'application/json'}));
  a.download = 'bias_history_seed.json'; a.click();
  console.log('DONE - ' + out.length + ' rows. Upload bias_history_seed.json to the repo.');
})();
