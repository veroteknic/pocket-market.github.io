# Pocket Market — game-first redesign plan

Status: **Phases 1–4 complete. Phase 5 not started.**
Last updated: 2026-11-25

This document tracks the game-first redesign brief separately from
`POCKET_MARKET_IMPLEMENTATION_PLAN.md`, which remains the historical roguelike implementation
record. The redesign brief is a presentation and interaction overhaul: it must preserve the shipped
market, backend, and run behaviour rather than replace them.

## Decision G-F1: source of truth

The redesign brief contains legacy wording about a 365-day progression system, but the shipped and
server-authoritative implementation uses **8 antes × 3 rounds**, round targets, bosses, jokers, and
shop currency. The current code is the source of truth. The 365-day value remains only as the shared
market's calendar-day display and will not be turned into a new round timer without a separate
approved gameplay change.

Unimplemented screens mentioned in the brief — Settings, Achievements, and a pre-round Ante
Selection screen — are recorded as gaps, not silently invented as fake functionality.

---

## Phase 1 — audit and preservation checklist

### Architecture summary

- Static GitHub Pages frontend with no framework, bundler, or build step.
- First-party frontend source: `index.html`, `style.css`, `game.js`.
- Backend: Cloudflare Worker in `worker/src/`, TypeScript with Vite and `cf`.
- One shared market in a SQLite Durable Object instance named `global-school-year-market-v12`.
- Frontend loads the Worker over HTTPS and WebSocket; it does not own market state.
- Manual asset cache-busting via `?v=…` query strings on `style.css` and `game.js`.

### 1. First-party files to preserve

- [x] `index.html` — screen markup, identity gate, dev console, cache-bust links.
- [x] `style.css` — tokens, CRT layers, screen transitions, responsive/card/playfield styling.
- [x] `game.js` — auth, WebSocket, API calls, rendering, run UI, dev controls, navigation.
- [x] `AGENTS.md` — contributor and authority rules.
- [x] `README.md` — deployment URLs, architecture summary, local dev and test commands.
- [x] `POCKET_MARKET_IMPLEMENTATION_PLAN.md` — historical phase tracker and known gaps.
- [x] `worker/src/index.ts` — routes, Durable Object, market ticks, accounts, runs, shop, dev API, trades, leaderboard.
- [x] `worker/src/run.ts` — authoritative run rules, scoring, bosses, lifecycle, migration.
- [x] `worker/src/jokers.ts` — 20-joker catalog, effects, deterministic shop generation.
- [x] `worker/test/run.test.ts`, `worker/test/jokers.test.ts`, `worker/test/phase7.test.ts`.
- [x] `worker/package.json`, `worker/cloudflare.config.ts`, `worker/vite.config.ts`, `worker/tsconfig.json`.

Excluded from redesign source: `worker/node_modules/`, generated `worker/.cloudflare/types/`, and
`worker/.dev.vars`. Do not commit or expose secrets. No `.github/` workflow is present.

### 2. Frontend architecture contracts

- [x] Keep the no-build static frontend contract; do not introduce a framework or heavy dependency.
- [x] Preserve `game.js` constants: starting cash, legacy `MAX_DAYS`, tick interval, backend URLs, fallback rules, screen whitelist.
- [x] Preserve boot visibility forcing and global-error recovery that prevents a black gate.
- [x] Preserve classic market rendering, daily summary, trade feedback, and leaderboard rendering.
- [x] Preserve current design infrastructure: tokens, CRT layers, screen transitions, reduced-motion rules.

### 3. Existing screens and navigation

Preserve every existing screen ID and the hash router. Current screens:

- Identity gate — `index.html:12-29`
- Main menu — `index.html:31-61`
- Trading floor — `index.html:63-210`
- Portfolio — `index.html:212-254`
- Jokers — `index.html:256-302`
- Score — `index.html:304-346`
- Results — `index.html:348-372`
- Collection — `index.html:374-402`
- Shop — `index.html:404-419`
- Boss — `index.html:421-437`
- Run setup — `index.html:439-467`
- Round intro — `index.html:469-487`
- Ante complete — `index.html:489-515`
- Run victory — `index.html:517-548`
- Run failure — `index.html:550-581`
- Run stats — `index.html:583-618`
- Dev console — `index.html:621-686`

Navigation contracts:

- [x] Screen whitelist `SCREEN_NAMES` in `game.js`.
- [x] `setScreen` / `transitionScreen` and `navigate` rules.
- [x] Auth/hash routing.
- [x] Classic-board escape hatch from the menu and classic/run floor switching.

Not present: Settings, Achievements, and dedicated pre-round Ante Selection screens.

### 4. API and WebSocket contract

Worker routes to preserve:

