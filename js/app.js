/* ================================================================
   DryRun · practice trading terminal
   Architecture (honest version):
   - Wallet + airdrops + balance: REAL, on Solana devnet via JSON-RPC
   - Market data: REAL, live mainnet tokens via DexScreener public API
   - Trade fills: SIMULATED at live prices (devnet has no memecoin markets)
   ================================================================ */

const RPC = 'https://api.devnet.solana.com';
const DS  = 'https://api.dexscreener.com';
const KEY = 'dryrun:v1';
const FEE = 0.01;           // 1% simulated swap fee (pump.fun-style)
const NETFEE = 0.0005;      // simulated network fee in SOL

let S = { wallet:null, cash:0, positions:{}, history:[], realized:0 };
let tokens = [];            // market list [{mint,symbol,name,img,priceUsd,priceSol,chg24,vol24,liq,mc,pair}]
let sel = null;             // selected token
let solUsd = 0;
let devnetBal = null;
let tab = 'trending';

/* ---------------- utils ---------------- */
const $ = s => document.querySelector(s);
const ALPH='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(bytes){
  let n=0n; for(const b of bytes) n = n*256n + BigInt(b);
  let s=''; while(n>0n){ s = ALPH[Number(n%58n)] + s; n/=58n; }
  for(const b of bytes){ if(b===0) s='1'+s; else break; }
  return s || '1';
}
function fmt(n, d){ if(n==null||isNaN(n)) return '–';
  if(d!=null) return Number(n).toLocaleString('en-US',{maximumFractionDigits:d});
  const a=Math.abs(n);
  return Number(n).toLocaleString('en-US',{maximumFractionDigits: a>=1000?0 : a>=1?2 : a>=0.001?5 : 9});
}
function money(n){ if(n==null||isNaN(n)) return '–';
  const a=Math.abs(n);
  if(a>=1e9) return '$'+(n/1e9).toFixed(2)+'B';
  if(a>=1e6) return '$'+(n/1e6).toFixed(2)+'M';
  if(a>=1e3) return '$'+(n/1e3).toFixed(1)+'K';
  return '$'+fmt(n);
}
function toast(msg, cls){ const t=document.createElement('div'); t.className='toast '+(cls||'');
  t.innerHTML=msg; $('#toasts').appendChild(t); setTimeout(()=>t.remove(), 5200); }
function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------------- persistence (artifact storage -> localStorage -> memory) ---------------- */
async function save(){
  const raw = JSON.stringify(S);
  try{ if(window.storage){ await window.storage.set(KEY, raw); return; } }catch(e){}
  try{ localStorage.setItem(KEY, raw); }catch(e){}
}
async function load(){
  let raw=null;
  try{ if(window.storage){ const r=await window.storage.get(KEY); raw=r&&r.value; } }catch(e){}
  if(!raw){ try{ raw=localStorage.getItem(KEY); }catch(e){} }
  if(raw){ try{ S = Object.assign(S, JSON.parse(raw)); }catch(e){} }
}

/* ---------------- Solana devnet JSON-RPC ---------------- */
async function rpc(method, params){
  const r = await fetch(RPC,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})});
  const j = await r.json();
  if(j.error) throw new Error(j.error.message||'RPC error');
  return j.result;
}
async function refreshBalance(){
  if(!S.wallet) return;
  try{
    const res = await rpc('getBalance',[S.wallet.address]);
    devnetBal = res.value/1e9;
    $('#netdot')?.classList.add('on');
  }catch(e){ $('#netdot')?.classList.remove('on'); }
  renderDeck();
}
function makeWallet(){
  const kp = nacl.sign.keyPair();
  S.wallet = { address: b58(kp.publicKey), secret: Array.from(kp.secretKey) };
  S.cash = 0;
  save();
}
async function airdrop(){
  const btn=$('#airdropbtn'); if(btn){btn.disabled=true;btn.textContent='Requesting…';}
  try{
    await rpc('requestAirdrop',[S.wallet.address, 1e9]);
    S.cash += 1; await save();
    toast('<b>1 devnet SOL claimed.</b> Practice balance credited. On-chain balance updates in a few seconds.','ok');
    setTimeout(refreshBalance, 4000); setTimeout(refreshBalance, 12000);
  }catch(e){
    toast('<b>Faucet declined:</b> '+esc(e.message)+'<br>Devnet faucet is rate-limited and often dry. Try again in a minute, use <b>faucet.solana.com</b> with your address, or start with practice SOL below.','err');
  }
  if(btn){btn.disabled=false;btn.textContent='Claim 1 devnet SOL';}
  renderAll();
}

