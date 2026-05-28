# MealBuddy

Mobilná aplikácia (React Native / Expo) na plánovanie jedál, odhad cien nákupu, špajzu a týždenného rozpočtu. Pripája sa na Firebase projekt `mealbuddy-ba30f` s **už naplnenou** databázou (recepty, ceny, mapovania ingrediencií).

## Požiadavky

- Node.js 18+, npm
- [Expo Go](https://expo.dev/go) (vývoj) alebo Android telefón (APK)
- Účet v aplikácii (e-mail a heslo)

## Spustenie pri vývoji

```bash
git clone <url-repozitára>
cd mealbuddy
npm install
npx expo start
```

- **Android (Expo Go):** v termináli `a` alebo QR kód
- **iOS (Expo Go):** `i` alebo QR kód
- **Emulátor / natívny build:** `npm run android` / `npm run ios`

## Inštalácia na Android (APK)

Build cez [EAS](https://docs.expo.dev/build/introduction/) — profil `preview` v `eas.json` vytvorí inštalačný **APK** súbor.

```bash
npm install -g eas-cli    # ak ešte nemáš
eas login
eas build -p android --profile preview
```

Po dokončení buildu stiahni APK z odkazu v termináli alebo z [expo.dev](https://expo.dev) → projekt → Builds. Na telefóne povol inštaláciu z neznámych zdrojov a APK nainštaluj.

## Použitie aplikácie

Po nainštalovaní (Expo Go alebo APK) aplikácia prevedie používateľa nasledujúcimi krokmi:

1. **Registrácia / prihlásenie.** Tri spôsoby: e-mail + heslo, prihlásenie cez Google (OAuth) alebo anonymné prihlásenie pre rýchle vyskúšanie aplikácie bez vytvorenia účtu.
2. **Onboarding (4 kroky).** Diétne preferencie (vegetarián, vegán, bezlepkové), týždenný rozpočet (10 – 200 €), veľkosť domácnosti (1 – 6 osôb), vybavenie kuchyne.
3. **Plánovanie týždňa.** Na obrazovke Plán používateľ pridáva recepty do dní (raňajky, obed, večera); aplikácia priebežne prepočítava odhadovanú cenu plánu.
4. **Generovanie nákupného zoznamu.** Z týždenného plánu jedným tlačidlom — položky dostupné v špajzi sa automaticky odpočítajú. Počas nákupu používateľ položky odškrtáva.
5. **Špajza a recepty zo zásob.** Modul Špajza eviduje potraviny vrátane dátumu expirácie; položky s blížiacou sa expiráciou (do 7 dní) sa vizuálne zvýraznia.
6. **Zdieľanie v domácnosti.** Z profilu možno vytvoriť domácnosť a pozvať ďalších členov e-mailom — zdieľaný nákupný zoznam a špajza sa synchronizujú v reálnom čase.
7. **Prehľad rozpočtu.** Kruhový indikátor čerpania týždenného rozpočtu (pondelok – nedeľa), porovnanie s predchádzajúcim týždňom a mesiacom, graf výdavkov za posledné štyri týždne.

## Konfigurácia prostredia (skripty)

Skripty v priečinku `scripts/` na naplnenie databázy a volania Gemini API očakávajú nasledujúce premenné prostredia:

| Premenná | Význam |
|----------|--------|
| `GEMINI_API_KEY` | API kľúč pre Google Gemini (získa sa v [AI Studio](https://aistudio.google.com)) |
| `GEMINI_MODEL` | Voliteľné — model Gemini (predvolene `gemini-2.5-flash`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Cesta k súboru Service Account kľúča vo formáte JSON (povolenia pre Firestore zápis) |

Príklad spustenia:

```bash
GEMINI_API_KEY="..." \
GOOGLE_APPLICATION_CREDENTIALS="./service-account.json" \
node scripts/batch-match-ingredients.js
```

## Vytvorenie vlastného Firebase projektu (voliteľné)

Aplikácia je predvolene napojená na existujúci projekt `mealbuddy-ba30f`. Ak by bolo potrebné nasadiť ju do nového projektu:

1. Vytvor Firebase projekt na [console.firebase.google.com](https://console.firebase.google.com).
2. Aktivuj služby: Authentication (Email/Password, Google, Anonymous), Cloud Firestore a Cloud Storage.
3. Konfiguračné údaje skopíruj do `src/firebase.js` (pole `firebaseConfig`).
4. Nahraj pravidlá `firestore.rules` a `storage.rules` cez Firebase CLI:

```bash
firebase deploy --only firestore:rules,storage
```

5. Spusti scrapery a batch skripty (pozri nižšie) na naplnenie databázy.

## Prehľad súborov v projekte

```
mealbuddy/
├── App.js                 # Auth, onboarding, hlavná navigácia
├── index.js               # Vstup Expo
├── app.json               # Konfigurácia Expo (package name, ikony)
├── eas.json               # Profily buildu (APK / AAB)
├── package.json
├── firestore.rules        # Pravidlá Firestore
├── firestore.indexes.json
├── storage.rules
│
├── src/
│   ├── firebase.js        # Firebase klient (Auth, Firestore, Storage)
│   ├── navigation/        # RootNavigator, MainTabs, stacky, openRecipeDetail
│   ├── screens/           # Obrazovky aplikácie
│   │   ├── HomeScreen.js
│   │   ├── RecipesScreen.js, RecipeDetailScreen.js, CreateRecipeScreen.js
│   │   ├── PlanScreen.js
│   │   ├── ShoppingListScreen.js
│   │   ├── PantryScreen.js
│   │   ├── BudgetScreen.js
│   │   ├── ProfileScreen.js, HouseholdScreen.js, FoodPricesScreen.js
│   │   ├── AuthScreen.js, OnboardingScreen.js
│   ├── hooks/             # useProfile, useRecipes, usePantry, usePlan, …
│   ├── services/
│   │   ├── firestore/     # profiles, recipes, plans, pantry, nákupy, …
│   │   ├── pricing/       # Cena receptu, špajza, lacnejšie alternatívy
│   │   ├── shopping/      # Výpočet nákupného zoznamu
│   │   ├── llm/           # Čítanie cache mapovania ingrediencií
│   │   ├── recommend/     # Odporúčania na Domove
│   │   ├── prices.js      # Lookup cien z kolekcie prices
│   │   └── normalize.js   # Slovník ingrediencií → produkt
│   ├── components/        # UI (Button, Card, …)
│   ├── constants/         # Diéta, vybavenie (profilePrefs)
│   ├── theme/             # Farby, typografia, svetlý/tmavý režim
│   └── utils/             # Dátumy, rozpočet, normalizácia ingrediencií
│
├── scripts/               # Skripty použité pri naplnení DB (pozri nižšie)
│   ├── scrape-cenyslovensko.js
│   ├── scrape-recepty-sk-categories.js
│   ├── scrape-recepty-sk.js          # pomocný modul pre parsovanie Recepty.sk
│   ├── seed-common-ingredients.js
│   ├── batch-match-ingredients.js
│   └── batch-cheaper-alternatives.js
│
└── assets/                # Ikona, splash obrazovka
```

Komentáre `//` v `src/` stručne popisujú účel modulov.

## Dáta vo Firebase (už pripravené)

Aplikácia predpokladá existujúcu Firestore databázu. Hlavné kolekcie:

| Kolekcia | Obsah |
|----------|--------|
| `profiles/{uid}` | Profil, rozpočet, diéta, vybavenie |
| `recipes/{id}` | Recepty (zdroj: Recepty.sk) |
| `prices/{id}` | Cenník |
| `ingredient_price_mappings/{key}` | Mapovanie ingrediencia → produkt |
| `cheaper_alternatives/{key}` | Návrhy lacnejších alternatív |
| `plans/...`, `pantry/...`, `shoppingLists/...`, `purchases/...` | Plán, špajza, nákup, história |

### Skripty použité pri naplnení databázy

Tieto skripty **nie sú súčasťou behu aplikácie** — slúžili len na jednorazové naplnenie cloudu pri vývoji projektu:

1. `scrape-cenyslovensko.js` — ceny do `prices`
2. `scrape-recepty-sk-categories.js` — recepty z Recepty.sk do `recipes`
3. `seed-common-ingredients.js` — doplnenie bežných surovín do `prices`
4. `batch-match-ingredients.js` — mapovanie ingrediencií do `ingredient_price_mappings`
5. `batch-cheaper-alternatives.js` — generovanie záznamov do `cheaper_alternatives`

Zdroj receptov v databáze: **Recepty.sk**.

Zdroj cien v databáze: **Cenyslovensko.sk**.
