/* DryRun · tokenpage.js — token.html logic (?mint=...&pair=...&sym=...) */

const Q = new URLSearchParams(location.search);
const MINT = Q.get('mint');
let priceBusy = false;

function tk(){ return known[MINT]; }

function renderTokenStats(){
  const el=$('#tokstats'); if(!el) return;
  const t = tk(); if(!t) return;
  el.innerHTML = `
    <div class="deck-stat"><span class="k">Price</span><span class="v" data-px="${t.mint}">$${fmt(t.priceUsd)}</span></div>
    <div class="deck-stat"><span class="k">Price · SOL</span><span class="v">${fmt(t.priceSol)}</span></div>
    <div class="deck-stat"><span class="k">1h</span><span class="v">${chgCell(t.chg1)}</span></div>
    <div class="deck-stat"><span class="k">24h</span><span class="v">${chgCell(t.chg24)}</span></div>
    <div class="deck-stat"><span class="k">Vol 24h</span><span class="v">${money(t.vol24)}</span></div>
    <div class="deck-stat"><span class="k">Liquidity</span><span class="v">${money(t.liq)}</span></div>
    <div class="deck-stat"><span class="k">MC</span><span class="v">${money(t.mc)}</span></div>
    ${t.progress!=null?`<div class="deck-stat"><span class="k">Bonding</span><span class="v" style="color:var(--brand2)">${Math.round(t.progress*100)}% est.</span></div>`:''}`;
}
function renderTradeCol(){
  const el=$('#tradecol'); if(!el) return;
  const t = tk(); if(!t) return;
  const pos=S.positions[t.mint];
  const posVal = pos? pos.qty*(t.priceSol||0) : 0;
  el.innerHTML = `
    <div class="side">
      <h3 style="color:var(--up)">BUY</h3>
      <input id="buyamt" type="number" min="0" step="0.05" placeholder="SOL amount">
      <div class="presets">
        <button onclick="$('#buyamt').value=0.1">0.1</button>
        <button onclick="$('#buyamt').value=0.5">0.5</button>
        <button onclick="$('#buyamt').value=1">1</button>
        <button onclick="$('#buyamt').value=(Math.max(cash()-0.001,0)).toFixed(3)">MAX</button>
      </div>
      <button class="exec btn-up" onclick="buyToken(known['${t.mint}'], $('#buyamt').value)">Buy ${esc(t.symbol)}</button>
      <div class="hint">1% fee + ${NETFEE} SOL net fee · simulated fill @ live price</div>
    </div>
    <div class="side">
      <h3 style="color:var(--down)">SELL</h3>
      <div class="hint" style="margin:0 0 .5rem">Holding: <b style="color:var(--text)">${pos?fmt(pos.qty):'0'}</b></div>
      <div class="presets">
        <button onclick="sellPct('${t.mint}',0.25)">25%</button>
        <button onclick="sellPct('${t.mint}',0.5)">50%</button>
        <button onclick="sellPct('${t.mint}',0.75)">75%</button>
      </div>
      <button class="exec btn-down" onclick="sellPct('${t.mint}',1)">Sell 100%</button>
    </div>
    <div class="side">
      <h3 style="color:var(--brand2)">POSITION</h3>
      ${pos?`
        <div class="cashrow"><span>Value</span><span class="v">${fmt(posVal,4)} SOL</span></div>
        <div class="cashrow"><span>Cost</span><span class="v">${fmt(pos.cost,4)} SOL</span></div>
        <div class="cashrow"><span>PnL</span><span class="v" style="color:${posVal-pos.cost>=0?'var(--up)':'var(--down)'}">${fmt(posVal-pos.cost,4)}</span></div>
      `:'<div class="hint" style="margin:0">No position yet.</div>'}
    </div>`;
}
function renderPage(){
  const t = tk();
  if(!t){ $('#tpanel').innerHTML='<div class="skel">Token not found. <a href="index.html" style="color:var(--brand2)">Back to feed</a></div>'; return; }
  $('#tpanel').innerHTML = `
    <div id="tokhead">
      <a class="backbtn" href="index.html">←</a>
      ${t.img?`<img src="${esc(t.img)}" alt="" onerror="this.style.display='none'">`:''}
      <div><div class="t-name">${esc(t.symbol)}</div><div class="t-sub">${esc(t.name)} · <span class="mono">${t.mint.slice(0,4)}…${t.mint.slice(-4)}</span> · <span class="mono">${esc(t.dex||'')}</span></div></div>
      <div class="statgrid" id="tokstats"></div>
    </div>
    <div id="centergrid">
      <div id="chartwrap"><iframe title="Live chart" src="https://dexscreener.com/solana/${t.pair}?embed=1&theme=dark&info=0&trades=0" loading="lazy"></iframe></div>
      <div id="tradecol"></div>
    </div>`;
  renderTokenStats(); renderTradeCol();
}
async function pollPrices(){
  if(priceBusy) return;
  priceBusy = true;
  try{
    const mints = new Set(Object.keys(S.positions)); mints.add(MINT);
    const fresh = remember(await fetchMints([...mints]));
    const map={}; fresh.forEach(t=>map[t.mint]=t);
    for(const m in S.positions){ if(map[m]){ S.positions[m].priceSol=map[m].priceSol; S.positions[m].priceUsd=map[m].priceUsd; } }
    flashCells(map);
    renderTokenStats(); renderDeck();
    lastTick = Date.now();
  }catch(e){}
  priceBusy = false;
}
function onTrade(){ renderTradeCol(); }

(async function(){
  await loadState();
  if(!requireWallet()) return;
  renderDeck(); refreshBalance();
  if(!MINT){ $('#tpanel').innerHTML='<div class="skel">No token specified. <a href="index.html" style="color:var(--brand2)">Back to feed</a></div>'; return; }
  // seed from URL params for instant paint, then fetch live data
  known[MINT] = known[MINT] || { mint:MINT, symbol:Q.get('sym')||'…', name:'', pair:Q.get('pair')||'', priceUsd:0, priceSol:0 };
  renderPage();
  try{
    const f = remember(await fetchMints([MINT]));
    if(f.length){ if(!f[0].pair && Q.get('pair')) f[0].pair=Q.get('pair'); known[MINT]=Object.assign(known[MINT], f[0]); }
    renderPage();
  }catch(e){}
  setInterval(pollPrices, 2000);
  setInterval(localTick, 1000);
  setInterval(refreshBalance, 30000);
})();
