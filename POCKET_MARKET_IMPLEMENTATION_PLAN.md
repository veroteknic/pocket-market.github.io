# Pocket Market — Roguelike Transformation Plan

Status: **Phases 0–8 implemented; game-first redesign Phases 1–4 complete. Phase 9/10 outstanding.**
Last updated: 2026-11-25
Source specification: `AGENTS.md`, section “MY SECTION”.

The separate game-first redesign brief is tracked in
`POCKET_MARKET_GAME_FIRST_REDESIGN_PLAN.md`. Its Phase 1 preservation checklist supersedes stale
claims in this historical plan where they conflict with shipped code.

Latest milestone: the game-first content-depth pass made Joker, Shop, Scoring and Boss states legible
on the objects themselves without changing gameplay or server authority. Details and verification are
recorded in the redesign brief.

This document is the working plan required by the specification. It records what exists
today, what the roguelike architecture will be, how the existing game will be migrated
safely, and the order of work. It should be updated at the end of every milestone.

---

## 1. Executive summary

Pocket Market today is a single-page fake-money stock market. A static GitHub Pages
frontend talks to one Cloudflare Worker backed by one SQLite Durable Object. All players
share one market and one set of accounts. There is no round structure, no run state, no
scoring engine, no jokers, and no shop.

The transformation adds a second, per-player system on top of the shared market:

- The **market** stays global and authoritative: one set of prices, ticks, events,
  sentiment, and history for everyone.
- A **run** becomes the player’s roguelike layer: ante, round, target, chips, multiplier,
  jokers, consumables, scrip, shop, and run history.
- The run owns the player’s active trading portfolio. Failure ends a run; it does not
  delete the account, identity, or history.
- Score is `chips × mult` and is computed only from round trading performance and owned
  modifiers. Money never receives a multiplier.

The existing market, accounts, sessions, daily summaries, developer tools, WebSockets,
and leaderboard data are preserved. All new state is additive and versioned.

---

## 2. Current architecture (verified audit)

### 2.1 Repository and deployment

| Item | Current state |
| --- | --- |
| Frontend | Plain HTML, CSS, and classic JavaScript. No framework, no bundler, no build step. |
| Backend | One Cloudflare Worker in `worker/src/index.ts` (786 lines). |
| Shared state | One SQLite-backed Durable Object class `Market`, instance `global-school-year-market-v12`. |
| Frontend host | GitHub Pages from `main` at `https://veroteknic.github.io/pocket-market.github.io/`. |
| Backend host | `https://pocket-market-worker.unpaidandpoor.workers.dev`. WebSocket at `/ws`. |
| Deployment | Push to `main` builds Pages. Worker deployed with `cf deploy` from `worker/`. |
| Build checks | `worker/npm run typecheck`, `worker/npm run build`, `node --check game.js`. |
| Automated tests | None. Verification is manual plus temporary Node scripts. |
| Dependencies | Vite, `cf`, TypeScript only, and only for the Worker. No runtime frontend dependency. |

Asset cache-busting is manual (`style.css?v=…`, `game.js?v=…` in `index.html`). Every
frontend change must bump both values.

### 2.2 Frontend structure

`index.html` (169 lines) contains:

- A full-screen identity gate (`#identity-gate`) shown until `/api/player` succeeds.
- One dashboard `<main>`: masthead, tick strip, status bar, market table, chart panel,
  news, daily recap, and leaderboard.
- A fixed developer console `<aside>` visible only to configured names, authorized
  server-side by `DEV_PASSWORD`.

`game.js` (911 lines) is a single classic script. Important behaviour:

- Global mutable `state` with `day`, `cash`, `companies[]`, `tick`, `tickDeadline`.
- `render()` rebuilds the whole market table with `innerHTML` on every tick. This resets
  share inputs and re-creates buttons roughly every 15 seconds. It works, but it is a
  known UX defect and must be replaced by targeted updates in the roguelike UI.
- One WebSocket. The opening frame includes `history`; live frames omit it and the client
  folds prices in with `appendPoint`.
- Tick meter is a 100 ms `setInterval` anchored to real server tick arrival.
- `renderLeaderboard()` is called on **every market tick**, which means one
  `/api/leaderboard` request per client every 15 seconds.
- Trades apply the server response immediately, then the broadcast confirms the tape move.
- Sound is synthesized with Web Audio, gated by `localStorage` and reduced-motion.
- Chart supports Day / Week / All, scales to the selected window, and reports coverage.
- No routing, no screens, no save abstraction beyond `localStorage` preferences.

`style.css` (450 lines) is a hand-written design system with CSS variables:

- Near-black `--void`, warm brown surfaces, cream ink, brass structure, crimson accent,
  mint gain, coral loss, gold highlight.
- CRT overlay (scanlines, aperture mask, vignette, bloom, flicker) toggled by `data-crt`.
- Existing motion: button pop, screen shake, price flash, event flash, number rolling,
  tick pulse.
- `prefers-reduced-motion` is already respected by shake, punctuation, tap, and rolling
  numbers.
- No cards, no screen transitions, no rarity tokens yet.

### 2.3 Backend structure

The Worker is a router in front of one Durable Object. Every endpoint calls
`env.MARKET.getByName("global-school-year-market-v12")`.

Current routes:

| Route | Purpose |
| --- | --- |
| `GET /api/market` | Full market snapshot including history. |
| `GET /api/market/summary` | Current partial daily recap plus up to six stored closed days. |
| `GET /api/player` | Signed-in player record. |
| `POST /api/auth/register` | Create account, hashed password, session cookie. |
| `POST /api/auth/login` | Authenticate, new session cookie. |
| `GET /api/dev/status` | Whether this session has developer rights. |
| `POST /api/dev/login` | Promote session using `DEV_PASSWORD`. |
| `POST /api/dev/market` | Force boom/crash or set sentiment. |
| `POST /api/dev/player` | Set cash/holding, reset, or delete an account by name. |
| `GET /api/leaderboard` | Top ten by live portfolio value. |
| `POST /api/trade` | Server-validated buy/sell with impact and broadcast. |
| `GET /ws` | WebSocket upgrade handled by the Durable Object. |

### 2.4 Durable Object storage keys

| Key | Contents |
| --- | --- |
| `market` | `MarketState`: day, tick, updatedAt, prices, history, orderFlow, sentiment, event, daily. |
| `player:<uuid>` | `PlayerState`: name, cash, holdings, costBasis, realizedProfit. |
| `user:<lowercase-name>` | `UserRecord`: playerId, passwordHash. |
| `session:<token>` | `SessionRecord`: playerId, optional developer flag. Older rows are bare playerId strings. |
| `summary:<dateKey>` | Closed `DailySummary`. |
| `ranks:<dateKey>` | Previous daily rank/rankChange per player. |

All of this lives in one Durable Object, so every read and write is serialized. That is a
real constraint: it makes transactions easy to keep correct, but it also means new
per-run endpoints must stay small and must not scan the world unnecessarily.

### 2.5 Existing economy — exact behaviour

- New accounts start with `cash = 10000`, no holdings, no cost basis.
- A buy validates cash, fills at `quote × (1 + impact/2)`, increases holdings and cost
  basis by the total spent.
- A sell validates shares, fills at `quote × (1 − impact/2)`, increases cash, reduces
  holdings, and books realized profit against average cost.
- Impact is `min(0.08, 0.0006 + quantity × 0.0007)`, so orders up to 1000 shares move the
  tape by at most 8%. The execution price slips half the impact; the tape moves the full
  impact for everyone.
- Trades cap at 1000 shares per request.
- Trade fills update `market.updatedAt`, append a real history point, adjust daily
  high/low, add order flow, persist, and broadcast. This is already server-authoritative.
- Portfolio value is `cash + Σ(price × shares)`. The leaderboard uses this, top ten.
- Market ticks every 15 seconds via a Durable Object alarm. Each tick costs two row
  writes (market `put` and `setAlarm`).
- Each tick has a 10% chance of a random global or company event. Events last one tick.
  Sentiment decays and is pushed by order flow and noise.
- Prices use per-ticker volatility plus order-flow pressure, sentiment, and event effect.
- History keeps the newest 720 points at full resolution and halves older points when the
  series exceeds 1440. Live broadcasts omit history.

Free-plan Durable Object limits are 100,000 requests/day and 100,000 rows written/day.
At 15 seconds the market uses about 11,520 writes/day. Any per-run write budget must fit
inside the remaining headroom. This is an architectural constraint, not an implementation
detail.

### 2.6 Leaderboard implementation

`getLeaderboard()` lists every `player:` row, computes live portfolio value, sorts, trims
to ten, persists rank movement under `ranks:<dateKey>`, and returns name/score/rank/change.
It is O(number of players) and is currently called every 15 seconds per client. Before the
player base grows this must become cached or incrementally maintained.

### 2.7 Developer tooling

The dev console is a real, useful tool and must survive the transformation. It currently
forces events, sets sentiment, sets cash/holdings, resets a player, and deletes accounts.
It is authorized server-side, not by name alone. Future run/shop/joker work should add
developer controls for starting/advancing/resetting runs so the new systems stay testable.

### 2.8 Deployment and compatibility

GitHub Pages serves static files only. Therefore:

- Routing must use the URL hash, not paths that need server rewrites.
- All assets must remain relative and versioned.
- No Node-only runtime code may leak into the browser.
- No new runtime dependency is justified unless it replaces a real capability gap.

---

## 3. Gaps between today and the target game

1. No screen architecture; everything is one dashboard.
2. No per-player run state, ante, round, target, or run history.
3. No scoring system, chips, multiplier, or scoring presentation.
4. No jokers, rarities, slots, collection, or synergies.
5. No shop, offers, rerolls, consumables, upgrades, or run currency.
6. No boss rounds or player-specific round rules.
7. Market events are global-only, one tick long, and not tied to scoring.
8. Leaderboard is market value only; no run score, ante, or completed-run boards.
9. No versioned save structure for runs and no idempotent transaction model.
10. No automated tests for scoring or transactions.
11. Frontend re-renders the entire table every tick and fetches the leaderboard every tick.
12. The “365 days” framing is still present in the UI and server day logic.

---

## 4. Proposed architecture

### 4.1 Two layers, one authority

```
                    ┌─────────────────────────────────────────┐
                    │        One Durable Object (Market)      │
                    │                                         │
  Browser  ──HTTP──▶│  Shared market: prices, ticks, events   │
  Browser  ──WS────▶│  Accounts: users, sessions, identities  │
                    │  Runs: per-player versioned run records │
                    │  Boards: cached leaderboard snapshots   │
                    └─────────────────────────────────────────┘
```

The Durable Object remains the single authority for both layers. Keeping runs in the same
object means a trade, a score calculation, and a run save can be committed atomically.
It also means the object is a scaling bottleneck; the plan treats that as an accepted
constraint for this project size and documents mitigations (cached boards, batched writes,
small run records).