- `GET /api/market`, `GET /api/market/summary`, `GET /api/player`
- `POST /api/auth/register`, `POST /api/auth/login`
- `/api/run*` — start, load, lock, advance, retire
- `GET /api/jokers`
- `GET /api/shop`, `POST /api/shop/purchase`, `POST /api/shop/reroll`
- `/api/dev/status`, `/api/dev/login`, `/api/dev/market`, `/api/dev/player`, `/api/dev/run`
- `GET /api/leaderboard`
- `POST /api/trade`
- `/ws`

Frontend callers to preserve:

- [x] Daily summary and trade request hydration.
- [x] Player/auth load and login/register flow.
- [x] Leaderboard fetch/render.
- [x] Joker catalog and shop state.
- [x] Run APIs and shop purchase/reroll.
- [x] WebSocket connection, `market_update` handling, snapshot/broadcast semantics, shared market tick updates.

### 5. Auth, multiplayer, and authority

- [x] Server authority for prices, time, trades, player balances, holdings, events, scoring, shop transactions, and leaderboard.
- [x] PBKDF2 password hashing/verification, credential validation, registration, login, and cookie setting.
- [x] Server-side developer authorization and dev console actions.
- [x] One shared Durable Object market for all players.
- [x] Current leaderboard ranks portfolio value (cash + holdings), not roguelike score; do not relabel it as a run-score board without backend work.

### 6. Persistence and run state

- [x] Browser-local UI state only: player name cache, chart range, CRT/sound toggles, career stats display cache.
- [x] Server-side versioned `RunSaveV1` with migration.
- [x] Run open/start/lock/advance/retire and shop state stored in the run save.
- [x] Storage keys `run:<playerId>`, `legacy:<playerId>`, `runArchive:*` and archival behaviour.
- [x] Client hydration: load run, apply run account, prepare floor.

### 7. Existing mechanics and dependencies

- [x] Authoritative rules: 8 antes, 3 rounds per ante, 10,000 starting cash, trade-history limits.
- [x] Score targets from server rules.
- [x] Server-computed `chips × mult`; money is never multiplied.
- [x] Boss rules and boss application during scoring.
- [x] 20 jokers, five rarities, deterministic effects and shop generation.
- [x] Purchase-triggered shared market events broadcast over WebSocket.
- [x] Worker test suites and commands: `npm run typecheck`, `npm run build`, `npm test`.

Not present: consumables, permanent upgrades, joker slot cap, tick-boundary auto-lock, cash-zero
bankruptcy failure, persistent discovery/unlocks, post-round reward choice, results leaderboard
placement/run duration.

### 8. Deployment and cache-busting

- [x] Production frontend: `https://veroteknic.github.io/pocket-market.github.io/`.
- [x] Production Worker: `https://pocket-market-worker.unpaidandpoor.workers.dev`.
- [x] No production `localhost` URLs.
- [x] Manual cache-busting on both `style.css?v=…` and `game.js?v=…`; bump on every frontend change.
- [x] Worker deployment only with explicit authorization; frontend Pages deployment occurs on push to `main`.
- [x] Verification commands: `node --check game.js`, Worker typecheck/build/test, mock-browser QC, production DOM/console check.

### 9. Recorded contradictions and stale areas

- 365-day wording conflicts with shipped ante/round progression. Resolution: Decision G-F1.
- Planned tick-boundary round timing conflicts with manual round lock. Current manual lock remains authoritative.
- Brief says the gate covers the page until authenticated; current boot forces the menu visible and re-shows the gate on `/api/player` 401. Network failures intentionally do not re-show the gate to avoid a permanent black screen.
- Settings/Achievements/Ante Selection screens are absent.
- Failure is target miss, not bankruptcy/cash-zero.
- Existing implementation plan contains stale claims (“Automated tests: None”, “no round/scoring/jokers/shop”) that will be corrected separately, not used as design truth.

### 10. Redesign guardrails

- Do not move cash, holdings, scoring, shop purchases, boss effects, or final run progression into client-side authority.
- Do not fork or simulate the shared market in the browser.
- Do not remove the classic-board path.
- Do not forget cache-bust bumps on both frontend assets.
- Do not commit `worker/.dev.vars`, `.env*`, `node_modules`, or generated output.
- Treat reconnect and duplicate-action hardening as unfinished Phase 7 work.
- Preserve reduced-motion support and scoring fast paths.
- Update this document after each redesign milestone.

---

## Phase tracker

