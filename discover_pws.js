/* discover_pws.js — ΕΦΑΠΑΞ σάρωση: ποιοι σταθμοί WU υπάρχουν κοντά στις τοποθεσίες μας.
 *
 * Δοκιμάζει κωδικούς με πρόθεμα περιοχής (IARGYR1..12 κ.λπ.), κρατά όσους απαντούν, και
 * βγάζει ΚΑΙ ΤΙΣ ΣΥΝΤΕΤΑΓΜΕΝΕΣ τους — η απάντηση του API τις περιέχει. Έτσι η κατάταξη
 * γίνεται με πραγματική απόσταση, όχι με εικασία από το όνομα.
 *
 * ΔΕΝ τρέχει σε χρονοδιάγραμμα: φορτώνει δεκάδες σελίδες. Μόνο workflow_dispatch.
 * Έξοδος: discovered.json — δεν το διαβάζει η σελίδα, είναι για να διαλέξουμε λίστες.
 */
const { chromium } = require("playwright");
const fs = require("fs");

/* Οι τρεις τοποθεσίες, για την κατάταξη κατά απόσταση */
const TARGETS = {
  spiti:    [37.912024, 23.754822],
  agdim:    [37.922710, 23.733803],
  schinias: [38.154667, 23.996191]
};

/* Προθέματα ανά ευρύτερη περιοχή. Το εύρος κρατιέται μικρό επίτηδες. */
const PREFIXES = [
  // νότια προάστια — σπίτι & Άγ. Δημήτριος
  ["IARGYR", 12], ["IELLIN", 8], ["IGLYFA", 10], ["IALIMO", 16],
  ["IILIOU", 8],  ["IDAFNI", 6], ["INEASM", 6],  ["IVOULA", 8],
  ["IKALLI", 8],  ["IAGIOS", 8],
  // ανατολική Αττική — Σχοινιάς
  ["IMARAT", 26], ["INEAMA", 8], ["IRAFIN", 8],  ["IPIKER", 6],
  ["IARTEM", 8],  ["ISPATA", 6]
];

const OBS_URL = "/v2/pws/observations/current";
const R = 6371;
const rad = d => d * Math.PI / 180;
function km(a, b){
  const dLat = rad(b[0]-a[0]), dLon = rad(b[1]-a[1]);
  const h = Math.sin(dLat/2)**2 + Math.cos(rad(a[0]))*Math.cos(rad(b[0]))*Math.sin(dLon/2)**2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

(async () => {
  const ids = [];
  for (const [pre, n] of PREFIXES) for (let i = 1; i <= n; i++) ids.push(pre + i);
  console.log(`Δοκιμάζω ${ids.length} κωδικούς…`);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    locale: "en-US"
  });
  const found = [];

  /* Παράλληλα, όχι σειριακά. Η πρώτη έκδοση περίμενε 12 s στο κενό για κάθε ανύπαρκτο
     κωδικό — 140 × 14 s ≈ μισή ώρα. Με 6 ταυτόχρονες σελίδες πέφτει κάτω από 6 λεπτά. */
  const CONC = 6, WAIT = 8;
  let cursor = 0;

  async function worker(){
    while (cursor < ids.length){
      const id = ids[cursor++];
      const page = await ctx.newPage();
      let obs = null;
      page.on("response", async res => {
        if (obs || !res.url().includes(OBS_URL)) return;
        try {
          const j = await res.json();
          const o = j && j.observations && j.observations[0];
          if (o) obs = o;
        } catch (_) {}
      });
      try {
        await page.goto("https://www.wunderground.com/dashboard/pws/" + id,
                        { waitUntil: "domcontentloaded", timeout: 30000 });
        for (let i = 0; i < WAIT && !obs; i++) await page.waitForTimeout(1000);
      } catch (_) {}
      await page.close();

      if (obs && typeof obs.lat === "number" && typeof obs.lon === "number"){
        const u = obs.metric || obs.imperial;
        const rec = {
          id, lat: obs.lat, lon: obs.lon,
          neighborhood: obs.neighborhood || null,
          obsTime: obs.obsTimeUtc || null,
          temp: u ? u.temp : null, dewpt: u ? u.dewpt : null,
          metric: !!obs.metric, dist: {}
        };
        for (const [k, t] of Object.entries(TARGETS)) rec.dist[k] = +km([obs.lat, obs.lon], t).toFixed(2);
        found.push(rec);
        console.log(`  ✔ ${id}  ${obs.lat.toFixed(4)},${obs.lon.toFixed(4)}  ${rec.neighborhood || ""}`);
      }
    }
  }
  await Promise.all(Array.from({length: CONC}, worker));

  await browser.close();

  /* Κατάταξη ανά τοποθεσία */
  const best = {};
  for (const k of Object.keys(TARGETS))
    best[k] = found.slice().sort((a, b) => a.dist[k] - b.dist[k]).slice(0, 6)
                   .map(s => ({ id: s.id, km: s.dist[k], neighborhood: s.neighborhood }));

  fs.writeFileSync("discovered.json",
    JSON.stringify({ scanned: ids.length, found: found.length, at: new Date().toISOString(),
                     nearest: best, stations: found }, null, 1) + "\n");

  console.log(`\nΒρέθηκαν ${found.length} από ${ids.length}.`);
  for (const [k, list] of Object.entries(best))
    console.log(`${k}: ` + list.map(s => `${s.id} (${s.km} km)`).join(" · "));
})();
