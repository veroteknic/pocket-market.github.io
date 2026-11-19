# Pocket Market contributor instructions

## Project overview

Pocket Market is a browser-based, fake-money stock market game. The frontend is hosted on GitHub Pages and connects to a Cloudflare Worker backend over HTTPS and WebSockets.

Current frontend files:

- `index.html` — game markup and the full-screen name gate
- `style.css` — restrained, responsive visual styling
- `game.js` — market rendering, chart, WebSocket connection, trading UI, and leaderboard UI

## Product direction

- Keep the game quick, readable, and arcade-like.
- Use fake money only. Never add real-money purchases, cash-out, or financial advice.
- Prefer simple, intentional UI over gradients, excessive cards, clutter, or generic AI-generated decoration.
- Keep mobile play usable with touch-sized controls and responsive layouts.
- The name gate should cover the page until the player has authenticated.

## Backend rules

- The server is authoritative for prices, time, trades, player balances, holdings, events, and leaderboard scores.
- Never calculate or trust cash, portfolio value, or final scores from the browser.
- The browser may display server data and send requested actions, but the Worker validates every action.
- The shared market belongs in a Durable Object so all players see the same state.
- Real market history must come from server-generated ticks. Do not add synthetic historical data unless it is clearly labeled as placeholder data.
- Player names must be unique case-insensitively.
- Passwords must be hashed server-side and must never be committed to this repository.
- Developer tools need server-side authorization; a name check alone is not security.

## Frontend/backend connection

The frontend should use the deployed Worker URL in production and never depend on `localhost` after deployment. Use `wss://` for production WebSockets.

When changing backend response shapes, update both the Worker and the frontend together. Test:

1. Market prices load.
2. WebSocket updates arrive.
3. Buy and sell requests are validated server-side.
4. The daily leaderboard updates.
5. Duplicate names are rejected.
6. Mobile layout still works.

## Git and deployment

- Work on the `main` branch unless the user asks for branches.
- Keep commits small and descriptive.
- GitHub Pages deploys the frontend after pushes to `main`.
- Do not commit `.env`, `.dev.vars`, API tokens, passwords, private keys, `node_modules`, or generated build output.
- Cloudflare Worker changes should be tested with `cf build` before deployment and deployed with `cf deploy` only when requested or clearly authorized.

## Before finishing a change

- Run `node --check game.js` for frontend JavaScript changes.
- Test the affected API or UI behavior when practical.
- Check for stale localhost URLs, accidental debug text, and console errors.
- Explain any data reset or migration before performing it.





MY SECTION:

# POCKET MARKET — COMPLETE ROGUELIKE TRANSFORMATION
## Master Development Specification

You are the lead game designer, senior frontend engineer, systems architect and UI/UX designer responsible for transforming Pocket Market into a fully fledged browser-based stock-market roguelike.

Your task is to progressively transform the existing project into a game inspired by the presentation, pacing, progression and strategic depth of Balatro, while maintaining Pocket Market's own identity and mechanics.

This is a substantial, multi-stage project.

**You must work incrementally. Do not attempt to implement everything in one enormous change.**

Your priority is to produce a stable, playable, polished game at every development stage.

---

# 0. PROJECT IDENTITY AND CORE VISION

Project: Pocket Market

Existing deployment:
https://veroteknic.github.io/pocket-market.github.io/

Primary objective:

Transform Pocket Market from a relatively conventional stock-market simulator into a replayable, round-based stock-market roguelike.

The game should combine:

- Stock-market simulation.
- Strategic portfolio management.
- Roguelike progression.
- Collectible modifiers.
- Multiplicative scoring.
- Randomised market events.
- Shop and upgrade systems.
- Increasingly difficult challenges.
- Multiplayer competition.

The intended experience should feel like an actual indie game, not a financial dashboard with game elements added.

## Fundamental design decisions

These decisions are established and must not be changed without discussion.

1. The visual direction is Balatro-inspired.
2. Use separate full-screen game screens rather than one persistent dashboard.
3. Use expressive animations and satisfying transitions.
4. Joker artwork must be graphic and minimalist, NOT cartoon characters or mascots.
5. Multipliers affect round score, NOT actual player money.
6. All players participate in one shared market.
7. Each player has their own independent roguelike run.
8. The original 365-day progression is being replaced with a round-based progression.
9. The underlying market and player trading economy must remain meaningful.