| Phase | State | Notes |
| --- | --- | --- |
| 1 — Audit and preservation checklist | **Complete** | This document. |
| 2 — Design tokens, typography, surfaces, animation system | **Complete** | Specified terminal palette applied as root tokens; radius/motion/easing tokens added; reusable terminal-enter/pulse/sweep primitives with reduced-motion guards; visible surface radii converted; generic gradients removed from HUD/score/joker/market surfaces; flat distinguishable rarity colours. |
| 2b — Run flow: scoring → shop → market | **Complete** | After scoring a round, the player flows into the Shop screen instead of jumping to floor/menu. Shop-back returns to the next run screen (floor, boss intro, ante-complete, or results) based on runState. No menu detour between scoring, shopping, and the next market round. Verified: syntax, 51/51 browser flow checks, 4/4 responsive layout audits, 17/17 production checks. |
| 2c — Less texty, more buttony UI | **Complete** | Removed useless flavourtext: menu rules line, bankroll sub-note, "It aint money" footer jab, floor mode label, setup/intro/ante-complete/victory explanatory paragraphs, hostile colophon copy. Replaced colophon with clean disclaimer ("Fake money. Not real trading."). Buttons remain the primary action surfaces throughout. Verified: syntax, 51/51 browser flow checks, 4/4 responsive layout audits, 17/17 production checks. |
| 2d — Subtle element-only shake | **Complete** | Screenshake targets the affected element only (company row on trade, news panel on market event, score total on round clear), never the whole screen. Magnitudes reduced to tiny translations/barely-there rotation so it reads as a tactile button reaction. Verified: syntax, 51/51 browser flow checks, 4/4 responsive layout audits. |
| 2e — Version bump, CHANGELOG, global update dialog | **Complete** | Added `VERSION` constant and `CHANGELOG.md`. Added a quickly dismissable global update dialog that shows the latest changelog when the shipped version changes; acknowledged version stored in `localStorage`. Cache-bust bumped to `?v=2026-11-25-update-dialog`. Verified: syntax, 51/51 browser flow checks, 4/4 responsive layout audits. |
| 2f — Joker preview activation | **Complete** | Owned Jokers lighting up in the market rail when they contribute to the live preview, with per-Joker value badges, a contribution strip beneath the HUD, a short lift + existing joker cue when a trade makes one newly relevant, and display-only mirroring of Worker triggers. Server remains authoritative for locked scores. Verified: syntax, 55/55 browser flow checks, 4/4 responsive layout audits. |
| 3 — Rebuild trading terminal | **Complete** | Object-based board focus, game-first menu hierarchy, subordinate supporting panels, fill feedback, and distinct counter/tally-sheet/challenge-card compositions for Shop/Results/Boss. Market/trade APIs and run HUD behaviour unchanged. Verified: syntax, 65/65 browser flow checks, 4/4 floor layout audits, 12/12 per-screen responsive audits. |
| 4 — Content depth for Jokers, shop, scoring, boss | **Complete** | Owned Joker cards carry their effect kind and value; Shop cards expose Owned/Need N states on the object and control; scoring effects are numbered and name their Joker source; Boss rules have an explicit Rule label. Display/presentation only; no new mechanics, no authority changes. Verified: syntax, 72/72 browser flow checks, 4/4 floor layout audits, 12/12 per-screen responsive audits. |
| 5 — Redesign menu, results, settings, leaderboard | **Complete** | Menu run summary now shows whenever a run exists (not only trading/scoring); collection cards carry effect kind and value on the object; results round history flags boss rounds; menu footer has a Sign out button that clears localStorage and returns to the name gate. Settings absent by design; leaderboard unchanged on floor. Presentation only; no new mechanics, no authority changes. Verified: syntax, 75/75 browser flow checks (added sign-out check), 4/4 floor layout audits, 12/12 per-screen responsive audits. |
| 6 — Mobile and accessibility | Not started | 44px touch targets, keyboard focus, semantic controls, reduced motion. |
| 7 — Regression, multiplayer, deployment testing | Not started | Include Worker tests, mock-browser QC, responsive audits, production checks. |

## Phase 2 record — 2026-11-24

Applied the specified terminal palette as root tokens (`#171916`, `#292D26`, `#E9E1CE`, `#D49B48`,
`#78A77B`, `#C76A60`, `#85877C`). Existing font stacks already provide editorial serif display,
sans UI and monospaced financial type; tabular numerals remain on numeric fields. Added radius,
motion-duration, easing and reusable `terminal-enter` / `terminal-pulse` / `terminal-sweep`
primitives with reduced-motion guards. Converted visible surface radii to the new tokens and removed
generic gradients from HUD blocks, score reveal lines, joker art backdrops and market rows. Rarity
edges now use flat, distinguishable terminal colours. No markup, game logic, API call or backend
behaviour changed in this pass.

Verified: syntax, 51/51 browser flow checks, 4/4 responsive layout audits, 17/17 production checks.

## Phase 3 audit — where the UI still reads as a website

Reviewed against the Balatro-inspired design brief (principles only, no copied art/layout/branding):