Market state and run state are separate records. A run never mutates another player’s run.

### 4.2 Run data model (versioned)

New key: `run:<playerId>`.

```ts
type RunSaveV1 = {
  version: 1;
  runId: string;
  playerId: string;
  playerName: string;
  createdAt: number;
  updatedAt: number;

  // Progression
  ante: number;                // 1-based
  round: number;               // 1-based within ante
  phase: "trading" | "scoring" | "shop" | "boss-intro" | "results";
  roundStartedTick: number;    // market tick when the round opened
  roundDeadlineTick: number;   // server tick at which the round auto-locks
  roundStartValue: number;     // portfolio value snapshot at round open
  roundStartPrices: Prices;    // for movement/joker conditions
  roundStartHoldings: Holdings;

  // Trading account for this run
  cash: number;
  holdings: Holdings;
  costBasis: Partial<Record<Ticker, number>>;

  // Roguelike state
  scoreTotal: number;          // cumulative run score
  lastRoundScore: number;
  target: number;              // current round target
  scrip: number;               // run currency for the shop
  jokers: string[];            // owned joker IDs, ordered
  jokerSlots: number;
  consumables: string[];
  upgrades: string[];
  compoundStacks: number;      // for effects that grow per successful round
  seenJokers: string[];        // collection/unlock tracking

  // Deterministic shop
  shop: ShopSaveV1 | null;

  // History
  roundHistory: RoundResultV1[];
  bestRoundScore: number;
  completedAntes: number;
  seed: number;                // run seed
  rngCursor: number;           // deterministic cursor for shop/joker offers
  endReason?: "failed" | "retired" | "completed";
};
```

`RoundResultV1`:

```ts
type RoundResultV1 = {
  roundId: string;             // stable id, e.g. `${runId}:${ante}:${round}`
  ante: number;
  round: number;
  boss: boolean;
  target: number;
  score: number;
  chips: number;
  mult: number;
  pass: boolean;
  cashBefore: number;
  cashAfter: number;
  portfolioBefore: number;
  portfolioAfter: number;
  tradeCount: number;
  startedTick: number;
  endedTick: number;
  effects: ScoreEffect[];      // explicit, ordered score breakdown
  jokers: string[];
};
```

New key: `legacy:<playerId>` — archived pre-run portfolio and market-value stats when the
first run starts. Never deleted. Allows the existing economy to remain inspectable and
supports a future “Market Value” legacy board.

New key: `runArchive:<playerId>:<runId>` — completed/failed run summary, bounded to a
reasonable history (for example 20 runs), so run history survives a new run.

### 4.3 Run state machine

```
MAIN MENU ──Start/Continue──▶ RUN SETUP ──▶ ANTE INTRO
                                              │
                                              ▼
                                         TRADING FLOOR ──Lock In / Deadline──▶ SCORING
                                              ▲                                 │
                                              │                                 ▼
                                         SHOP ◀── pass ─────────────────── PASS/FAIL
                                              │                                 │
                                              │                                 ▼
                                              └──── next round ───────────── RESULTS
                                                                                │
                                                                                ▼
                                                                           MAIN MENU
```

Rules:

- `phase` is server-owned. The client requests transitions; the server validates them.
- A round opens on a market tick boundary and closes at `roundDeadlineTick` or when the
  player presses **Lock In** after at least one tick.
- The market keeps ticking for everyone regardless of one player’s phase.
- A failed round ends the run: archive the run, reset the active run, keep identity,
  collection progress, and legacy portfolio.
- A passed round pays scrip and opens a shop; the shop is deterministic from the run seed
  and round id, so refresh/reconnect returns the same offers.
- Boss rounds are normal rounds with a visible, data-driven rule applied during scoring.

### 4.4 Round timing model (recommended, configurable)

The market tick is the clock. Wall-clock time is displayed, but decisions use tick numbers.

- `RUN_RULES.roundTicks = 6` (90 seconds at the current 15-second tick).
- `RUN_RULES.minTicksBeforeLock = 1` (the first reprice must land before locking in).
- `RUN_RULES.maxTicks = 6` (auto-lock at the sixth tick).
- `RUN_RULES.roundsPerAnte = 3` — two normal rounds, one boss round.
- `RUN_RULES.antes = 8`.
- Targets scale per ante and round; exact curve lives in one rules module and is tuned
  with tests.
- A player who locks in early forfeits the remaining ticks; the shared market does not
  advance for them. This satisfies the specification’s requirement that an individual run
  cannot advance global time.

Why ticks rather than a client timer: the server already owns ticks, the tick is shared
by all players, it cannot be spoofed by the browser, and it keeps the market meaningful.
The constants are deliberately in one place so pacing can be changed after playtesting.

Open decision: this recommended 90-second round is a pacing choice, not a technical
requirement. See section 11.

### 4.5 Scoring engine

Two layers:

1. **Base chips** — derived from the round’s trading performance, not from absolute wealth.
2. **Effects** — jokers, boss rules, market conditions, and consumables applied in a
   fixed, documented order.

Recommended base formula (tunable):

```
roundReturn = (portfolioEnd - portfolioStart) / max(1, portfolioStart)
baseChips   = clamp(100 + 400 × roundReturn, 0, 900)
+ 25 per company held at round end
+ 20 per company with positive round movement
```

This makes trading skill matter, prevents “richer account = higher score”, and means
buy/sell spam cannot inflate the score because only the end snapshot and end-of-round
movement count. A separate `tradeCount` is recorded for jokers that reward activity, but
it is capped per round (`RUN_RULES.maxCountedTrades`, proposed 8) and cannot by itself
produce score.