## Important distinction

Balatro is an inspiration, not a template to reproduce.

Do not copy its:
- Artwork.
- Card illustrations.
- Logos.
- Exact layouts.
- Assets.
- Sounds.
- Branding.
- Proprietary presentation.

Create an original identity for Pocket Market.

---

# 1. DEVELOPMENT PHILOSOPHY

Work in clearly defined phases.

Before each phase:

1. Inspect the relevant source files.
2. Understand the existing implementation.
3. Identify dependencies and potential compatibility problems.
4. Establish what needs to change.
5. Identify what must remain untouched.

After each phase:

1. Run available tests.
2. Check for build errors.
3. Test the relevant gameplay.
4. Inspect the actual rendered interface.
5. Fix regressions.
6. Update development documentation.
7. Record completed and remaining work.

Do not declare a phase complete simply because code has been written.

A feature is complete only when it works.

## Working rules

- Preserve existing multiplayer functionality.
- Preserve the shared market.
- Preserve existing player identity and leaderboard functionality where applicable.
- Do not destroy existing data.
- Do not casually replace working systems.
- Do not introduce unnecessary dependencies.
- Do not create fake functionality.
- Do not leave unfinished placeholder interfaces.
- Do not silently remove existing features.
- Do not make destructive database or storage migrations without a migration and recovery plan.

Use Git commits or clearly identifiable checkpoints between substantial stages.

If the repository has uncommitted user changes, preserve them.

Do not repeatedly rewrite the same components without understanding why the previous implementation failed.

If a design decision is genuinely ambiguous and materially affects architecture, ask the user before proceeding.

For smaller decisions, choose a sensible implementation and document the assumption.

---

# 2. INITIAL REPOSITORY AUDIT

Before implementation, thoroughly inspect the repository.

Determine:

- Frontend framework.
- JavaScript or TypeScript architecture.
- Styling framework.
- Existing routing.
- Existing component structure.
- Multiplayer architecture.
- Backend services.
- Data storage.
- Authentication or player identification.
- Market simulation logic.
- Stock price generation.
- Trading functionality.
- Leaderboard implementation.
- Existing developer tools.
- GitHub Pages deployment configuration.

Pay particular attention to the existing economy.

Understand how:
- Starting cash works.
- Stock purchases work.
- Stock sales work.
- Holdings are recorded.
- Prices change.
- Portfolio values are calculated.
- Players are synchronised.
- Market events are distributed.

Inspect the actual code rather than relying on assumptions.

Create a development document called:

POCKET_MARKET_IMPLEMENTATION_PLAN.md

It should contain:
- Architecture overview.
- Existing systems.
- Proposed architecture.
- Development phases.
- Risks.
- Migration considerations.
- Outstanding decisions.

Do not begin a complete rewrite.

---

# 3. GAME ARCHITECTURE

The game must have two distinct but connected systems.

## A. Shared market simulation

There is one global market shared by all players.

All players should experience the same:

- Company prices.
- Market movements.
- Market events.
- Bull and bear markets.
- Economic conditions.
- Global market state.

Market simulation must not be independently regenerated for each player.

The shared market should remain authoritative.

## B. Individual roguelike runs

Each player has their own:

- Current ante.
- Current round.
- Score.
- Score target.
- Chips.
- Multiplier.
- Joker collection.
- Consumables.
- Upgrades.
- Shop inventory.
- Run currency, if implemented.
- Run history.
- Unlock progression.

One player's purchases and Joker effects must not modify another player's run.

A player must not be able to manipulate another player's score through their personal upgrades.

## Synchronisation

Determine how the existing backend handles multiplayer state.

Design the new architecture around its existing capabilities.

Use authoritative validation for:
- Purchases.
- Sales.
- Scoring.
- Shop transactions.
- Joker ownership.
- Round completion.
- Progression.

Never trust a client-provided final score or transaction value without validation.

If the existing backend cannot securely support a particular mechanic, document the limitation and propose a suitable solution before implementing an unsafe workaround.

---

# 4. CORE GAME LOOP

Replace the conventional 365-day structure with an Ante-based progression.

The game should have:

- Antes.
- Normal rounds.
- Boss rounds.
- Scoring sequences.
- Shops.
- Rewards.
- Increasing difficulty.

## Proposed initial structure