- **Resolved in 2f/3:** Jokers were passive information; they now light up and sound when they affect the preview. The board had no focus concept; selecting a security now drives the tape and gives that row a brass edge. Redundant captions and the last flavourtext label are gone.
- **Resolved in 3a:** the menu leads with one dominant Start/Continue action and a compact secondary grid; dispatches and the leaderboard use subordinate typography; a fill lights up the newly held row and the marker survives tick redraws. All existing control IDs and the classic-board escape hatch remain.
- **Resolved in 3b:** Shop is a counter with a currency plaque, Results is a tally sheet with the score as a bordered object, and Boss is a framed challenge card with a glyph object. No screen relies on a generic header-plus-panel template.
- **Resolved in 4:** cards and scoring rows now carry their own state and provenance instead of hiding it in a detail panel or relying on order alone: Joker effect badges, Shop Owned/Need N badges, numbered scoring steps with Joker names, and a labelled Boss rule.
- **Not in scope:** new gameplay, backend changes, settings/achievements invented as placeholders.

## Phase 3a record — 2026-11-25

Changed only frontend markup, CSS and display-only feedback: `.menu-actions` now contains a large
primary button and a two-column `.menu-secondary` cluster; `.lower-grid h2` is small uppercase mono
so supporting panels sit below the board in the hierarchy; `filledMarker` reapplies an `is-filled`
class after each table render so a real market tick cannot erase the order consequence. Shake now
cleans up the previously shaken element and aims at the redrawn row. Reduced-motion disables the
fill animation and shake. No scoring, trading, shop, run, or authority logic changed.

Verified: syntax, 62/62 browser flow checks, 4/4 responsive layout audits, screenshots captured
(menu, floor, score, shop, jokers, portfolio, mobile).

## Phase 3b record — 2026-11-25

CSS-only screen-identity pass. `.shop-head` is now a three-column grid with a brass-bordered currency
plaque; it collapses to a two-row grid on small screens. `.results-head` places the title and the
final score in separate grid areas, with the score carrying a brass edge; it stacks on mobile.
`.boss-card` is a framed object with an inset rule and a dedicated glyph square. No markup, game
logic, API call, run flow, or backend behaviour changed.

Verified: syntax, 65/65 browser flow checks (added per-screen composition assertions), 4/4 floor
layout audits, 12/12 Shop/Results/Boss responsive audits (`pm-qc/screens.mjs`), screenshots captured
including results and boss.

## Phase 4 record — 2026-11-25

Presentation-only content-depth pass. `renderJokersScreen` now appends a compact effect line to each
owned Joker card using the same `jokerEffectLabel` / `jokerValueLabel` helpers as the detail panel.
`renderShopScreen` adds `is-owned` and `is-unaffordable` card states plus a Need N button label; the
CSS draws the matching badge on the card object so a disabled offer explains itself. `renderScoreScreen`
adds a two-digit step number and a Joker source name to each effect row, and `.boss-detail::before`
adds a small Rule label. No score, price, currency, shop inventory, run, or authority logic changed.

Verified: syntax, 72/72 browser flow checks (seven added assertions for content states, labels, and
binary-float preview formatting), 4/4 floor layout audits, 12/12 Shop/Results/Boss responsive audits,
screenshots including the new post-purchase shop state. No Worker change or deploy.

Hotfix 2026-11-25.8: preview-only multiplier values are rounded to two decimals before they reach a
label, and `jokerContributionLabel` / `jokerValueLabel` format defensively. A three-round Diamond Hands
streak now reads `+0.9× mult` instead of exposing `0.8999999999999999`. The server still owns the
locked score; only display formatting changed.

## Phase 5 record — 2026-11-25

Presentation-only hierarchy pass. `renderMenu` now shows the run summary (Ante, Round, Target, Score)
whenever `runState` exists, not only during trading/scoring phases, so the summary stays visible after
a round ends. `renderCollectionScreen` appends a compact effect line to each collection card using the
same `jokerEffectLabel` / `jokerValueLabel` helpers as the jokers screen. `renderResultsScreen` flags
boss rounds in the round history with a brass "Boss" tag. The menu footer gains a Sign out button that
removes `pocket-market-player-name` from localStorage and returns to the name gate. No score, price,
currency, shop inventory, run, or authority logic changed.

Verified: syntax, 75/75 browser flow checks (added sign-out check), 4/4 floor layout audits,
12/12 Shop/Results/Boss responsive audits. No Worker change or deploy.

Hotfix 2026-11-25.10: added a Sign out button to the menu footer. Clears the player name from
localStorage and re-shows the identity gate, so you can sign in as a different player (or re-enable
dev mode with `veroteknik` / `veroteknic`). No Worker change or deploy.

## Next milestone

Phase 6: mobile and accessibility pass — 44px touch targets, keyboard focus, semantic controls,
reduced-motion support, and no horizontal overflow across all screens. Keep the server authoritative
for scores, shop inventory, purchases, and run progression. No Worker change or deploy without
explicit authorization.