Fixed effect order (must be explicit and tested):

1. Base portfolio chips.
2. Company/holding bonuses (diversification, blue chip, penny stock, etc.).
3. Additive chip bonuses.
4. Additive multiplier bonuses.
5. Multiplicative multiplier bonuses.
6. Conditional joker effects.
7. Boss-rule adjustments.
8. Final score = `max(0, chips) × max(0, mult)`.
9. Persist the ordered effect list for the scoring screen and run history.

The engine is a pure function:

```ts
scoreRound(input: ScoreInput): ScoreResult
```

`ScoreInput` contains only snapshot data: holdings, prices, start/end snapshots, market
movement, event, boss rule, jokers, consumables, upgrades, round number, and run stacks.
It has no access to storage, time, or randomness. That makes it deterministic and
unit-testable.

The server always recomputes the score. The client may show an estimate, but a
client-provided score is never accepted.

### 4.6 Joker system

Jokers are data, not bespoke code paths. Proposed record:

```ts
type JokerDef = {
  id: string;
  name: string;
  description: string;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
  cost: number;
  slots: 1;                     // future cards may cost more than one slot
  trigger: "round-end" | "holding" | "market" | "trade" | "shop";
  effects: Array<{
    stat: "chips" | "mult" | "mult-x";
    op: "add" | "mul";
    value: number;
    condition?: JokerCondition;
  }>;
  art: { motif: string; colors: [string, string]; shape: string };
  balance: Record<string, number>;
};
```

Conditions are declarative and finite: `market-rising`, `market-falling`, `holds>=N`,
`holds-sector`, `positive-mover`, `negative-mover`, `volatility>=X`, `event-kind`,
`round>=N`, `trade-count>=N`, `portfolio-return>=X`, `largest-holding<=X`, `distinct>=N`.
No condition can reference another joker’s computed output, which prevents circular
effects.

The server owns the catalog. A static copy is exposed through `/api/catalog` for the
client to render cards and to compute an **estimate**. The authoritative score comes from
`scoreRound()` on the server with the same catalog. Tests assert that the client preview
and server engine agree for the same snapshot, so drift is caught.

Initial collection: at least 20, using the specification’s concepts plus original ones.
They will be written in Phase 5, not now.

### 4.7 Shop and run currency

- Run currency is **Scrip**, separate from trading cash.
- Scrip is awarded for passing rounds, with a small bonus for exceeding the target.
- Cash is never spendable in the shop; Scrip is never spendable in the market.
- Shop offers are generated deterministically from `run.seed`, `rngCursor`, ante, and
  round, then stored in `run.shop`.
- A shop visit has a stable `shopId`, a finite offer list, purchased flags, and a reroll
  price that increases within the visit.
- Refresh/reconnect returns the stored shop unchanged.
- Purchases are idempotent: the server checks `offer.purchased`, currency, and slot
  capacity in one Durable Object transaction, then writes the run and the offer atomically.

Proposed endpoints:

```
GET  /api/run                 current run save (or 404)
POST /api/run/start           create a fresh run
POST /api/run/continue        validate and return current phase
POST /api/run/round/open      open the current round on a tick boundary
POST /api/run/round/lock      close the round and compute the score
POST /api/run/shop/buy        buy an offer (idempotent)
POST /api/run/shop/reroll     reroll (idempotent per shop+cursor)
POST /api/run/shop/leave      advance phase
POST /api/run/retire          end the run voluntarily
GET  /api/catalog             jokers, rarities, bosses, rules (public, cacheable)
```

Market trading during a run continues through `/api/trade`, but it must read/write the
run’s trading account, not the legacy player record. This is a key migration point
(section 6).

### 4.8 Leaderboards

Keep and extend, do not replace:

- **Live market value** — existing board, preserved. It remains useful and familiar.
- **Run score** — current run cumulative score, only for active runs.
- **Ante progression** — highest ante reached in the current run.
- **Highest completed runs** — archived best scores, with ante and date.

Boards are recomputed from stored data and cached in the Durable Object under
`board:<name>` with a short TTL or explicit invalidation, instead of scanning all player
rows on every client request.

### 4.9 Screen architecture

Use one `<main>` app shell with distinct full-screen `<section data-screen>` elements and
a small hash router:

```
#/menu
#/setup
#/ante
#/floor
#/score
#/shop
#/collection
#/boss
#/results
#/stats
```

Rules:

- Exactly one screen is visible at a time; no dashboard-with-hidden-sections.
- The identity gate remains an overlay above all screens.
- The router owns navigation state; game state does not live in the DOM.
- A refresh resolves the screen from the server’s run `phase`, not from a client flag.
- Transitions are class-based and respect `prefers-reduced-motion`.
- The developer console stays a fixed overlay, off the screen flow.

### 4.10 Visual system direction

Evolve the existing identity, do not discard it:

- Deep burgundy and charcoal structure, warm cream text, muted gold rewards, market green
  for gains, market red for losses.
- Keep the CRT as an optional texture, not a requirement for readability.
- Add display type for card names and score numerals; keep body text highly readable.
- Cards are CSS/SVG compositions: geometric motifs, ticker glyphs, charts, arrows,
  and typographic hierarchy. No mascots, no external image APIs.
- Rarity uses border, finish, corner mark, and a restrained palette shift — not just a
  brighter color.
- Tabular numerals everywhere a financial or score figure appears.
- All motion has a reduced-motion path.

