# Skripty na naplnenie databázy

Tieto skripty **nie sú súčasť behu aplikácie** — slúžili na jednorazové naplnenie Firestore pri vývoji.

| Skript | Účel |
|--------|------|
| `scrape-cenyslovensko.js` | Ceny do kolekcie `prices` |
| `scrape-recepty-sk-categories.js` | Recepty z Recepty.sk do `recipes` |
| `seed-common-ingredients.js` | Doplnenie bežných surovín do `prices` |
| `batch-match-ingredients.js` | Mapovanie ingrediencií do `ingredient_price_mappings` |
| `batch-cheaper-alternatives.js` | AI návrhy lacnejších náhrad do `cheaper_alternatives` |

`scrape-recepty-sk.js` je pomocný modul pre parsovanie Recepty.sk (volaný z `scrape-recepty-sk-categories.js`).

Pred spustením nastav:

- `GOOGLE_APPLICATION_CREDENTIALS` — cesta k service account JSON 
- `GEMINI_API_KEY` — pre `batch-match-ingredients.js` a `batch-cheaper-alternatives.js`
- `GEMINI_MODEL` (voliteľné) — predvolene `gemini-2.5-flash`