Start with eight Antes.

Each Ante contains:

1. Normal market round.
2. Normal market round.
3. Boss market round.
4. Shop and progression.

This structure should be configurable rather than hardcoded throughout the application.

Each round has a score target.

Players must reach the target using their portfolio and owned modifiers.

If they succeed, they advance.

If they fail, the run ends.

## Market interaction

Players still buy and sell shares using actual money.

The market is not merely decorative.

Trading decisions should influence scoring through defined scoring rules.

Examples:
- Holding multiple companies.
- Holding companies with rising prices.
- Holding profitable positions.
- Holding companies in particular sectors.
- Maintaining a diversified portfolio.
- Responding to market conditions.

Do not allow players to gain unlimited score simply by repeatedly clicking buy or sell.

## Market time

Determine how to adapt the existing 365-day simulation into round-based market time.

Avoid making the original 365 days an arbitrary countdown.

A round should provide enough meaningful trading opportunities without becoming excessively long.

The shared market must continue to progress consistently for all players.

If a player finishes a round earlier than others, their individual run should not cause the global market to advance independently.

Document the final timing model before implementing it.

---

# 5. SCORING SYSTEM

This is one of the most important systems.

The scoring system must be completely independent of actual money.

## Fundamental formula

Use a chips-and-multiplier system:

FINAL SCORE = TOTAL CHIPS × TOTAL MULT

The scoring system should support:

- Base chips.
- Additive multiplier bonuses.
- Multiplicative multiplier bonuses.
- Conditional effects.
- Joker effects.
- Market-based bonuses.
- Ante bonuses.
- Special scoring conditions.

Example:

Base chips: 450

Base multiplier: 1

Joker bonus: +4 mult

Bull market bonus: ×2 mult

Final calculation:

450 × (1 + 4) × 2 = 4,500 points.

This is an illustrative example, not a final balance specification.

## Scoring sequence

The scoring system should execute effects in a deterministic order.

Proposed order:

1. Calculate base portfolio chips.
2. Apply company and holding bonuses.
3. Apply additive chip bonuses.
4. Apply additive multiplier bonuses.
5. Apply multiplicative bonuses.
6. Apply conditional Joker effects.
7. Calculate final score.
8. Record the result.

The implementation must make effect order explicit.

Do not rely on arbitrary component execution order.

## Scoring feedback

The player should SEE the calculation happen.

For example:

+450 CHIPS

+4 MULT

×2 BULL MARKET

= 4,500 POINTS

Each stage should animate.

The final result should be visually satisfying.

---

# 6. JOKER SYSTEM

Jokers are the main source of strategic depth.

They are collectible modifiers that change scoring behaviour.

## Visual direction

Graphic and minimalist.

Use:
- Strong geometric compositions.
- Financial symbols.
- Abstract economic diagrams.
- Distinctive typography.
- Stock market motifs.
- Company-related iconography.
- Bold colour combinations.
- Special borders and finishes.

Avoid cartoon characters and mascot illustrations.

Cards should feel like premium collectible game objects.

## Rarities

Establish five rarity tiers:

- Common.
- Uncommon.
- Rare.
- Epic.
- Legendary.

Each tier should have distinguishable visual treatment.

Rarity should affect availability and design, not automatically guarantee that a card is powerful.

## Initial Joker concepts

Create a data-driven Joker system.

Start by designing a balanced initial collection containing at least 20 distinct Jokers.

Suggested concepts:

### Bull Investor
Gain additional multiplier when the market is rising.

### Bear Market
Gain bonuses during declining market conditions.

### Diversification
Gain chips for holding several different companies.

### Day Trader
Gain bonuses from qualifying trading activity.

### Diamond Hands
Gain multiplier for holding shares across consecutive rounds.

### Insider Knowledge
Gain bonuses when a market event benefits a holding.

### Blue Chip
Gain chips from holding established companies.

### Penny Stock
Gain multiplier from smaller-value companies.

### Short Squeeze
Gain bonuses during unusually volatile market movements.

### Compound Interest
Gain a growing bonus over successive successful rounds.

### Market Analyst
Gain a bonus when the portfolio contains companies with positive movement.

### Contrarian
Gain bonuses when holding companies moving against the broader market.

These are starting concepts.

Develop additional original concepts.

