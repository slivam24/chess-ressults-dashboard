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

- Na dashboardu tlačítko **⚙ Turnaje** (klávesa **S**), nebo adresa `?vlevo=1529674&vpravo=1529675`.
  Prohlížeč si turnaje zapamatuje, příště stačí otevřít stránku bez parametrů.
- Výchozí turnaje pro všechny jsou v `scripts/dashboard.json` (jdou změnit i přes
  **Actions → Dashboard → Run workflow**).

U turnaje jednotlivců se ukazuje nejnovější kolo, které je opravdu vylosované (kola dopředu
zveřejněná jen s nenasazenými hráči se přeskočí), u turnaje družstev nejvyšší zveřejněné kolo.

## Živé načítání každých 30 sekund

chess-results nedovoluje stránce z jiného webu číst svůj obsah (chybí hlavička `Access-Control-Allow-Origin`)
a veřejní prostředníci (CORS proxy) nefungují. Proto je tu vlastní malý prostředník, `cloudflare-worker.js`,
který běží zdarma na Cloudflare. S ním dashboard načítá los **přímo z chess-results každých 30 sekund,
pro jakýkoli turnaj zadaný na stránce**. Prostředník pustí jen stránky turnajů na chess-results.com.

Zřízení (jednou, asi 5 minut, v prohlížeči):

1. Založ si účet na **https://dash.cloudflare.com/sign-up** (zdarma, stačí e-mail).
2. V levém menu **Compute (Workers) → Workers & Pages → Create → Create Worker** (případně *Start with Hello World*).
   Pojmenuj ho třeba `chess-proxy` a dej **Deploy**.
3. **Edit code**, smaž ukázkový kód, vlož celý obsah souboru `cloudflare-worker.js` z tohoto repozitáře
   a dej **Deploy**.
4. Zkopíruj adresu Workeru, vypadá jako `https://chess-proxy.<tvuj-ucet>.workers.dev`.
5. Adresu vlož buď do `scripts/dashboard.json` jako `"proxy": "https://…workers.dev"` (platí pro všechny
   obrazovky), nebo jen na jednom zařízení do **⚙ Turnaje → Prostředník pro živé načítání**.

Bezplatný tarif Cloudflare má 100 000 požadavků denně; dashboard jich potřebuje 2 až 4 za 30 sekund,
tedy kolem 10 000 za celý den.

## Bez prostředníka

Bez prostředníka los stahuje úloha `.github/workflows/dashboard.yml` jen pro turnaje ze `scripts/dashboard.json`,
plánovaně **každých 10 minut** (GitHub ji často zpozdí) a ukládá ho do větve `dashboard-data`.
Ostatní turnaje se ukážou jako vložená stránka chess-results, která se obnovuje každých 30 sekund.
Stahování přes GitHub jde vypnout hodnotou `"aktivni": false` v `scripts/dashboard.json`.
GitHub plánovanou úlohu vypne, když se v repozitáři 60 dní nic nezmění; pak stačí v Actions kliknout
na **Enable workflow**.

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