### 4.11 Performance and budget

- Run records are small, versioned documents. Read/write only the run key, not the world.
- Batch related writes with `ctx.storage.put({ ... })` where possible.
- Cache leaderboards; stop fetching `/api/leaderboard` every tick.
- Keep the market tick at 15 seconds. Faster ticks reduce the free-tier headroom that the
  new run endpoints need.
- Do not add per-frame network calls. Score previews are local estimates; the server
  confirms on lock-in.
- Replace full-table `innerHTML` re-renders with targeted updates in the new trading floor.
- Keep one WebSocket, one tick interval, one animation frame loop.
- Bound run history and archive size.

---

## 5. Development phases and milestones

The specification’s phase order is preserved. Each phase is split into reviewable
milestones. A milestone is complete only after code, tests, a browser check, and an
updated plan.

### Phase 0 — Audit and planning (complete)

- Repository, backend, storage, auth, economy, market, leaderboard, dev tools, and
  deployment audited.
- This plan written.
- Open decisions listed.
- **No gameplay code changed.**

### Phase 1 — Game foundation

**1A. Screen shell and navigation (frontend only)**

- Add screen sections, hash router, and transition classes.
- Main menu is functional: Continue (if a run exists), New Run, Collection (placeholder
  state only if the data exists), Settings, and a link to the classic market board.
- Keep the current trading dashboard fully working behind a temporary “Classic board”
  entry so the game is never unplayable.
- Verify mobile and reduced-motion.

**1B. Server run state and save structure**

- Add `RunSaveV1`, versioned load/migrate/save helpers.
- Add `GET /api/run`, `POST /api/run/start`, `POST /api/run/retire`.
- Lazy creation only: never create a run automatically for an existing account.
- Add developer controls to start/reset/advance runs.
- Add pure tests for migration and save round-trip.

**1C. Basic round progression**

- Add the configurable rules module (antes, rounds, ticks, targets).
- Open/lock a round on tick boundaries.
- Persist phase, round, target, and history.
- Show ante/round/target on the trading floor.
- No jokers or shop yet; scoring is a placeholder that records the round and advances.
- The game remains playable end to end.

### Phase 2 — Visual foundation

- Global design tokens: burgundy, charcoal, cream, gold, green, red.
- Display/body type scale, tabular numerals.
- Reusable card, button, panel, badge, and rarity components.
- Screen transitions.
- Polished main menu and run setup.
- Responsive card and table layouts.

### Phase 3 — Core gameplay

- Antes, normal rounds, targets, chips and multiplier engine.
- Deterministic `scoreRound()` with ordered effects.
- Round completion, failure, run end, and progression.
- Unit tests: base score, additive mult, multiplicative mult, zero holdings, negative
  return, target comparison, effect ordering.
- Scoring screen with the real breakdown (static presentation first; animation in Phase 8).

### Phase 4 — Trading integration

- Trading floor reads and writes the run’s cash and holdings.
- Company cards / responsive market layout.
- Score generation from end-of-round holdings and movement.
- Market events feed scoring conditions.
- Preserve slippage, tape impact, shared broadcast, and the existing economy.
- Integration tests: buy/sell validation, portfolio snapshot, score snapshot.

### Phase 5 — Joker system

- Joker catalog with at least 20 cards and five rarities.
- Slots, acquisition, collection, and detail inspection.
- Declarative effect engine and conditions.
- Synergy tests and edge cases.
- Collection screen with discovered/undiscovered states.

### Phase 6 — Shop and consumables

- Full-screen shop, deterministic offers, rerolls, purchases, slots, scrip.
- Consumables and permanent upgrades.
- Idempotent transaction tests, including refresh during a shop and double-submit.

### Phase 7 — Boss rounds and events

- Boss rule catalog, visible preview, scoring restrictions.
- Global event expansion and multi-tick events.
- Player-specific conditions kept separate from global market state.
- Ante progression with boss rounds.

### Phase 8 — Polish

- Scoring animation sequence, card effects, screen transitions, sound cues.
- Purchase/failure/success/unlock feedback.
- Loading and error states.
- Reduced-motion coverage for every new animation.

### Phase 9 — Multiplayer hardening

- Two or more simultaneous clients; verify shared prices and independent runs.
- Reconnection during trading, scoring, and shop.
- Save recovery and duplicate-transaction checks.
- Score validation and transaction integrity.
- Leaderboard consistency and cache invalidation.

### Phase 10 — Release QA

- Full navigation sweep on desktop and mobile.
- Screenshot/visual inspection at multiple widths.
- Console and network checks.
- Performance and memory checks.
- Production Pages and Worker verification.
- Honest list of remaining defects.

---

## 6. Migration and data preservation

### 6.1 Principles

- Additive only. No existing key is deleted or rewritten in place without a verified
  migration path.
- Existing accounts, passwords, sessions, cash, holdings, cost basis, realized profit,
  daily summaries, rank history, and market state stay intact.
- Run state is a new key. Missing run state is a valid state (“no run yet”).
- Every save has a `version` and a migration function.
- All migration code is idempotent and tested against fixtures.

### 6.2 Existing players

On first run start for an account that already has a portfolio:

1. Write `legacy:<playerId>` with a copy of the current player record and a timestamp.
2. Create the run with a fresh starting bankroll.
3. The run’s cash/holdings become the active trading account.
4. The legacy record is read-only and can power a future “legacy portfolio” statistic.

If the user prefers that existing cash/holdings carry into the first run instead of being
archived, only step 2 changes. This is an open decision (section 11).