Each Joker must have:
- Unique ID.
- Name.
- Description.
- Rarity.
- Effect.
- Trigger condition.
- Effect type.
- Visual identity.
- Balance parameters.

## Joker slots

Start with a limited number of Joker slots.

Allow players to expand their collection through progression and purchases.

Avoid unlimited Joker stacking.

## Synergies

Jokers should interact.

Examples:
- Diversification increases chips.
- Blue Chip increases the value of that bonus.
- Market Analyst adds multiplier during a bull market.
- Contrarian rewards different market conditions.

Ensure interactions are intentional, deterministic and testable.

Prevent accidental infinite loops or circular effects.

---

# 7. SHOP SYSTEM

Create a dedicated full-screen shop.

The shop should feel like an actual game shop, not a conventional e-commerce page.

It should contain:
- Joker cards.
- Consumables.
- Permanent upgrades.
- Rerolls.
- Limited inventory.
- Purchase controls.
- Current currency.
- Exit and continue controls.

Use a defined run economy.

Do not assume real cash and shop currency are interchangeable.

## Consumables

Explore consumables that:
- Improve scoring.
- Modify market-related conditions.
- Upgrade Jokers.
- Affect future shop offers.
- Provide temporary bonuses.

Do not implement consumables that directly manipulate the shared market for everyone unless deliberately designed as a global multiplayer mechanic.

## Shop generation

Use a data-driven generation system.

Shop offers should be deterministic once generated, with server-side validation where supported.

Prevent players from receiving different results after refreshing or reconnecting.

---

# 8. MARKET EVENTS AND BOSS ROUNDS

Introduce randomised market events.

Examples:
- Bull run.
- Bear market.
- Interest rate increase.
- Technology boom.
- Recession.
- Earnings surprise.
- Market panic.
- Sector rotation.

Events should have meaningful effects on the shared market where appropriate.

Distinguish global market events from individual player scoring modifiers.

## Boss rounds

Boss rounds introduce restrictions or special challenges.

Examples:
- Diversification requirement.
- Reduced scoring from the largest holding.
- Certain company categories do not generate chips.
- Multiplier cap.
- Volatility challenge.
- Restricted trading opportunities.

Boss rules should be visible before the round starts.

Do not surprise players with hidden restrictions.

---

# 9. SCREEN ARCHITECTURE

The game must use separate full-screen screens.

Do not build one enormous dashboard and hide or reveal random sections.

Create a clear screen-navigation architecture.

Recommended screens:

## 01. Main Menu

- Pocket Market logo.
- Start Run.
- Continue.
- Collection.
- Statistics.
- Achievements.
- Settings.

Strong visual identity.

Animated background, but not distracting.

## 02. Run Setup

- Starting conditions.
- Available starting bonuses.
- Player information.
- Run confirmation.

## 03. Ante Selection

- Current Ante.
- Upcoming rounds.
- Round targets.
- Boss challenge preview.
- Available rewards.

## 04. Trading Floor

This is the primary gameplay screen.

Show:
- Company listings.
- Current prices.
- Daily movements.
- Player cash.
- Portfolio value.
- Owned shares.
- Current score target.
- Current scoring estimate.
- Joker collection.
- Trading controls.

Keep financial data legible.

Do not allow the trading interface to become a generic spreadsheet.

## 05. Scoring Screen

A dedicated scoring presentation.

Show:
- Base chips.
- Bonus chips.
- Additive multipliers.
- Multiplicative effects.
- Activated Jokers.
- Final score.
- Target comparison.

Use animated number counters and sequential effect activation.

## 06. Shop

- Joker cards.
- Consumables.
- Upgrades.
- Rerolls.
- Current currency.
- Purchase feedback.

## 07. Collection

- Discovered Jokers.
- Undiscovered Jokers.
- Rarity.
- Effect descriptions.
- Unlock conditions.
- Card detail inspection.

## 08. Boss Round

Distinct presentation.

Display:
- Boss name.
- Special rule.
- Score target.
- Challenge information.

## 09. Run Results

Show:
- Final score.
- Antes completed.
- Best round.
- Jokers collected.
- Portfolio performance.
- Run duration.
- Leaderboard placement.

## 10. Statistics

Career-level statistics:
- Total runs.
- Highest score.
- Best Ante.
- Most successful Joker combinations.
- Total trading volume.
- Achievements.
- Unlock progression.

---

