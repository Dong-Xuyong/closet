# Closet

Dong's wardrobe for GitHub Pages: a daily outfit suggestion, a visual catalog, and a wear log. Live at [dong-xuyong.github.io/closet](https://dong-xuyong.github.io/closet/).

No build step. GitHub Pages serves this folder as-is.

## Views

- **Today** — weather for Guimarães from Open-Meteo, with a temperature control and a rain toggle if you want to override it. Occasion chips feed the suggestion engine, which shows the top 3 looks on a 4:5 studio board. Tap a piece to swap it, log the look as worn, or save it.
- **Closet** — owned, wishlist, ordered, and archived pieces. Filter by category, formality, color, and occasion. Open a piece for the full etiquette card, or add and edit one. A photo upload is compressed to a small data-URL on `image`.
- **History** — worn outfits, newest first, with a 1–5 star rating.

The home control returns to [dong-xuyong.github.io](https://dong-xuyong.github.io/).

## Data

`data/seed-closet.json` is the starter wardrobe (18 owned pieces, 7 wishlist, the 2000s Mafia Boss outfit). The app copies it into this browser the first time it opens, so it works before any GitHub token.

**Sync** reads and writes `closet.json` in `Dong-Xuyong/progress-sync` through `dong-ui/gh-sync.js`. The token stays in `localStorage` under `dong-gh-sync`, shared with Dong's other apps. Logging a wear, editing a piece, or saving an outfit writes locally and, once a token is stored, syncs quietly.

Conflict handling for this file:

- `items` merge by `id`. The newer `meta.updatedAt` wins. Archive instead of deleting.
- `outfits` merge by `id`. The newer `updatedAt`, or `createdAt` when there is no update time, wins.
- `wearLog` is append-only and unions by `id` (`wear_YYYYMMDD_xxxx`).

## Images

Studio renders live at `images/<item-id>.webp` (4:5, about 800×1000, on `#F5F5F3`) and are referenced by `items[].image`, for example `images/cl_black_trousers.webp`. Full URLs and data-URLs work too. A missing image becomes a color-and-category card, not a broken icon.

## Tests

```bash
node --test
```

The suite covers layering, formality, color and pattern limits, `avoidWith`, the soft clash penalties, wear-log rotation, swaps, wear logging, and the closet merge used by `gh-sync.js`.