### 6.3 Trading account ownership

`/api/trade` must resolve the active account in this order:

1. If an active run exists, read/write the run’s cash, holdings, and cost basis.
2. Otherwise, read/write `player:<playerId>` as today (classic board).

This keeps the classic board working during and after the transition, and it avoids
breaking accounts that have not started a run.

### 6.4 Leaderboards

- The live market-value board can continue to score the active account. During a run this
  is the run portfolio; outside a run it is the classic player record.
- Keep `ranks:<dateKey>` for continuity.
- Add run boards as separate cached records. Do not overwrite the old board.
- Archive run results; never rewrite past daily summaries.

### 6.5 Rollback

- Ship Phase 1 behind a frontend switch so the classic board remains reachable.
- Keep the old Worker route shapes; add new routes rather than changing existing ones.
- If a run migration fails, the run is rejected and the player record is untouched.
- Add a developer “export player/run” diagnostic before destructive developer actions.
- Do not run any bulk migration that rewrites all player rows. Migrate lazily on read.

### 6.6 Storage growth

- Bound `roundHistory` per run (proposal: 40 entries).
- Bound archived runs per player (proposal: 20).
- Store compact round results, not full market history.
- Reuse the existing market history thinning; runs reference tick numbers, not price
  arrays.

---

## 7. Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Single Durable Object bottleneck | Slow requests under load; request contention | Small run records, cached boards, batched writes, no per-tick client board fetch. |
| Free-tier write/request limits | Market or runs stop updating | Keep 15s market tick; budget writes per action; measure with Local Explorer; no polling loops. |
| Score coupled to wealth | Rich players trivially win; game becomes pay-to-score | Normalize base chips by round return and holdings, never by absolute cash. |
| Multipliers leak into cash | Violates a fundamental rule | Enforce separation in scoring engine types; tests assert cash is unchanged by score. |
| Client/server score drift | Unfair scores or confusing UI | Server recomputes; client preview is labelled estimate; shared catalog and agreement tests. |
| Duplicate purchase/reward/reconnect | Economy exploit | Idempotency keys, stored shop offers, phase version checks, atomic DO writes. |
| Existing data loss during migration | Irreversible harm | Additive keys, lazy migration, legacy archive, no bulk rewrite, rollback switch. |
| Round pacing too slow or too fast | Game feels bad | Tick-based configurable rules; tune after playtesting; early lock-in. |
| Classic trading breaks during refactor | Game unplayable | Keep classic board reachable until the run flow matches or exceeds it; verify every milestone. |
| Frontend becomes a monolith again | Hard to maintain | Screen modules and a router; targeted DOM updates; keep `game.js` split by responsibility. |
| Mobile trading table unusable | Loses audience | Company cards or responsive rows in Phase 4; test at 360 px. |
| Animation causes duplicate actions | Exploit or bug | Actions are disabled while pending; animations never own transaction state. |
| Joker conditions interact recursively | Infinite or nondeterministic score | Declarative conditions only; no joker reads another joker’s output; deterministic order. |
| Leaderboard cache stale | Confusing ranks | Invalidate on score/round completion; TTL fallback; keep rank change semantics. |
| Pages-only hosting limits routing | Broken refresh/deep links | Hash routing only; no server rewrites. |
| No automated test runner today | Regressions | Add `node --test` for pure TypeScript engine modules (verified working on Node 24). |

---

## 8. Testing strategy

### 8.1 Pure engine tests

Extract scoring, conditions, shop generation, and rules into modules with no Cloudflare
imports. Run with Node’s built-in test runner. Node 24 can execute `.test.ts` directly via
type stripping, so no test dependency is required.

Required cases from the specification:

- Base score, zero holdings, negative movement.
- Additive multiplier, multiplicative multiplier, both together.
- Effect ordering is stable and explicit.
- Each joker trigger, including “does not trigger” cases.
- Known synergy combinations.
- Target pass/fail boundaries.
- Boss restrictions.
- Shop offer determinism for the same seed/cursor.
- Purchase affordability, slot capacity, duplicate purchase.
- Save round-trip and version migration.
- Round pacing: minimum ticks, auto-lock tick, early lock.

### 8.2 Integration tests against local `cf dev`

- Register, start run, open round, trade, lock, score, shop, next round.
- Refresh during shop returns identical offers.
- Two concurrent clients see the same market and different runs.
- Duplicate lock/purchase requests are rejected idempotently.
- Trade impact still broadcasts to both clients.
- Leaderboard boards update on completion and are consistent.

### 8.3 Browser checks

Use `tools.browser.evaluate` and canvas hashes where screenshots are unavailable.
Verify:

- Screen navigation and hash restore.
- No console errors.
- Reduced-motion path.
- Mobile layout at narrow width.
- Scoring screen values match the server result.
- No duplicated event listeners or runaway timers.

### 8.4 Production checks

- GitHub Pages build for the exact commit.
- Asset version bump present.
- Worker typecheck/build/deploy.
- Register a temporary account, exercise the flow, then delete it with the dev account.

---

## 9. Data model summary

### New keys

| Key | Purpose | Bounded |
| --- | --- | --- |
| `run:<playerId>` | Active versioned run save. | One per player. |
| `legacy:<playerId>` | Archived pre-run portfolio. | One per player. |
| `runArchive:<playerId>:<runId>` | Completed/failed run summary. | 20 per player. |
| `board:<name>` | Cached leaderboard snapshots. | One per board. |

### New public route: `GET /api/catalog`