# 10. VISUAL DESIGN SYSTEM

The game should take strong inspiration from Balatro's visual confidence and readability.

However, establish an original Pocket Market identity.

## Colour palette

Develop a consistent palette around:

- Deep burgundy.
- Charcoal.
- Warm cream.
- Muted gold.
- Market green.
- Market red.

Use colour with purpose.

Green should communicate gains.

Red should communicate losses.

Gold should communicate rarity, achievements and important rewards.

Do not make every component brightly coloured.

## Typography

Use:
- A distinctive display typeface.
- A highly readable body typeface.
- Tabular numerals for financial figures.
- Consistent numerical formatting.

Avoid generic oversized SaaS headings.

## Card design

Cards are central to the experience.

Establish reusable components for:
- Joker cards.
- Consumables.
- Company cards.
- Upgrade cards.
- Reward cards.

Cards should have:
- Consistent dimensions.
- Defined typography hierarchy.
- Clear rarity indicators.
- Distinct visual composition.
- Hover states.
- Selection states.
- Purchase states.
- Disabled states.

Use CSS/SVG artwork where practical.

Do not depend on external image APIs or generate random placeholder illustrations.

## Responsive behaviour

Support desktop, laptop, tablet and mobile.

The desktop experience is the primary design target, but mobile must remain playable.

Cards should resize intelligently.

Trading tables should adapt rather than simply overflow.

---

# 11. ANIMATION AND FEEDBACK

Animations are a major part of the intended experience.

Implement a reusable animation system.

Prioritise:

### Cards
- Hover lift.
- Selection movement.
- Purchase animation.
- Discard/removal animation.
- Rare card appearance.
- Unlock animation.

### Scoring
- Chips counting upwards.
- Multipliers appearing sequentially.
- Joker activation effects.
- Multiplier stacking.
- Final score reveal.

### Navigation
- Screen transitions.
- Shop entry and exit.
- Ante transitions.
- Boss introductions.
- Run completion.

### Feedback
- Purchase confirmation.
- Failed purchase.
- Successful round.
- Failed round.
- Unlock notification.

Use animation purposefully.

Avoid excessive particles and constant movement.

Support reduced-motion preferences.

Animations must not interfere with gameplay or create duplicate transactions.

---

# 12. MULTIPLAYER AND LEADERBOARDS

This is a critical requirement.

Pocket Market must retain its shared-market multiplayer identity.

Players compete using individual scoring systems.

Leaderboards should support:
- Current run scores.
- Ante progression.
- Highest scores.
- Completed runs.

Determine how the existing leaderboard works and extend it rather than replacing it unnecessarily.

Prevent:
- Client-side score manipulation.
- Duplicate rewards.
- Duplicate purchases.
- Repeated round completion.
- Race conditions.
- Exploitable state synchronisation.

The server should remain authoritative wherever possible.

If some existing architecture is unsuitable, propose a migration plan before implementation.

---

# 13. DATA AND SAVE SYSTEM

Players should be able to leave and resume their runs.

Persist:
- Current Ante.
- Current round.
- Player score.
- Owned Jokers.
- Consumables.
- Upgrades.
- Run currency.
- Relevant market snapshot references.
- Run history.

Use versioned save structures.

Ensure reconnecting does not:
- Reset the player's run.
- Duplicate purchased items.
- Re-roll existing shops.
- Duplicate rewards.
- Incorrectly advance rounds.

Preserve existing player data.

Create a safe migration strategy.

---

# 14. PERFORMANCE AND DEPLOYMENT

The final game must remain compatible with GitHub Pages.

Inspect the existing deployment workflow.

Avoid unnecessary heavyweight libraries.

Prefer lightweight CSS animations and efficient rendering.

Ensure:
- No unnecessary polling.
- No excessive DOM updates.
- No memory leaks.
- No runaway timers.
- No duplicated event listeners.
- No broken asset paths.
- No deployment-only failures.

Test the production build.

Do not assume a successful local development server means GitHub Pages will work.

---

# 15. DEVELOPMENT PHASES

This is the required implementation order.

Do not skip ahead.

## PHASE 0 — AUDIT AND PLANNING

Inspect the repository.

Create:
- Architecture documentation.
- Implementation plan.
- Data model proposal.
- Risk assessment.

No major implementation yet.

## PHASE 1 — GAME FOUNDATION

