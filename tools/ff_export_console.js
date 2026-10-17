// Run this in the browser console while you are on any forexfactory.com page (logged in or not).
// It downloads bias_history_seed.json with every month you ask for. Change FROM to go back further.
(async () => {
  const FROM = {y: 2023, m: 1};                       // first month to export
  const MON = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  const NAME = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const now = new Date(); const rows = []; let y = FROM.y, m = FROM.m;
  const clean = s => (s || '').replace(/\s+/g, ' ').trim();
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    const url = `/calendar?month=${MON[m-1]}.${y}`;
    try {
      const html = await (await fetch(url, {credentials: 'include'})).text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      let day = '', kept = 0;
      doc.querySelectorAll('tr.calendar__row').forEach(tr => {
        const de = tr.querySelector('.calendar__date');
        const mm = de && clean(de.textContent).match(/([A-Z][a-z]{2})\s*(\d{1,2})\s*$/);
        if (mm) day = mm[1] + ' ' + mm[2];
        const cur = tr.querySelector('.calendar__currency'), ev = tr.querySelector('.calendar__event');
        if (!cur || !ev || !day) return;
        const t = s => { const e = tr.querySelector(s); return e ? clean(e.textContent) : ''; };
        const c = t('.calendar__currency');
        if (!['USD','GBP','EUR'].includes(c)) return;
        rows.push({month: `${y}-${String(m).padStart(2,'0')}`, date: day, currency: c, title: t('.calendar__event'),
                   actual: t('.calendar__actual'), forecast: t('.calendar__forecast'), previous: t('.calendar__previous')});
        kept++;
      });
      console.log(`${y}-${String(m).padStart(2,'0')}: ${kept} rows`);
    } catch (e) { console.log(`${y}-${m}: failed`, e); }
    await new Promise(r => setTimeout(r, 1500));
    if (++m > 12) { m = 1; y++; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify({rows})], {type: 'application/json'}));
  a.download = 'bias_history_seed.json'; a.click();
  console.log('Done: ' + rows.length + ' rows downloaded');
})();
