<div align="center">

# DryRun

### Practice Solana memecoin trading. Real market data, real devnet wallet, zero real money.

[![Live Demo](https://img.shields.io/badge/Live_Demo-Try_DryRun-9945FF?style=for-the-badge)](https://rohankanojia25.github.io/dryrun/)
[![Solana](https://img.shields.io/badge/Solana-Devnet-14F195?style=for-the-badge&logo=solana&logoColor=white)](https://docs.solana.com/clusters#devnet)

</div>

Blow up here so you don't blow up on mainnet. DryRun is a paper-trading terminal for Solana memecoins: generate a real devnet wallet, claim free devnet SOL, and trade live tokens with simulated fills at live prices.

## What's real vs simulated

| Layer | Status |
| --- | --- |
| Wallet (ed25519 Solana keypair, generated in browser) | Real |
| Devnet SOL airdrops and on-chain balance | Real (Solana devnet JSON-RPC) |
| Token prices, volume, liquidity, market cap, charts | Real (live mainnet data via DexScreener) |
| Trade fills, positions, PnL | Simulated (1% swap fee + network fee at live prices) |

Why simulated fills: live memecoin markets only exist on mainnet. Devnet has no pump.fun and no Raydium liquidity, so every honest practice platform simulates execution against live mainnet prices. That is exactly what DryRun does.

## Features

- One-click practice wallet, address on real devnet
- Devnet SOL faucet integration with graceful handling when the faucet is dry
- Trending Solana tokens feed plus search by name, symbol, or mint address
- Embedded live DexScreener chart per token
- Buy/sell with presets, average cost tracking, unrealized and realized PnL
- Trade history, portfolio persistence across sessions, account reset

## Stack

Zero-build static site: hand-written HTML, CSS, and JavaScript. No frameworks, no bundler, no server, no API keys.

```
index.html        app shell
css/styles.css    flight-deck UI (Chakra Petch / Space Grotesk / JetBrains Mono)
js/app.js         wallet, RPC layer, market data, trading engine, rendering
```

External services (all public, no keys needed):
- `api.devnet.solana.com` : Solana devnet JSON-RPC (requestAirdrop, getBalance)
- `api.dexscreener.com` : live token data (trending, search, prices)
- `dexscreener.com/.../?embed=1` : embedded live charts
- `cdnjs` TweetNaCl : ed25519 keypair generation

## Run it

Open `index.html` in a browser. That's it. Or serve locally:

```bash
npx serve .
```

## Safety

The practice wallet lives in your browser storage and is for devnet only. Never send real SOL or any mainnet assets to it.

## Roadmap

- WebSocket price streams via a small Node proxy
- On-chain practice records and leaderboards via an Anchor (Rust) program on devnet
- Preset market scenarios (rug, slow bleed, god candle) for drills

---

Built by [Rohan Kanojia](https://rohankanojia25.github.io/) · [@rohankxbt](https://x.com/rohankxbt) · Telegram [@copiummaxi](https://t.me/copiummaxi)