Implement:
- New screen architecture.
- Navigation state.
- Individual run state.
- Shared market separation.
- Save structure.
- Basic round progression.

The game must remain playable.

## PHASE 2 — VISUAL FOUNDATION

Implement:
- Global design tokens.
- Typography.
- Colour system.
- Card components.
- Button components.
- Screen transitions.
- Main menu.
- Run setup.

Ensure the game has a coherent visual identity.

## PHASE 3 — CORE GAMEPLAY

Implement:
- Antes.
- Normal rounds.
- Score targets.
- Chips and multiplier calculation.
- Round completion.
- Run failure.
- Run progression.

Test scoring independently.

## PHASE 4 — TRADING INTEGRATION

Connect the trading floor to the shared market.

Implement:
- Company cards.
- Buy/sell controls.
- Portfolio state.
- Score generation from holdings.
- Market event integration.

Ensure the actual economy remains intact.

## PHASE 5 — JOKER SYSTEM

Implement:
- Joker data architecture.
- Initial collection.
- Rarities.
- Joker slots.
- Effect triggers.
- Synergies.
- Collection screen.

Test combinations and edge cases.

## PHASE 6 — SHOP AND CONSUMABLES

Implement:
- Shop screen.
- Shop inventory.
- Currency.
- Purchasing.
- Rerolls.
- Consumables.
- Upgrades.

Test persistence and transaction security.

## PHASE 7 — BOSS ROUNDS AND EVENTS

Implement:
- Boss challenges.
- Global market events.
- Player-specific conditions.
- Ante progression.

## PHASE 8 — POLISH

Implement:
- Scoring animations.
- Card effects.
- Screen transitions.
- Sound integration if appropriate.
- Visual feedback.
- Loading and error states.

## PHASE 9 — MULTIPLAYER HARDENING

Test:
- Multiple simultaneous players.
- Shared market consistency.
- Individual run independence.
- Reconnection.
- Save recovery.
- Score validation.
- Transaction integrity.

## PHASE 10 — RELEASE QUALITY ASSURANCE

Test the entire game.

Inspect screenshots at multiple resolutions.

Test all screens and navigation paths.

Check performance.

Check console errors.

Verify the GitHub Pages build.

Document outstanding issues honestly.

---

# 16. TESTING REQUIREMENTS

Create tests for:

- Score calculation.
- Additive multipliers.
- Multiplicative multipliers.
- Joker triggers.
- Joker combinations.
- Round targets.
- Boss restrictions.
- Purchases.
- Currency.
- Save/load.
- Multiplayer separation.
- Shared market consistency.

Include deterministic test scenarios.

Do not use random test outcomes where reproducibility is required.

Test unusual conditions:
- Zero holdings.
- Negative market movement.
- No available currency.
- Full Joker slots.
- Reconnecting during scoring.
- Refreshing during a shop visit.
- Multiple players finishing rounds simultaneously.

---

# 17. DEFINITION OF DONE

The project is not complete until:

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

# 18. HOW YOU SHOULD WORK WITH THE USER

This is a long-term development project.

Do not attempt to finish every phase in one response or one coding session.

At the start of each development session:

1. Read POCKET_MARKET_IMPLEMENTATION_PLAN.md.
2. Inspect the current project state.
3. Identify the last completed phase.
4. Check for unfinished work.
5. Select a manageable next milestone.

Work on that milestone.

After each milestone, report:

- What changed.
- Files modified.
- Features completed.
- Tests performed.
- Problems encountered.
- Remaining work.
- Recommended next milestone.

Update the implementation plan as progress is made.

If a phase is too large, divide it into smaller milestones.

Do not pretend that incomplete features are finished.

Do not remove existing functionality to make implementation easier.

If a major design or gameplay decision is uncertain, ask the user rather than silently deciding.

The user should be able to review progress and redirect the project between milestones.

---

# FINAL OBJECTIVE

Create a distinctive, replayable, polished stock-market roguelike called Pocket Market.

It should combine the addictive strategic progression of a card-based roguelike with a meaningful shared stock-market simulation.

It should look and feel like a real indie game.

Not a generic dashboard.

Not a stock trading website with a multiplier attached.

A complete game with its own identity, strategic depth, memorable cards, satisfying scoring sequences and meaningful multiplayer competition.

**Build carefully. Test continuously. Preserve what already works.**