/* ---------------- DexScreener market data ---------------- */
function pickPairs(pairs){
  // group by base token, keep the most liquid pair
  const by={};
  for(const p of pairs||[]){
    if(p.chainId!=='solana') continue;
    const m=p.baseToken?.address; if(!m) continue;
    const liq=p.liquidity?.usd||0;
    if(!by[m] || liq>(by[m].liquidity?.usd||0)) by[m]=p;
  }
  return Object.values(by).map(p=>{
    const isSolQuote = /SOL/i.test(p.quoteToken?.symbol||'');
    if(isSolQuote && p.priceUsd && p.priceNative) solUsd = (+p.priceUsd)/(+p.priceNative);
    const priceUsd = +p.priceUsd || 0;
    const priceSol = isSolQuote ? (+p.priceNative||0) : (solUsd? priceUsd/solUsd : 0);
    return { mint:p.baseToken.address, symbol:p.baseToken.symbol||'?', name:p.baseToken.name||'',
      img:p.info?.imageUrl||'', priceUsd, priceSol, chg24:p.priceChange?.h24, chg5:p.priceChange?.m5,
      vol24:p.volume?.h24, liq:p.liquidity?.usd, mc:p.marketCap||p.fdv, pair:p.pairAddress };
  });
}
async function fetchTrending(){
  const boosts = await (await fetch(DS+'/token-boosts/top/v1')).json();
  const addrs = [...new Set(boosts.filter(b=>b.chainId==='solana').map(b=>b.tokenAddress))].slice(0,30);
  if(!addrs.length) return [];
  const pairs = await (await fetch(DS+'/tokens/v1/solana/'+addrs.join(','))).json();
  return pickPairs(pairs);
}
async function fetchSearch(q){
  const j = await (await fetch(DS+'/latest/dex/search?q='+encodeURIComponent(q))).json();
  return pickPairs(j.pairs);
}
async function fetchMints(mints){
  if(!mints.length) return [];
  const pairs = await (await fetch(DS+'/tokens/v1/solana/'+mints.slice(0,30).join(','))).json();
  return pickPairs(pairs);
}
async function loadMarket(){
  try{
    tokens = tab==='trending' ? await fetchTrending() : tokens;
    if(!sel && tokens.length) sel = tokens[0];
    renderAll();
  }catch(e){ toast('<b>Market data unavailable:</b> '+esc(e.message),'err'); }
}
async function refreshPrices(){
  try{
    const mints = new Set(Object.keys(S.positions));
    if(sel) mints.add(sel.mint);
    tokens.slice(0,15).forEach(t=>mints.add(t.mint));
    const fresh = await fetchMints([...mints]);
    const map={}; fresh.forEach(t=>map[t.mint]=t);
    tokens = tokens.map(t=>map[t.mint]?Object.assign(t,map[t.mint]):t);
    if(sel && map[sel.mint]) sel = Object.assign(sel, map[sel.mint]);
    for(const m in S.positions){ if(map[m]){ S.positions[m].priceSol=map[m].priceSol; S.positions[m].priceUsd=map[m].priceUsd; } }
    renderDeck(); renderSide(); renderCenterStats();
  }catch(e){}
}

