# Chess-results dashboard

Dashboard na celou obrazovku pro televizi nebo projektor v hracím sále: **vlevo los aktuálního kola
jednoho turnaje, vpravo druhého**, obojí z [chess-results.com](https://chess-results.com).

Adresa: **https://slivam24.github.io/chess-ressults-dashboard/**

## Ovládání

- Po otevření se ukáže tlačítko **Spustit na celou obrazovku**. Prohlížeč dovolí celou obrazovku zapnout
  jen po kliknutí; pak ji přepíná klávesa **F**, **Esc** ji ukončí. `?start=ne` úvodní tlačítko vynechá.
- Písmo se samo zvětší tak, aby se los vešel na výšku. Když má turnaj hodně šachovnic, los se pomalu posouvá.
- Ovládání a kurzor po pár sekundách zmizí (pohyb myší je vrátí), obrazovka nezhasíná, nahoře jsou hodiny.
- Turnaje jednotlivců: šachovnice, bílý, výsledek, černý, u hráčů rating a body. Turnaje družstev: zápasy
  kola se skóre. Hotové výsledky se doplňují samy, vítěz je zeleně.
- Výchozí vzhled je tmavý, světlý je `?tema=svetle`.

## Zadání turnajů

Stačí číslo turnaje, nebo odkaz na kteroukoli jeho stránku na chess-results.com.

1. **Actions → Dashboard → Run workflow**, vyplnit *Turnaj vlevo* a *Turnaj vpravo*. Turnaje se uloží do
   `scripts/dashboard.json` a los se hned stáhne. Jde i upravit přímo `scripts/dashboard.json`.
2. Jen na jednom zařízení: na dashboardu tlačítko **⚙ Turnaje** (klávesa **S**), nebo adresa
   `?vlevo=1516901&vpravo=1507857`. Turnaj, který úloha nestahuje, se tak ukáže jako vložená stránka
   chess-results; v přehledném zobrazení až po kroku 1.

## Odkud jsou data

chess-results nedovoluje stránce z jiného webu číst svůj obsah (chybí hlavička `Access-Control-Allow-Origin`),
proto los stahuje úloha `.github/workflows/dashboard.yml` **každých 10 minut** (GitHub ji občas o pár minut
zpozdí) a ukládá ho do větve `dashboard-data` (jediný soubor `dashboard.json`, bez historie), takže v `main`
nepřibývají commity. Stránka si ho načítá každou minutu. Když chess-results neodpoví, zůstane poslední los
a dashboard to ukáže.

- Mimo turnaje jde stahování vypnout v `scripts/dashboard.json` hodnotou `"aktivni": false`.
- Plánovaná úloha běží jen z větve `main`. GitHub ji vypne, když se v repozitáři 60 dní nic nezmění;
  pak stačí v záložce Actions kliknout na **Enable workflow**.

U turnaje jednotlivců se čte stránka *Nasazení/Výsledky* (bez čísla kola ukazuje chess-results samo
aktuální kolo), u turnaje družstev nejvyšší zveřejněné kolo. Parser je v `js/pairings.js`.

## Nasazení (GitHub Pages)

Repozitář → **Settings → Pages → Build and deployment → Source: Deploy from a branch**, větev `main`,
složka `/ (root)`.

## Vývoj

```bash
npm install
npm test                                               # parser losu na uložených stránkách
node scripts/fetch_dashboard.mjs --out dashboard.json  # stáhne los turnajů ze scripts/dashboard.json
npm run serve                                          # http://localhost:8080/?data=dashboard.json
```

Stránka se nesestavuje a v prohlížeči nemá žádné závislosti: čisté HTML, CSS a JavaScript (moduly).