Returns joker definitions, rarities, boss rules, and run rules. Public and cacheable; no
player data. The frontend uses it to render cards and previews; the server uses the same
source of truth.

### Versioning

- `RunSaveV1` is the first version.
- `migrateRun(raw): RunSaveV1` handles older shapes.
- Unknown future versions are rejected safely, never coerced.
- The run key stores the version inside the document, not only in the key name.

---

## 10. Assumptions (small decisions taken without asking)

1. One active run per player. Starting a new run after a finished run archives the old one.
2. The run owns the active trading account; the legacy account is archived, not deleted.
3. Scrip is the shop currency; cash is trading-only.
4. Base chips use round return and holdings, not absolute portfolio value.
5. The market tick remains 15 seconds through Phase 1. Tick speed is revisited only after
   run write budgets are measured.
6. Hash routing is used because GitHub Pages cannot rewrite paths.
7. The existing CRT and palette are the starting identity, not a temporary skin.
8. The classic board remains reachable until the run trading floor is verified.
9. No new runtime dependency is added for the frontend.
10. The developer console remains an overlay and gains run controls.

---

## 11. Outstanding decisions for the user

These materially affect architecture or game feel. Recommended defaults are listed so
implementation can start immediately if approved.

### D1. Round timing and pacing

- **Recommended:** per-player rounds measured in **6 market ticks (90 seconds at 15s)**,
  with early Lock In after the first tick, auto-lock at the deadline, 3 rounds per ante,
  8 antes. Configurable in one rules module.
- Alternatives: 12 ticks (3 minutes) for more trading; fixed real-time timer; manual
  end-only with no deadline.
- Question: is 90 seconds per round the right target, or should rounds be longer/shorter?

### D2. Run account vs. persistent portfolio

- **Recommended:** the run owns a fresh trading bankroll and holdings. The existing
  portfolio is archived to `legacy:<playerId>` on first run start and remains readable.
  Failure resets the run bankroll, not the account.
- Alternative: existing cash/holdings carry into the first run; later runs reset.
- Alternative: keep a permanent portfolio and a separate run bankroll (two portfolios).
- Question: should existing players’ current cash and holdings become their first run’s
  starting portfolio, or be archived?

### D3. Shop currency name and source

- **Recommended:** “Scrip”, earned from passing rounds, never convertible to cash.
- Alternatives: “Leverage”, “Chits”, “Credits”, or a score-derived currency.
- Question: is “Scrip” the right name, and should scrip be awarded only on pass, or also
  on round score above target?

### D4. Leaderboard priority

- **Recommended:** keep the live market-value board and add current-run, ante, and
  completed-run boards.
- Alternative: replace the daily board with a run-score board.
- Question: which board should be the default on the main menu?

### D5. Scope of the first playable milestone

- **Recommended:** Phase 1A + 1B (screen shell, navigation, run save, start/continue)
  before any scoring. The classic board stays reachable.
- Alternative: a vertical slice that includes Phase 3 scoring in the same milestone
  (larger, riskier, but immediately shows the roguelike loop).
- Question: prefer a smaller stable foundation first, or a larger end-to-end slice?

---

## 12. Phase tracker

| Phase | State | Notes |
| --- | --- | --- |
| 0 — Audit and planning | **Complete** | This document. |
| 1 — Game foundation | **1A + 1B complete; 1C mostly complete** | Hash screens, run save, start/continue/lock/advance/retire. Rounds advance on manual lock, not tick boundaries. |
| 2 — Visual foundation | **Partial** | Editorial screen shell, menu, run strip, score and results layouts. Card/rarity system still to come. |
| 3 — Core gameplay | **Basic slice working** | Deterministic `chips × mult` scoring, targets, failure, progression, scoring screen and tests. |
| 4 — Trading integration | **Basic slice working** | Run portfolio routes through the existing trade endpoint; shared market, slippage and broadcast preserved. |
| 5 — Joker system | **5A + 5B complete** | Catalog module `worker/src/jokers.ts`: 20 jokers, five rarities, pure effect engine, shop generation/purchase/reroll, `/api/jokers`, `/api/shop`, `/api/shop/purchase`, `/api/shop/reroll` endpoints. Jokers wired into `scoreRound`. Collection screen and Shop screen on the frontend. 36 Worker tests pass. |
| 7 — Boss rounds and market events | **Complete** | 8 boss rounds on round 3 of each ante with scoring restrictions (diversification-demand, concentration-penalty, multiplier-ceiling, sector-blind, volatility-wall, breadth-requirement, quiet-tape, iron-cap). Purchase-triggered market events: 25% chance on each joker buy triggers bull surge (+0.3 mult) or flatline (halves rising bonus) shared with all players via WebSocket broadcast. Boss info shown on run strip and score screen. 45 Worker tests pass. |
| 6 — Shop and consumables | **Complete** | Shop currency, joker ownership, purchase and reroll mechanics wired into RunSaveV1. `/api/shop`, `/api/shop/purchase`, `/api/shop/reroll` endpoints. Shop screen on the frontend with buy/reroll controls. |
| 7 — Boss rounds and market events | **Complete** | 8 boss rounds on round 3 of each ante with scoring restrictions. Purchase-triggered market events: 25% chance on each joker buy triggers bull surge or flatline shared with all players. Boss info shown on run strip and score screen. 45 Worker tests pass. |
| 8 — Polish | **In progress** | Screen transitions, score reveal, reduced-motion support, distinct Boss Round screen, run-strip segmentation, shop hydration. Added (2026-11-23): dramatic three-act scoring ceremony (chips → mult → total), large chips×mult breakdown, joker activation pulses with sound, screenshake scaled to result, cancellable number animations, Skip button, and shop game feel (staggered card dealing, SOLD stamp, credit count-down, reroll animation, toasts, distinct purchase/reroll/rarity cues). Collection has selectable cards, a sticky inspector with trigger/effect/value/owned status, owned markers and responsive stacking. The run floor is now split into dedicated Market, Portfolio and Jokers screens with tab navigation; joker cards across shop, collection, scoring and the Jokers screen use original geometric SVG artwork and rarity finishes. Added (2026-11-23, arcade playfield pass): Market rows render as physical company cards from tablet width up, a compact active-joker rail links into the Jokers screen, and the chips × mult HUD now includes a server-authoritative target plaque with progress fill. Added (2026-11-24): the Market joker rail marks which Jokers fired in the last scored round using server round history, with effect values and a last-round count. |
| 9 — Multiplayer hardening | Not started | Continuous, formalized here. |
| 10 — Release QA | **Partial** | Mocked browser QC sweep (42 consolidated checks plus 4 responsive layout audits), production Pages/asset checks and production DOM/console checks all pass for build `6249ecc`; full release QA still needs authenticated cross-session testing. |