/* ---------------- trading (simulated fills, live prices) ---------------- */
function buy(amt){
  if(!sel) return;
  amt = +amt;
  if(!(amt>0)) return toast('Enter a SOL amount to buy.','err');
  if(amt+NETFEE > S.cash) return toast('Not enough practice SOL. Claim an airdrop first.','err');
  if(!(sel.priceSol>0)) return toast('No live price for this token right now.','err');
  const qty = amt*(1-FEE)/sel.priceSol;
  S.cash -= (amt+NETFEE);
  const p = S.positions[sel.mint] || {symbol:sel.symbol,name:sel.name,img:sel.img,qty:0,cost:0,priceSol:sel.priceSol,priceUsd:sel.priceUsd,pair:sel.pair};
  p.qty += qty; p.cost += amt+NETFEE; p.priceSol=sel.priceSol; p.priceUsd=sel.priceUsd;
  S.positions[sel.mint]=p;
  S.history.unshift({t:Date.now(),side:'BUY',sym:sel.symbol,qty,sol:amt});
  save(); renderAll();
  toast('<b class="mono">BUY</b> '+fmt(qty)+' '+esc(sel.symbol)+' for '+fmt(amt,4)+' SOL (simulated fill @ live price)','ok');
}
function sell(pct){
  if(!sel) return;
  const p = S.positions[sel.mint];
  if(!p || !(p.qty>0)) return toast('No position in '+esc(sel.symbol)+'.','err');
  if(!(sel.priceSol>0)) return toast('No live price for this token right now.','err');
  const qty = p.qty * pct;
  const gross = qty*sel.priceSol, fee = gross*FEE, proceeds = gross-fee-NETFEE;
  const costPart = p.cost*(qty/p.qty);
  S.realized += proceeds - costPart;
  S.cash += Math.max(proceeds,0);
  p.qty -= qty; p.cost -= costPart;
  if(p.qty < 1e-9) delete S.positions[sel.mint];
  S.history.unshift({t:Date.now(),side:'SELL',sym:sel.symbol,qty,sol:proceeds});
  save(); renderAll();
  toast('<b class="mono">SELL</b> '+fmt(qty)+' '+esc(sel.symbol)+' → '+fmt(proceeds,4)+' SOL (simulated fill @ live price)','ok');
}

/* ---------------- rendering ---------------- */
function pnl(){
  let u=0; for(const m in S.positions){ const p=S.positions[m]; u += p.qty*(p.priceSol||0) - p.cost; }
  return {unreal:u, total:u+S.realized};
}
function renderDeck(){
  $('#solusd').textContent = solUsd? '$'+fmt(solUsd,2) : '–';
  const z=$('#walletzone');
  if(!S.wallet){ z.innerHTML=''; return; }
  const P=pnl();
  const col = P.total>=0?'var(--up)':'var(--down)';
  z.innerHTML = `
    <div id="walletchip">
      <div class="deck-stat"><span class="k">Devnet SOL</span><span class="v">${devnetBal==null?'–':fmt(devnetBal,3)}</span></div>
      <div class="deck-stat"><span class="k">Practice SOL</span><span class="v">${fmt(S.cash,3)}</span></div>
      <div class="deck-stat"><span class="k">Total PnL</span><span class="v" style="color:${col}">${P.total>=0?'+':''}${fmt(P.total,3)}</span></div>
      <span class="addr" title="Copy address" onclick="navigator.clipboard.writeText('${S.wallet.address}').then(()=>toast('Address copied.','ok'))">${S.wallet.address.slice(0,4)}…${S.wallet.address.slice(-4)} ⧉</span>
      <button class="btn-brand" id="airdropbtn" onclick="airdrop()">Claim 1 devnet SOL</button>
    </div>`;
}
function chgCell(v){ if(v==null) return '<span class="chg">–</span>';
  return `<span class="chg ${v>=0?'pos-chg':'neg-chg'}">${v>=0?'+':''}${fmt(v,1)}%</span>`; }
