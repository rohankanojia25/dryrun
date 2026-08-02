/* ================================================================
   DryRun · practice trading terminal (v2 · pulse)
   - Wallet + airdrops + balance: REAL, Solana devnet JSON-RPC
   - Market data: REAL, live mainnet
       · pump.fun lifecycle (new / graduating / graduated): GeckoTerminal API
       · trending: DexScreener boosts · search + price refresh: DexScreener
   - Trade fills: SIMULATED at live prices (devnet has no memecoin markets)
   ================================================================ */

const RPC = 'https://api.devnet.solana.com';
const DS  = 'https://api.dexscreener.com';
const GT  = 'https://api.geckoterminal.com/api/v2';
const KEY = 'dryrun:v1';
const FEE = 0.01;
const NETFEE = 0.0005;
const GRAD_MC = 69000;         // approx pump.fun graduation market cap (USD), used for est. progress

let S = { wallet:null, cash:0, positions:{}, history:[], realized:0 };
let tokens = [];
let sel = null;
let solUsd = 0;
let devnetBal = null;
let tab = 'new';               // new | grad | done | hot | search
let fetching = false;

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
  return '$'+fmt(n,2);
}
function age(ts){ if(!ts) return '';
  const s=(Date.now()-new Date(ts).getTime())/1000;
  if(s<60) return Math.max(1,s|0)+'s';
  if(s<3600) return (s/60|0)+'m';
  if(s<86400) return (s/3600|0)+'h';
  return (s/86400|0)+'d';
}
function toast(msg, cls){ const t=document.createElement('div'); t.className='toast '+(cls||'');
  t.innerHTML=msg; $('#toasts').appendChild(t); setTimeout(()=>t.remove(), 5200); }
function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------------- persistence ---------------- */
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

/* ---------------- Solana devnet ---------------- */
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
    toast('<b>1 devnet SOL claimed.</b> Practice balance credited.','ok');
    setTimeout(refreshBalance, 4000); setTimeout(refreshBalance, 12000);
  }catch(e){
    toast('<b>Faucet declined:</b> '+esc(e.message)+'<br>Devnet faucet is rate-limited and often dry. Try again shortly or use <b>faucet.solana.com</b> with your address.','err');
  }
  if(btn){btn.disabled=false;btn.textContent='Claim 1 devnet SOL';}
  renderAll();
}

