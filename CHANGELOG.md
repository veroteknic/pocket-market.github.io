# Pocket Market — Changelog

## 2026-11-25.3 — Game-first board focus

- Selecting a security on the market board now brings it into focus with a brass edge; the price-history tape follows the same selection. One source of truth keeps the two in sync.
- Removed remaining website-like text: the "this is too hard..." retire label is now "Retire run", and redundant Portfolio/Jokers masthead captions are gone.

## 2026-11-25.2 — Joker preview activation

- Owned Jokers now visibly mark when they contribute to the live round-score preview: the rail card gains a brass state and a value badge, and a contribution strip beneath the HUD lists each contributing Joker with its effect (+25 chips, +0.25× mult, etc.).
- When a trade makes a Joker newly relevant, its card lifts briefly and the existing joker cue plays — tactile feedback without recalculating any score in the browser.
- The display-only preview mirrors the Worker's Joker triggers (market direction, rising/falling holdings, trade count, held-round streak) but the server remains the only source of the locked score.
- Added `data-joker-id` to rail cards so their state can be verified in tests.

## 2026-11-25 — Update dialog, version bump

- Added a global version tracker (`VERSION`) and a quickly dismissable update dialog that shows the latest changelog when the shipped version changes. The acknowledged version is stored in `localStorage` so the dialog only appears once per release.
- Bumped asset cache-bust to `?v=2026-11-25-update-dialog`.

## 2026-11-24 — Subtle shake, less texty UI

- Screenshake now targets the affected element only (company row on trade, news panel on market event, score total on round clear) instead of shaking the whole screen.
- Shake magnitudes reduced to tiny translations/barely-there rotation so it reads as a tactile button reaction, not a seizure.
- Removed useless flavourtext: menu rules line, bankroll sub-note, "It aint money" footer jab, floor mode label, setup/intro/ante-complete/victory explanatory paragraphs, and the hostile colophon copy.
- Replaced colophon with a clean disclaimer: "Fake money. Not real trading."
- Made buttons the primary action surface throughout; shop-back now reads "Continue".

## 2026-11-24 — Run flow: scoring → shop → market

- After scoring a round, the player flows into the Shop screen instead of jumping to floor/menu.
- Shop-back returns to the next run screen (floor, boss intro, ante-complete, or results) based on `runState`.
- No menu detour between scoring, shopping, and the next market round.

## 2026-11-24 — Terminal theme (Phase 2)

- Applied the specified terminal palette as root tokens: `#171916` void, `#292D26` graphite panels, `#E9E1CE` ledger cream, `#D49B48` exchange brass, `#78A77B` market green, `#C76A60` market red, `#85877C` terminal grey.
- Added radius, motion-duration, easing, and reusable terminal animation primitives (`terminal-enter`, `terminal-pulse`, `terminal-sweep`) with reduced-motion guards.
- Converted visible surface radii to the new tokens; removed generic gradients from HUD, score reveal, joker art, and market surfaces.
- Flat, distinguishable rarity colours.

## 2026-11-24 — Last-round Joker activations on market rail

- The Market joker rail marks which Jokers fired in the last scored round, reading effect values from server round history (no browser score recalculation).
- Fired cards get a brass border and an effect badge; a "Last round · N fired" label appears in the rail header.

## 2026-11-23 — Arcade playfield

- Market rows render as physical company cards from tablet width up, keeping the same table markup, IDs, and controls.
- Compact active-joker rail links into the Jokers screen.
- Chips × mult HUD includes a server-authoritative target plaque with progress fill.
- Tablet breakpoint and trade-button height fixes.