function renderList(){
  const el=$('#toklist'); if(!el) return;
  el.innerHTML = tokens.map(t=>`
    <div class="tok ${sel&&sel.mint===t.mint?'sel':''}" onclick="selectMint('${t.mint}')">
      ${t.img?`<img src="${esc(t.img)}" alt="">`:`<div style="width:34px;height:34px;border-radius:50%;background:var(--line)"></div>`}
      <div><div class="sym">${esc(t.symbol)}</div><div class="nm">${esc(t.name)}</div></div>
      <div><div class="px">$${fmt(t.priceUsd)}</div>${chgCell(t.chg24)}</div>
    </div>`).join('') || '<div style="padding:1rem;color:var(--muted);font-size:.8rem">No tokens found. Try another search, or paste a token address.</div>';
}
function selectMint(m){ sel = tokens.find(t=>t.mint===m)||sel; renderAll(); }
function renderCenterStats(){
  const el=$('#tokstats'); if(!el||!sel) return;
  el.innerHTML = `
    <div class="deck-stat"><span class="k">Price</span><span class="v">$${fmt(sel.priceUsd)}</span></div>
    <div class="deck-stat"><span class="k">Price · SOL</span><span class="v">${fmt(sel.priceSol)}</span></div>
    <div class="deck-stat"><span class="k">24h</span><span class="v">${chgCell(sel.chg24)}</span></div>
    <div class="deck-stat"><span class="k">Vol 24h</span><span class="v">${money(sel.vol24)}</span></div>
    <div class="deck-stat"><span class="k">Liquidity</span><span class="v">${money(sel.liq)}</span></div>
    <div class="deck-stat"><span class="k">MC</span><span class="v">${money(sel.mc)}</span></div>`;
}
function renderCenter(){
  const c=$('#center'); if(!c) return;
  if(!sel){ c.innerHTML='<div class="panel-b" style="display:flex;align-items:center;justify-content:center;color:var(--muted)">Pick a token on the left to open its live chart.</div>'; return; }
  const pos=S.positions[sel.mint];
  c.innerHTML = `
    <div id="tokhead">
      ${sel.img?`<img src="${esc(sel.img)}" alt="">`:''}
      <div><div class="t-name">${esc(sel.symbol)}</div><div class="t-sub">${esc(sel.name)} · <span class="mono">${sel.mint.slice(0,4)}…${sel.mint.slice(-4)}</span></div></div>
      <div class="statgrid" id="tokstats"></div>
    </div>
    <div id="chartwrap"><iframe title="Live chart" src="https://dexscreener.com/solana/${sel.pair}?embed=1&theme=dark&info=0&trades=0" loading="lazy"></iframe></div>
    <div id="tradebox">
      <div class="side">
        <h3 style="color:var(--up)">BUY · practice SOL</h3>
        <input id="buyamt" type="number" min="0" step="0.05" placeholder="Amount in SOL">
        <div class="presets">
          <button onclick="$('#buyamt').value=0.1">0.1</button>
          <button onclick="$('#buyamt').value=0.5">0.5</button>
          <button onclick="$('#buyamt').value=1">1</button>
          <button onclick="$('#buyamt').value=(Math.max(S.cash-0.001,0)).toFixed(3)">MAX</button>
        </div>
        <button class="exec btn-up" onclick="buy($('#buyamt').value)">Buy ${esc(sel.symbol)}</button>
        <div class="hint">1% swap fee + ${NETFEE} SOL network fee, simulated fill at live price</div>
      </div>
      <div class="side">
        <h3 style="color:var(--down)">SELL · position</h3>
        <div class="hint" style="margin:0 0 .5rem">Holding: <b style="color:var(--text)">${pos?fmt(pos.qty):'0'}</b> ${esc(sel.symbol)}</div>
        <div class="presets">
          <button onclick="sell(0.25)">25%</button>
          <button onclick="sell(0.5)">50%</button>
          <button onclick="sell(0.75)">75%</button>
        </div>
        <button class="exec btn-down" onclick="sell(1)">Sell 100%</button>
        <div class="hint">Realized PnL is tracked in the portfolio panel</div>
      </div>
    </div>`;
  renderCenterStats();
}
function renderSide(){
  const el=$('#portfolio'); if(!el) return;
  const P=pnl();
  const rows = Object.entries(S.positions).map(([m,p])=>{
    const val=p.qty*(p.priceSol||0), u=val-p.cost, c=u>=0?'pos-chg':'neg-chg';
    return `<tr><td onclick="jumpTo('${m}')" title="Open">${esc(p.symbol)}</td>
      <td>${fmt(p.qty)}</td><td>${fmt(val,3)}</td><td class="${c}">${u>=0?'+':''}${fmt(u,3)}</td></tr>`;
  }).join('');
  el.innerHTML = `
    <div class="cashrow"><span>Practice cash</span><span class="v">${fmt(S.cash,4)} SOL</span></div>
    <div class="cashrow"><span>Unrealized PnL</span><span class="v" style="color:${P.unreal>=0?'var(--up)':'var(--down)'}">${P.unreal>=0?'+':''}${fmt(P.unreal,4)} SOL</span></div>
    <div class="cashrow"><span>Realized PnL</span><span class="v" style="color:${S.realized>=0?'var(--up)':'var(--down)'}">${S.realized>=0?'+':''}${fmt(S.realized,4)} SOL</span></div>
    <table class="postbl" style="margin-top:.7rem">
      <tr><th>Token</th><th>Qty</th><th>Val (SOL)</th><th>PnL</th></tr>
      ${rows || '<tr><td colspan="4" style="color:var(--muted);font-family:Space Grotesk">No open positions. Pick a token and place a practice buy.</td></tr>'}
    </table>
    <h3 style="font-size:.72rem;letter-spacing:.08em;color:var(--brand2);margin:1.1rem 0 .3rem">HISTORY</h3>
    ${S.history.slice(0,25).map(h=>`<div class="hist"><span class="${h.side==='BUY'?'b':'s'}">${h.side}</span> <b>${esc(h.sym)}</b> · ${fmt(h.qty)} · ${fmt(h.sol,3)} SOL · ${new Date(h.t).toLocaleTimeString()}</div>`).join('') || '<div class="hist">No trades yet.</div>'}
    `;
}
async function jumpTo(m){
  let t = tokens.find(x=>x.mint===m);
  if(!t){ const f=await fetchMints([m]); if(f.length){ t=f[0]; tokens.unshift(t); } }
  if(t){ sel=t; renderAll(); }
}
async function doSearch(){
  const q=$('#q').value.trim(); if(!q) return;
  tab='search'; setTabs();
  try{
    tokens = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q) ? await fetchMints([q]) : await fetchSearch(q);
    if(tokens.length) sel=tokens[0];
    renderAll();
  }catch(e){ toast('Search failed: '+esc(e.message),'err'); }
}
function setTabs(){ $('#tabT')?.classList.toggle('on',tab==='trending'); $('#tabS')?.classList.toggle('on',tab==='search'); }
async function goTrending(){ tab='trending'; setTabs(); try{ tokens=await fetchTrending(); if(tokens.length&&!tokens.find(t=>sel&&t.mint===sel.mint)) sel=tokens[0]; renderAll(); }catch(e){ toast('Could not load trending: '+esc(e.message),'err'); } }