/* ---------------- market data ---------------- */
function normDS(pairs){
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
      img:p.info?.imageUrl||'', priceUsd, priceSol, chg1:p.priceChange?.h1, chg24:p.priceChange?.h24,
      vol24:p.volume?.h24, liq:p.liquidity?.usd, mc:p.marketCap||p.fdv, pair:p.pairAddress,
      created:p.pairCreatedAt, progress:null, dex:p.dexId };
  });
}
function normGT(j){
  const inc = {}; (j.included||[]).forEach(t=>inc[t.id]=t.attributes||{});
  const out = [];
  for(const pool of j.data||[]){
    const a = pool.attributes||{};
    const tokId = pool.relationships?.base_token?.data?.id||'';
    const mint = tokId.replace(/^solana_/,'');
    if(!mint || mint.length<32) continue;
    const tk = inc[tokId]||{};
    const dex = pool.relationships?.dex?.data?.id||'';
    const priceUsd = +a.base_token_price_usd || 0;
    const priceSol = +a.base_token_price_native_currency || 0;
    if(priceUsd && priceSol) solUsd = priceUsd/priceSol;
    const mc = +a.market_cap_usd || +a.fdv_usd || 0;
    const onCurve = /pump/.test(dex) && !/swap/.test(dex);
    out.push({ mint, symbol: tk.symbol || (a.name||'').split(' /')[0] || '?', name: tk.name||'',
      img: tk.image_url && tk.image_url!=='missing.png' ? tk.image_url : '',
      priceUsd, priceSol, chg1:+(a.price_change_percentage?.h1)||null, chg24:+(a.price_change_percentage?.h24)||null,
      vol24:+(a.volume_usd?.h24)||0, liq:+a.reserve_in_usd||0, mc, pair:a.address,
      created:a.pool_created_at, dex,
      progress: onCurve && mc ? Math.min(mc/GRAD_MC,1) : null });
  }
  const seen={}; return out.filter(t=> seen[t.mint]?false:(seen[t.mint]=1));
}
async function gt(path){
  const r = await fetch(GT+path, {headers:{'Accept':'application/json'}});
  if(!r.ok) throw new Error('GeckoTerminal '+r.status);
  return r.json();
}
async function loadNew(){
  const j = await gt('/networks/solana/new_pools?include=base_token&page=1');
  const all = normGT(j);
  const fresh = all.filter(t=>/pump/.test(t.dex) && !/swap/.test(t.dex));
  return (fresh.length?fresh:all).sort((a,b)=>new Date(b.created)-new Date(a.created));
}
async function loadGraduating(){
  let j=null;
  for(const d of ['pump-fun','pumpfun']){
    try{ j = await gt('/networks/solana/dexes/'+d+'/pools?include=base_token&page=1'); break; }catch(e){}
  }
  if(!j) throw new Error('pump.fun pools unavailable');
  return normGT(j).filter(t=>t.progress!=null)
    .sort((a,b)=>b.progress-a.progress);
}
async function loadGraduated(){
  const j = await gt('/networks/solana/new_pools?include=base_token&page=1');
  let mig = normGT(j).filter(t=>/pumpswap|raydium|meteora|orca/.test(t.dex));
  if(mig.length<5){
    try{
      const j2 = await gt('/networks/solana/dexes/pumpswap/pools?include=base_token&page=1');
      mig = mig.concat(normGT(j2).filter(x=>!mig.find(y=>y.mint===x.mint)));
    }catch(e){}
  }
  return mig.sort((a,b)=>new Date(b.created)-new Date(a.created));
}
async function loadHot(){
  try{
    const j = await gt('/networks/solana/trending_pools?include=base_token&page=1');
    const t = normGT(j); if(t.length) return t;
  }catch(e){}
  const boosts = await (await fetch(DS+'/token-boosts/top/v1')).json();
  const addrs = [...new Set(boosts.filter(b=>b.chainId==='solana').map(b=>b.tokenAddress))].slice(0,30);
  if(!addrs.length) return [];
  const pairs = await (await fetch(DS+'/tokens/v1/solana/'+addrs.join(','))).json();
  return normDS(pairs);
}
async function fetchSearch(q){
  const j = await (await fetch(DS+'/latest/dex/search?q='+encodeURIComponent(q))).json();
  return normDS(j.pairs);
}
async function fetchMints(mints){
  if(!mints.length) return [];
  const pairs = await (await fetch(DS+'/tokens/v1/solana/'+mints.slice(0,30).join(','))).json();
  return normDS(pairs);
}

const LOADERS = { new:loadNew, grad:loadGraduating, done:loadGraduated, hot:loadHot };
async function loadTab(){
  if(fetching || tab==='search') return;
  fetching = true;
  try{
    const fresh = await LOADERS[tab]();
    if(fresh.length){ tokens = fresh; if(!sel) sel = tokens[0]; }
    renderList(); if(sel) renderCenterStats();
  }catch(e){ toast('<b>'+esc(tab)+' feed unavailable:</b> '+esc(e.message),'err'); }
  fetching = false;
}
async function refreshPrices(){
  try{
    const mints = new Set(Object.keys(S.positions));
    if(sel) mints.add(sel.mint);
    if(!mints.size) return;
    const fresh = await fetchMints([...mints]);
    const map={}; fresh.forEach(t=>map[t.mint]=t);
    if(sel && map[sel.mint]){
      const keep = {progress:sel.progress, created:sel.created, dex:sel.dex, img:sel.img||map[sel.mint].img};
      sel = Object.assign(sel, map[sel.mint], keep);
    }
    tokens.forEach(t=>{ if(map[t.mint]){ t.priceUsd=map[t.mint].priceUsd; t.priceSol=map[t.mint].priceSol; } });
    for(const m in S.positions){ if(map[m]){ S.positions[m].priceSol=map[m].priceSol; S.positions[m].priceUsd=map[m].priceUsd; } }
    renderDeck(); renderSide(); renderCenterStats();
  }catch(e){}
}

