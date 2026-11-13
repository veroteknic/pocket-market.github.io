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