function renderApp(){
  const app=$('#app');
  if(!S.wallet){
    app.innerHTML = `
    <div id="onboard"><div class="ob-card">
      <h1>Practice like it's <b>real.</b></h1>
      <p>Trade live Solana memecoins with devnet SOL. Real market data, real wallet, zero real money. Blow up here so you don't blow up on mainnet.</p>
      <div class="ob-steps">
        <div><b>01</b> Generate a practice wallet (real Solana keypair, browser-only)</div>
        <div><b>02</b> Claim free devnet SOL from the faucet</div>
        <div><b>03</b> Trade live pump.fun-era tokens with simulated fills at live prices</div>
      </div>
      <button class="btn-brand" style="padding:.8rem 1.6rem;font-size:1rem" onclick="makeWallet();renderApp();renderDeck();refreshBalance();toast('Wallet created. It lives in this browser only — never send real SOL to it.','ok')">Generate practice wallet</button>
    </div></div>`;
    return;
  }
  app.innerHTML = `
    <section class="panel">
      <div class="panel-h"><h3>Tokens</h3>
        <div class="tabbtns">
          <button id="tabT" class="on" onclick="goTrending()">Trending</button>
          <button id="tabS" onclick="tab='search';setTabs()">Search</button>
        </div>
      </div>
      <div style="padding:.6rem .9rem;border-bottom:1px solid var(--line);display:flex;gap:.4rem">
        <input id="q" placeholder="Name, symbol, or mint address" onkeydown="if(event.key==='Enter')doSearch()">
        <button class="btn-ghost" onclick="doSearch()">Go</button>
      </div>
      <div class="panel-b" style="padding:0" ><div id="toklist"></div></div>
    </section>
    <section class="panel" id="center"></section>
    <section class="panel">
      <div class="panel-h"><h3>Portfolio</h3>
        <button class="btn-ghost" style="margin-left:auto;font-size:.68rem;padding:.3rem .6rem" onclick="if(confirm('Reset practice account? Wallet stays, trades and balances clear.')){S.cash=0;S.positions={};S.history=[];S.realized=0;save();renderAll();}">Reset</button>
      </div>
      <div class="panel-b" id="portfolio"></div>
    </section>`;
  setTabs(); renderList(); renderCenter(); renderSide();
}
function renderAll(){ if(S.wallet){ renderApp(); } renderDeck(); }

/* ---------------- boot ---------------- */
(async function(){
  await load();
  renderApp(); renderDeck();
  await loadMarket();
  refreshBalance();
  setInterval(refreshPrices, 12000);
  setInterval(refreshBalance, 30000);
})();