/* ---------------- trading ---------------- */
function buyToken(t, amt){
  amt = +amt;
  if(!t) return;
  if(!(amt>0)) return toast('Enter a SOL amount to buy.','err');
  if(amt+NETFEE > S.cash) return toast('Not enough practice SOL. Claim an airdrop first.','err');
  if(!(t.priceSol>0)) return toast('No live price for '+esc(t.symbol)+' right now.','err');
  const qty = amt*(1-FEE)/t.priceSol;
  S.cash -= (amt+NETFEE);
  const p = S.positions[t.mint] || {symbol:t.symbol,name:t.name,img:t.img,qty:0,cost:0,priceSol:t.priceSol,priceUsd:t.priceUsd,pair:t.pair};
  p.qty += qty; p.cost += amt+NETFEE; p.priceSol=t.priceSol; p.priceUsd=t.priceUsd;
  S.positions[t.mint]=p;
  S.history.unshift({t:Date.now(),side:'BUY',sym:t.symbol,qty,sol:amt});
  save(); renderDeck(); renderSide(); if(sel&&sel.mint===t.mint) renderTrade();
  toast('<b class="mono">BUY</b> '+fmt(qty)+' '+esc(t.symbol)+' for '+fmt(amt,4)+' SOL','ok');
}
function quickBuy(mint){
  const t = tokens.find(x=>x.mint===mint); if(!t) return;
  buyToken(t, 0.1);
}
function buy(amt){ buyToken(sel, amt); }
function sell(pct){
  if(!sel) return;
  const p = S.positions[sel.mint];
  if(!p || !(p.qty>0)) return toast('No position in '+esc(sel.symbol)+'.','err');
  if(!(sel.priceSol>0)) return toast('No live price right now.','err');
  const qty = p.qty * pct;
  const gross = qty*sel.priceSol, fee = gross*FEE, proceeds = gross-fee-NETFEE;
  const costPart = p.cost*(qty/p.qty);
  S.realized += proceeds - costPart;
  S.cash += Math.max(proceeds,0);
  p.qty -= qty; p.cost -= costPart;
  if(p.qty < 1e-9) delete S.positions[sel.mint];
  S.history.unshift({t:Date.now(),side:'SELL',sym:sel.symbol,qty,sol:proceeds});
  save(); renderDeck(); renderSide(); renderTrade();
  toast('<b class="mono">SELL</b> '+fmt(qty)+' '+esc(sel.symbol)+' → '+fmt(proceeds,4)+' SOL','ok');
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
function chgCell(v){ if(v==null||isNaN(v)) return '<span class="chg">–</span>';
  return `<span class="chg ${v>=0?'pos-chg':'neg-chg'}">${v>=0?'+':''}${fmt(v,1)}%</span>`; }
function rowExtra(t){
  if(t.progress!=null){
    const pc = Math.round(t.progress*100);
    return `<div class="prog"><div class="prog-fill" style="width:${pc}%"></div></div><div class="nm">${pc}% to graduation · est.</div>`;
  }
  return `<div class="nm">${esc(t.name)}</div>`;
}
function renderList(){
  const el=$('#toklist'); if(!el) return;
  const st = el.parentElement.scrollTop;
  el.innerHTML = tokens.map(t=>`
    <div class="tok ${sel&&sel.mint===t.mint?'sel':''}" onclick="selectMint('${t.mint}')">
      ${t.img?`<img src="${esc(t.img)}" alt="" onerror="this.style.visibility='hidden'">`:`<div class="noimg"></div>`}
      <div class="tokmid">
        <div class="symrow"><span class="sym">${esc(t.symbol)}</span>${t.created?`<span class="age">${age(t.created)}</span>`:''}</div>
        ${rowExtra(t)}
      </div>
      <div class="tokright">
        <div class="px">${t.mc?money(t.mc)+' MC':'$'+fmt(t.priceUsd)}</div>
        ${chgCell(t.chg1!=null?t.chg1:t.chg24)}
      </div>
      <button class="quick" title="Quick buy 0.1 SOL" onclick="event.stopPropagation();quickBuy('${t.mint}')">⚡.1</button>
    </div>`).join('') || '<div style="padding:1rem;color:var(--muted);font-size:.8rem">Nothing here right now. Feeds refresh every few seconds.</div>';
  el.parentElement.scrollTop = st;
}
function selectMint(m){ const t=tokens.find(x=>x.mint===m); if(t){ sel=t; renderCenter(); renderList(); refreshPrices(); } }
function renderCenterStats(){
  const el=$('#tokstats'); if(!el||!sel) return;
  el.innerHTML = `
    <div class="deck-stat"><span class="k">Price</span><span class="v">$${fmt(sel.priceUsd)}</span></div>
    <div class="deck-stat"><span class="k">Price · SOL</span><span class="v">${fmt(sel.priceSol)}</span></div>
    <div class="deck-stat"><span class="k">1h</span><span class="v">${chgCell(sel.chg1)}</span></div>
    <div class="deck-stat"><span class="k">24h</span><span class="v">${chgCell(sel.chg24)}</span></div>
    <div class="deck-stat"><span class="k">Vol 24h</span><span class="v">${money(sel.vol24)}</span></div>
    <div class="deck-stat"><span class="k">Liquidity</span><span class="v">${money(sel.liq)}</span></div>
    <div class="deck-stat"><span class="k">MC</span><span class="v">${money(sel.mc)}</span></div>
    ${sel.progress!=null?`<div class="deck-stat"><span class="k">Bonding</span><span class="v" style="color:var(--brand2)">${Math.round(sel.progress*100)}% est.</span></div>`:''}`;
}
function renderTrade(){
  const el=$('#tradecol'); if(!el||!sel) return;
  const pos=S.positions[sel.mint];
  el.innerHTML = `
    <div class="side">
      <h3 style="color:var(--up)">BUY</h3>
      <input id="buyamt" type="number" min="0" step="0.05" placeholder="SOL amount">
      <div class="presets">
        <button onclick="$('#buyamt').value=0.1">0.1</button>
        <button onclick="$('#buyamt').value=0.5">0.5</button>
        <button onclick="$('#buyamt').value=1">1</button>
        <button onclick="$('#buyamt').value=(Math.max(S.cash-0.001,0)).toFixed(3)">MAX</button>
      </div>
      <button class="exec btn-up" onclick="buy($('#buyamt').value)">Buy ${esc(sel.symbol)}</button>
      <div class="hint">1% fee + ${NETFEE} SOL net fee · simulated fill @ live price</div>
    </div>
    <div class="side">
      <h3 style="color:var(--down)">SELL</h3>
      <div class="hint" style="margin:0 0 .5rem">Holding: <b style="color:var(--text)">${pos?fmt(pos.qty):'0'}</b></div>
      <div class="presets">
        <button onclick="sell(0.25)">25%</button>
        <button onclick="sell(0.5)">50%</button>
        <button onclick="sell(0.75)">75%</button>
      </div>
      <button class="exec btn-down" onclick="sell(1)">Sell 100%</button>
    </div>
    <div class="side">
      <h3 style="color:var(--brand2)">POSITION</h3>
      ${pos?`
        <div class="cashrow"><span>Value</span><span class="v">${fmt(pos.qty*(sel.priceSol||0),4)} SOL</span></div>
        <div class="cashrow"><span>Cost</span><span class="v">${fmt(pos.cost,4)} SOL</span></div>
        <div class="cashrow"><span>PnL</span><span class="v" style="color:${pos.qty*(sel.priceSol||0)-pos.cost>=0?'var(--up)':'var(--down)'}">${fmt(pos.qty*(sel.priceSol||0)-pos.cost,4)}</span></div>
      `:'<div class="hint" style="margin:0">No position yet.</div>'}
    </div>`;
}
function renderCenter(){
  const c=$('#center'); if(!c) return;
  if(!sel){ c.innerHTML='<div class="panel-b" style="display:flex;align-items:center;justify-content:center;color:var(--muted)">Pick a token to open its live chart.</div>'; return; }
  c.innerHTML = `
    <div id="tokhead">
      ${sel.img?`<img src="${esc(sel.img)}" alt="" onerror="this.style.display='none'">`:''}
      <div><div class="t-name">${esc(sel.symbol)}</div><div class="t-sub">${esc(sel.name)} · <span class="mono">${sel.mint.slice(0,4)}…${sel.mint.slice(-4)}</span> · <span class="mono">${esc(sel.dex||'')}</span></div></div>
      <div class="statgrid" id="tokstats"></div>
    </div>
    <div id="centergrid">
      <div id="chartwrap"><iframe title="Live chart" src="https://dexscreener.com/solana/${sel.pair}?embed=1&theme=dark&info=0&trades=0" loading="lazy"></iframe></div>
      <div id="tradecol"></div>
    </div>`;
  renderCenterStats(); renderTrade();
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
      ${rows || '<tr><td colspan="4" style="color:var(--muted);font-family:Space Grotesk">No open positions.</td></tr>'}
    </table>
    <h3 style="font-size:.72rem;letter-spacing:.08em;color:var(--brand2);margin:1.1rem 0 .3rem">HISTORY</h3>
    ${S.history.slice(0,25).map(h=>`<div class="hist"><span class="${h.side==='BUY'?'b':'s'}">${h.side}</span> <b>${esc(h.sym)}</b> · ${fmt(h.qty)} · ${fmt(h.sol,3)} SOL · ${new Date(h.t).toLocaleTimeString()}</div>`).join('') || '<div class="hist">No trades yet.</div>'}
    `;
}
async function jumpTo(m){
  let t = tokens.find(x=>x.mint===m);
  if(!t){ const f=await fetchMints([m]); if(f.length){ t=f[0]; tokens.unshift(t); } }
  if(t){ sel=t; renderCenter(); renderList(); }
}
async function doSearch(){
  const q=$('#q').value.trim(); if(!q) return;
  tab='search'; setTabs();
  try{
    tokens = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q) ? await fetchMints([q]) : await fetchSearch(q);
    if(tokens.length) sel=tokens[0];
    renderList(); renderCenter();
  }catch(e){ toast('Search failed: '+esc(e.message),'err'); }
}
function setTabs(){
  ['new','grad','done','hot'].forEach(t=>$('#tab-'+t)?.classList.toggle('on', tab===t));
}
function switchTab(t){ tab=t; setTabs(); tokens=[]; renderList(); loadTab(); }

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
        <div><b>03</b> Trade new, graduating, and graduated pump.fun tokens live</div>
      </div>
      <button class="btn-brand" style="padding:.8rem 1.6rem;font-size:1rem" onclick="makeWallet();renderApp();renderDeck();refreshBalance();toast('Wallet created. It lives in this browser only — never send real SOL to it.','ok')">Generate practice wallet</button>
    </div></div>`;
    return;
  }
  app.innerHTML = `
    <section class="panel">
      <div class="panel-h" style="gap:.35rem">
        <button id="tab-new" class="tabb on" onclick="switchTab('new')">NEW</button>
        <button id="tab-grad" class="tabb" onclick="switchTab('grad')">GRADUATING</button>
        <button id="tab-done" class="tabb" onclick="switchTab('done')">GRADUATED</button>
        <button id="tab-hot" class="tabb" onclick="switchTab('hot')">HOT</button>
      </div>
      <div style="padding:.6rem .9rem;border-bottom:1px solid var(--line);display:flex;gap:.4rem">
        <input id="q" placeholder="Name, symbol, or mint address" onkeydown="if(event.key==='Enter')doSearch()">
        <button class="btn-ghost" onclick="doSearch()">Go</button>
      </div>
      <div class="panel-b" style="padding:0"><div id="toklist"></div></div>
    </section>
    <section class="panel" id="center"></section>
    <section class="panel">
      <div class="panel-h"><h3>Portfolio</h3>
        <button class="btn-ghost" style="margin-left:auto;font-size:.68rem;padding:.3rem .6rem" onclick="if(confirm('Reset practice account? Wallet stays, trades and balances clear.')){S.cash=0;S.positions={};S.history=[];S.realized=0;save();renderDeck();renderSide();renderTrade();}">Reset</button>
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
  await loadTab();
  refreshBalance();
  setInterval(loadTab, 8000);        // active feed refresh
  setInterval(refreshPrices, 5000);  // selected token + positions
  setInterval(refreshBalance, 30000);
})();
