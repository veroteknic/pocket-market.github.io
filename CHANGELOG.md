# Pocket Market — Changelog

## 2026-11-25.12 — Preview parity regression

- Fixed the display-only Joker preview using the per-ante round number instead of the Worker's global round index. Diamond Hands and Compound Interest now read correctly from Ante 2 onward.
- Final scores were never affected: scoring stays server-authoritative.
- Regression coverage now exercises every Joker trigger and a refresh during a shop visit.

## 2026-11-25.11 — Settings, achievements and accessibility

- Added a Settings screen for sound, CRT, reduced motion and the default chart view. These use the preferences already stored in the browser.
- Added an Achievements screen with nine goals. They unlock from real career stats — finished runs, survived rounds, cleared bosses and antes, run scores and discovered Jokers.
- Career stats are now actually recorded when a run reaches results, and discovering a Joker happens as soon as the server confirms the purchase.
- Reduced motion can now be turned on in Settings without changing your system preference.
- 44px minimum touch targets for small controls, visible keyboard focus on summaries and tabbable elements, and labelled settings toggles.

## 2026-11-25.10 — Sign out

- Added a Sign out button to the menu footer. Clears your player name from localStorage and returns to the name gate, so you can sign in as a different player (or re-enable dev mode with `veroteknik` / `veroteknic`).

## 2026-11-25.9 — Menu, collection and results hierarchy

- The menu run summary now shows whenever a run exists, not only while trading or scoring — so Ante, Round, Target and Score stay visible after a round ends.
- Collection cards now carry their effect kind and value on the object, so rarity groups can be scanned at a glance without opening each detail panel.
- Results round history now flags boss rounds, so the run arc reads at a glance.
- Added browser QC checks for menu summary visibility, collection effect lines and boss round labels.

## 2026-11-25.8 — Clean multiplier labels

- Fixed Joker preview badges showing binary-float artefacts such as `+0.8999999999999999× mult`; a three-round Diamond Hands streak now reads `+0.9× mult`.
- Additive multiplier Jokers now show their `×` unit on their card as well as in the preview strip.
- Added a regression check that exercises the exact float-artifact case.

## 2026-11-25.7 — Content depth and readable states

- Owned Joker cards now show their effect kind and value on the card itself, so a collection can be compared without opening each detail panel.
- Shop cards now state their state on the object: Owned, or Need N when credits are short; the buy button repeats the same information for keyboard and screen-reader users.
- Scoring effects are numbered and name the Joker that produced them, making the calculation order legible without changing any score values.
- Boss rules now carry an explicit Rule label instead of relying on a bare sentence.
- Expanded browser QC to cover the new card states, effect labels, numbered steps and boss label.

## 2026-11-25.6 — Screen identity pass

- Shop now reads as a counter: centred title, an exit, and a brass currency plaque holding credits and reroll.
- Results now reads as a tally sheet: the final score is a bordered object beside the run title instead of another heading.
- Boss rounds now have a single framed challenge card with a dedicated glyph object, distinct from a content panel.
- Added a dedicated responsive audit for Shop, Results and Boss at 1440/1024/768/390 px.

## 2026-11-25.5 — Game-first menu and fill feedback

- The main menu now has one dominant Start/Continue action with a compact grid of secondary controls, instead of a flat list of links.
- Dispatches and the daily leaderboard are visually subordinate to the board so the trading floor reads as one game screen with supporting information.
- A filled order now lights up its board row after the table redraw and survives market ticks; impact shake targets the redrawn row. Reduced-motion preferences still disable the effect.

## 2026-11-25.4 — Update dialog fix

- Fixed a bug where dismissing the update dialog threw an error and failed to remember the version, causing the dialog to reappear on every load.

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