### Current milestone record

**Completed**

- Frontend: menu, floor, scoring, results, collection, shop, and boss screens with a hash router; classic board remains reachable from the menu.
- Server: versioned `RunSaveV1`, migration, start/lock/advance/retire, developer reset, archived classic portfolios, run-aware leaderboard values, `/api/jokers`, `/api/shop`, `/api/shop/purchase`, `/api/shop/reroll`.
- Scoring: base chips from round portfolio return, holding/rising bonuses, diversification multiplier, joker effects, boss-round restrictions, purchase-triggered market events.
- Shop: shop currency, joker ownership, purchase and reroll mechanics wired into RunSaveV1.
- Polish: screen transitions, score reveal, reduced-motion support, distinct Boss Round screen, run-strip segmentation, shop state hydration. Dramatic scoring ceremony with chips×mult breakdown, staged joker activations, scaled screenshake, sound cues, cancellable number animation and Skip. Shop game feel: staggered deal-in, SOLD stamp, credit count-down, reroll out/in animation, confirmation/reject toasts, distinct purchase/reroll/rarity cues. Collection: selectable joker cards with a detail inspector (trigger, effect type, value, owned status), owned markers and owned/total progress. Run views: Market, Portfolio and Jokers are separate full-screen states with tab navigation; the Market and Portfolio screens carry an arcade chips × mult preview HUD; joker cards in shop, collection, scoring and the Jokers screen use original geometric SVG artwork with rarity colour finishes. The arcade playfield pass turns Market listings into selectable company cards from 681px upward, adds a compact active-joker rail on the Market screen, and gives the preview HUD a target plaque with progress toward the server-supplied round target. The Market joker rail now highlights Jokers that fired in the last scored round, reading effect values from server round history so no score is recalculated in the browser.
- Auth: the login/register gate reappears after a 401 but cannot stay stuck after a network failure.
- Verification: `node --check game.js`, 45 Worker rule tests, Worker typecheck/build, mocked browser QC across 1440/1024/768/390 px. Current local frontend QC: 47/47 consolidated mock-browser checks (flow, scoring, target plaque, joker rail, last-round Joker firing, run views, collection, responsive overflow and console errors) plus 4/4 responsive layout audits for HUD/rail/card collisions, off-screen elements and touch target heights. Earlier suite results (37/37 flow, 11/11 animation, 29/29 views, 22/22 shop feel, 17/17 collection, 8/8 production) remain recorded for their builds. Production verification for build `6249ecc` passed 14/14 checks; build `75c206d` passed 15/15 checks (Pages status, cache-bust, versioned assets, shipped markup including last-round Joker label, auth gate, title and console errors).

**Known gaps**

- Joker slot limits / acquisition caps (shop writes to run save but no slot cap yet).
- Round ends only on manual lock; there is no tick-boundary model.
- A full reconnect/duplicate-action audit is Phase 9.
- Results screen omits leaderboard placement and run duration.
- Shop still lacks a post-round reward-choice flow (no Worker endpoint exists yet).
- Collection marks owned/not-owned for the current run only; there is no persistent discovery or unlock data.
- Only a fraction of the 20 jokers are exercised by the mock QC catalog.

**Recommended next milestone**

- Add a server-authoritative post-round reward choice in the Worker plus matching frontend screen (requires Worker build/deploy authorization), or, staying frontend-only, expand the run-view HUD so the Market screen also surfaces which Jokers fired in the last scoring result. Then Phase 9 multiplayer hardening and Phase 10 release QA.

---

## 13. Definition of done (from the specification)

The project is done only when:

- The original stock market remains functional.
- The shared market works for all players.
- Each player has an independent roguelike run.
- The game has separate screens.
- Antes and rounds work.
- Scoring is independent of actual money.
- Multipliers work correctly.
- Jokers work correctly.
- The shop works.
- Boss rounds work.
- Saves persist.
- Leaderboards work.
- Mobile remains usable.
- Animations work without breaking interaction.
- The production build works.

---

## 14. Immediate next step

Production build `75c206d` is verified (15/15 checks) with cache-bust
`?v=2026-11-24-last-jokers`. A new game-first
redesign brief has also been received; Phase 1 audit/preservation checklist is the next formal
milestone before any terminal redesign work. Keep the classic board and all server-authoritative
behaviour intact throughout.
