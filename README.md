# Pocket Market

A fake-money arcade stock market shared by every player. The frontend is a static
site on GitHub Pages; prices, trades, accounts, and the leaderboard are served by
a Cloudflare Worker with a Durable Object.

- Play: <https://veroteknic.github.io/pocket-market.github.io/>
- Backend: <https://pocket-market-worker.unpaidandpoor.workers.dev>

There is no real money. Prices come from live server ticks only; the history is
never backfilled. Every order fills with slippage and pushes the shared tape in
the trade's direction, so large trades move the price against you and everyone
else sees the move immediately.

## Layout

- `index.html` — game markup, account gate, developer console
- `style.css` — palette, layout, CRT and motion effects
- `game.js` — auth, WebSocket, trading UI, chart, leaderboard, dev controls
- `worker/src/index.ts` — Worker routes, market Durable Object, accounts, dev API
- `worker/cloudflare.config.ts` — bindings and deployment settings

## Local development

```sh
cd worker
npm install
npm run dev        # local Worker on http://localhost:8787
```

The frontend can be served with any static server and pointed at the deployed
Worker, or at the local one when developing against it.

`DEV_PASSWORD` is a Worker secret used by the developer console. Locally it is
read from `worker/.dev.vars` (git-ignored). In production it is set on the Worker
and never committed:

```sh
cf deploy --secrets-file <path-to-env-file>
```

## Developer console

The console is only revealed to the configured developer names, and every control
is authorized server-side by the `DEV_PASSWORD` secret; a name alone grants
nothing. It can force market-wide or single-company booms and crashes, set market
sentiment, set the signed-in player's cash and holdings, reset that player, and
delete accounts by name.

## Tests

```sh
cd worker
npm run typecheck
npm run build
```

For frontend changes also run `node --check game.js` and check the game in a
browser: prices load, WebSocket updates arrive, trades are validated, the daily
leaderboard updates, and the mobile layout still works.
