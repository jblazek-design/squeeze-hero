# Squeeze hero — @blazek.design

Hero sekce portfolia: hlavu ovládáš dlaní na kameru.

## Spuštění
- **Mac:** dvojklik na `start.command` (poprvé pravým tlačítkem → Otevřít). Otevře se http://localhost:5174.
- **Nebo v Terminálu:** `cd` do složky → `python3 -m http.server 5174` → otevři http://localhost:5174.
- Povol kameru. Kvůli zvuku jednou klikni kamkoliv na stránku (prohlížeč jinak nedovolí přehrát zvuk).

Musí to běžet ze serveru (localhost nebo jakýkoliv HTTPS hosting). Když otevřeš jen `index.html`, kamera nepoběží.

## Ovládání
| Gesto | Co se stane |
|---|---|
| Otevřená dlaň | Normální hlava (Step 1 z Figmy) |
| Pomalu zmáčkni do pěsti | Hlava se postupně mačká do papírové koule (121 snímků z videa), zní mačkání papíru. Napůl uvolněná ruka nedělá nic, mačká se až opravdová pěst. |
| Úplně zmáčknutá | Vyskočí OUCH + blesky s „pop“ zvukem, hlava se zatřese (Step 2) |
| Znovu otevři | Hlava se rozbalí, samolepky zmizí, „boing“ |
| Pohyb rukou | Celá stránka se jemně hýbe (parallax): pozadí, hlava, text a box v různé hloubce |
| Zamávání (dlaní nebo kýváním v zápěstí) | Hlava se natočí k tobě a kývne, vystřelí konfety, vyskočí bublina „AHOJ!“, chip „Say Hi!“ zamává. Během mávání se hlava nemačká. |

### Ovládání celé stránky rukou
| Gesto | Co se stane |
|---|---|
| ☝ Jen ukazováček nahoru | Kurzor (limetková tečka). Podrž ho nad tlačítkem ~0,7 s → klikne (kroužek se doplní). |
| ✌ Ukazováček + prostředníček | Scroll: posouváš stránku pohybem ruky nahoru/dolů, po puštění dojede setrvačností. |
| Otevřená dlaň / pěst | V hero mávání a mačkání hlavy; pod hero se hlava nemačká. |

Mimo hero je vpravo dole malý panel s kostrou ruky a aktuálním režimem. Odkazy otevírané rukou se otevřou ve stejném okně (prohlížeč by jinak nové okno zablokoval).

Pozadí je živý WebGL gradient z obrázku z Figmy: pomalu teče, při zmáčknutí se stáčí do hlavy a při mávání se vlní.

Záložní ovládání: **podržení myši / mezerníku** = zmáčknutí, pohyb myši = parallax, rychlé zatřepání myší do stran = zamávání.
Klávesy: **S** zvuk · **C** ukázat obraz z kamery v boxu · **M** jen myš · **D** živé hodnoty pro ladění.

## Ladění (`app.js` → `CFG` nahoře)
- `openLo` / `openHi`: rozsah otevřenosti ruky (D ukáže tvoje živé `ratio`). Rozsah se během používání sám mírně přizpůsobuje.
- `follow`: jak rychle hlava sleduje ruku.
- `squeezeStart` / `squeezeFull`: od jak zavřené ruky se hlava začne mačkat a kdy je úplně zmačkaná (0 = otevřená, 1 = pěst).
- `waveSpeed`, `waveSwings`, `waveWindow`: citlivost mávání (rychlost prstů, počet švihů, časové okno).
- `confettiCooldown`: minimální pauza mezi dávkami konfet.
- `dwell`: jak dlouho držet kurzor nad tlačítkem pro klik (ms).
- `pointerBox`: která část obrazu z kamery odpovídá celé obrazovce (menší box = menší pohyby ruky).
- `scrollGain`: citlivost dvouprstého scrollu.
- `popOn` / `popOff`: kdy samolepky vyskočí / zmizí.
- `parallax`: síla parallaxu (1 = výchozí, 0 = vypnuto).
- `smileSrc`: obrázek s úsměvem, který se ukáže při mávání (viz níže).

## Úsměv při mávání
Když si vygeneruješ fotku s úsměvem, ulož ji jako `assets/smile.png` a nastav `smileSrc: 'assets/smile.png'`.
Musí mít průhledné pozadí a stejný ořez jako `frames/h000.webp` (1100 × 1159 px, hlava otočená doleva, na stejném místě).
Jednodušší je poslat mi ji a já ji vyklíčuju a zarovnám.

## Soubory
- `frames/`: 121 snímků z videa s odstraněným zeleným pozadím (WebP s průhledností), zrcadlené podle Figmy
- `assets/`: samolepky a ikony exportované z Figmy, gradient
- `audio/crumple.mp3`: zvuk mačkání z tvého videa (normalizovaný); pop / boing / hi se generují v prohlížeči
- `vendor/mediapipe/`: model a runtime pro sledování ruky, přibalené lokálně

## Zbytek stránky
Sekce pod hero (Featured work, Services, Webdesigner předregistrace, Community, kontakt) jsou v designu portfolia blazek-design.webflow.io: PP Pangram Sans, limetková #D5FF2C, šedé dlaždice #f4f4f4. Obrázky, loga a font se načítají z Webflow CDN tvého portfolia — když je tam smažeš nebo přejmenuješ, zmizí i tady.
- **Kontakt:** boční drawer (tlačítka Start a project, Contact, Say Hi!, služby). Odeslání otevře mailového klienta s předvyplněným e-mailem na blazek@socialmind.cz.
- **Předregistrace Webdesigner:** drawer s vloženým Typeformem waitlistu (stejný jako na education.socialmind.cz).
