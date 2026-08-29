/* scrape_pws.js — διαβάζει τους τοπικούς σταθμούς WU και γράφει pws.json
 *
 * Τεχνική: φορτώνουμε τη δημόσια σελίδα με headless Chromium και υποκλέπτουμε την
 * απάντηση που παίρνει Η ΙΔΙΑ Η ΣΕΛΙΔΑ από το api.weather.com. Δεν κρατάμε, δεν
 * χρησιμοποιούμε και δεν αποθηκεύουμε κλειδί.
 *
 * Γιατί όχι CSS selectors: αλλάζουν με κάθε redesign. Το JSON της παρατήρησης όχι.
 *
 * Έξοδος: pws.json  { fetched, stations: { ID: {obsTime, temp, dewpt, humidity, pressure} } }
 * Θερμοκρασίες/σημείο δρόσου σε °C, πίεση σε hPa — μετατροπή αν το API απαντήσει imperial.
 */
const { chromium } = require("playwright");
const fs = require("fs");

const STATIONS = ["IARGYR9", "IARGYR10", "IARGYR7",      // Αργυρούπολη — σπίτι
                  "IALIMO14", "IALIMO16", "IILIOU4",     // Άλιμος — Άγ. Δημήτριος
                  "IMARAT24", "IMARAT19", "IMARAT16"];   // Μαραθώνας — Σχοινιάς
const CONC = 5;   // παράλληλες σελίδες
const OBS_URL  = "/v2/pws/observations/current";
const TIMEOUT  = 45000;

const f2c   = f => (f - 32) * 5 / 9;
const inhg2 = i => i * 33.8638864;          // inHg → hPa

/* Κρατάμε ΜΟΝΟ ό,τι χρειαζόμαστε, σε SI. */
function normalise(obs) {
  if (!obs) return null;
  const u = obs.metric || obs.imperial || obs.uk_hybrid || null;
  if (!u) return null;
  const isMetric = !!obs.metric;
  const num = v => (typeof v === "number" && isFinite(v) ? v : null);

  const temp  = num(u.temp);
  const dewpt = num(u.dewpt);
  const pres  = num(u.pressure);
  if (temp === null || dewpt === null) return null;

  return {
    obsTime:  Math.round(new Date(obs.obsTimeUtc).getTime() / 1000),
    temp:     +(isMetric ? temp  : f2c(temp)).toFixed(1),
    dewpt:    +(isMetric ? dewpt : f2c(dewpt)).toFixed(1),
    humidity: num(obs.humidity),
    pressure: pres === null ? null : +(isMetric ? pres : inhg2(pres)).toFixed(1)
  };
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    locale: "en-US"
  });
  const out = {};

  let cursor = 0;
  async function worker(){
    while (cursor < STATIONS.length){
      const id = STATIONS[cursor++];
      const page = await ctx.newPage();
      let obs = null;
      page.on("response", async res => {
        if (obs || !res.url().includes(OBS_URL)) return;
        try {
          const j = await res.json();
          const o = j && j.observations && j.observations[0];
          if (o && (o.stationID === id || !o.stationID)) obs = o;
        } catch (_) {}
      });
      try {
        await page.goto("https://www.wunderground.com/dashboard/pws/" + id,
                        { waitUntil: "domcontentloaded", timeout: TIMEOUT });
        for (let i = 0; i < 20 && !obs; i++) await page.waitForTimeout(1000);
      } catch (e) {
        console.log(id + ": σφαλμα φορτωσης - " + String(e.message).slice(0, 120));
      }
      await page.close();
      const rec = normalise(obs);
      if (rec) { out[id] = rec; console.log(`${id}: T=${rec.temp} Td=${rec.dewpt} p=${rec.pressure}`); }
      else       console.log(`${id}: καμία παρατήρηση`);
    }
  }
  await Promise.all(Array.from({length: CONC}, worker));

  await browser.close();

  if (!Object.keys(out).length) {
    console.error("Κανένας σταθμός δεν απάντησε — δεν γράφω τίποτα, κρατάω το παλιό pws.json.");
    process.exit(1);
  }

  fs.writeFileSync("pws.json",
    JSON.stringify({ fetched: new Date().toISOString(), stations: out }, null, 1) + "\n");
  console.log(`Γράφτηκαν ${Object.keys(out).length} σταθμοί.`);
})();
