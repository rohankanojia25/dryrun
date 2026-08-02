/* ================================================================
   DryRun v3 · pulse pages
   Pages:  #/            token feed (new / graduating / graduated / hot)
           #/t/<mint>    trade page (chart + buy/sell + position)
           #/portfolio   wallet, positions, history, export/import
   Live-feel engine: 3s price polling with flash animations, 10s feed
   polling with new-token highlights, 1s local tick for ages/timers.
   Wallet: ONE permanent devnet keypair per browser, exportable and
   importable so PnL follows the same address anywhere.
   ================================================================ */

const RPC = 'https://api.devnet.solana.com';
const DS  = 'https://api.dexscreener.com';
const GT  = 'https://api.geckoterminal.com/api/v2';
const KEY = 'dryrun:v1';
const FEE = 0.01;
const NETFEE = 0.0005;
const GRAD_MC = 69000;

let S = { wallet:null, cash:0, positions:{}, history:[], realized:0 };
let tokens = [];            // current feed list
let known = {};             // mint -> token (everything ever seen)
let page = { name:'list' }; // list | token | portfolio
let tab = 'new';
let solUsd = 0;
let devnetBal = null;
let feedBusy = false, priceBusy = false;
let lastPrice = {};         // mint -> previous priceUsd (for flashes)
let lastTick = Date.now();

/* ---------------- utils ---------------- */
const $ = s => document.querySelector(s);
const ALPH='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(bytes){
  let n=0n; for(const b of bytes) n = n*256n + BigInt(b);
  let s=''; while(n>0n){ s = ALPH[Number(n%58n)] + s; n/=58n; }
  for(const b of bytes){ if(b===0) s='1'+s; else break; }
  return s || '1';
}
function b58d(str){
  let n=0n;
  for(const c of str){ const i=ALPH.indexOf(c); if(i<0) throw new Error('Invalid character in key'); n=n*58n+BigInt(i); }
  const bytes=[]; while(n>0n){ bytes.unshift(Number(n&255n)); n>>=8n; }
  for(const c of str){ if(c==='1') bytes.unshift(0); else break; }
  return new Uint8Array(bytes);
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
  try{ if(window.storage){ await window.storage.set(KEY, raw); } }catch(e){}
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
  S.cash = 0; S.positions={}; S.history=[]; S.realized=0;
  save();
}
function exportKey(){
  if(!S.wallet) return;
  const k = b58(Uint8Array.from(S.wallet.secret));
  navigator.clipboard.writeText(k).then(()=>toast('<b>Secret key copied.</b> Store it somewhere safe. Paste it on any device to restore this exact wallet and PnL. Practice wallet only — never fund it with real SOL.','ok'));
}
function importKey(){
  const k = prompt('Paste your DryRun secret key (base58). This restores that wallet and replaces the current one on this device.');
  if(!k) return;
  try{
    const sk = b58d(k.trim());
    if(sk.length!==64) throw new Error('Key must decode to 64 bytes');
    const kp = nacl.sign.keyPair.fromSecretKey(sk);
    S.wallet = { address: b58(kp.publicKey), secret: Array.from(sk) };
    save(); refreshBalance(); route();
    toast('<b>Wallet restored:</b> '+S.wallet.address.slice(0,4)+'…'+S.wallet.address.slice(-4)+'. Note: trades/PnL live in browser storage per device; the address and devnet balance follow the key everywhere.','ok');
  }catch(e){ toast('<b>Import failed:</b> '+esc(e.message),'err'); }
}
async function airdrop(){
  const btn=$('#airdropbtn'); if(btn){btn.disabled=true;btn.textContent='Requesting…';}
  try{
    await rpc('requestAirdrop',[S.wallet.address, 1e9]);
    S.cash += 1; await save();
    toast('<b>1 devnet SOL claimed.</b> Practice balance credited.','ok');
    setTimeout(refreshBalance, 4000); setTimeout(refreshBalance, 12000);
  }catch(e){
    toast('<b>Faucet declined:</b> '+esc(e.message)+'<br>The public devnet faucet is rate-limited and often dry. Try again shortly, or paste your address at <b>faucet.solana.com</b>.','err');
  }
  if(btn){btn.disabled=false;btn.textContent='Claim 1 devnet SOL';}
  renderDeck();
}

/* ---------------- market data ---------------- */
function remember(list){ list.forEach(t=>{ known[t.mint]=Object.assign(known[t.mint]||{}, t); }); return list; }
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
async function gtFetch(path){
  const r = await fetch(GT+path, {headers:{'Accept':'application/json'}});
  if(!r.ok) throw new Error('GeckoTerminal '+r.status);
  return r.json();
}
async function loadNew(){
  const j = await gtFetch('/networks/solana/new_pools?include=base_token&page=1');
  const all = normGT(j);
  const fresh = all.filter(t=>/pump/.test(t.dex) && !/swap/.test(t.dex));
  return (fresh.length?fresh:all).sort((a,b)=>new Date(b.created)-new Date(a.created));
}
async function loadGraduating(){
  let j=null;
  for(const d of ['pump-fun','pumpfun']){
    try{ j = await gtFetch('/networks/solana/dexes/'+d+'/pools?include=base_token&page=1'); break; }catch(e){}
  }
  if(!j) throw new Error('pump.fun pools unavailable');
  return normGT(j).filter(t=>t.progress!=null).sort((a,b)=>b.progress-a.progress);
}
async function loadGraduated(){
  const j = await gtFetch('/networks/solana/new_pools?include=base_token&page=1');
  let mig = normGT(j).filter(t=>/pumpswap|raydium|meteora|orca/.test(t.dex));
  if(mig.length<5){
    try{
      const j2 = await gtFetch('/networks/solana/dexes/pumpswap/pools?include=base_token&page=1');
      mig = mig.concat(normGT(j2).filter(x=>!mig.find(y=>y.mint===x.mint)));
    }catch(e){}
  }
  return mig.sort((a,b)=>new Date(b.created)-new Date(a.created));
}
async function loadHot(){
  try{
    const j = await gtFetch('/networks/solana/trending_pools?include=base_token&page=1');
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

/* ---------------- live-feel engine ---------------- */
async function pollFeed(){
  if(page.name!=='list' || feedBusy || tab==='search') return;
  feedBusy = true;
  try{
    const fresh = remember(await LOADERS[tab]());
    if(fresh.length){
      const existing = new Set(tokens.map(t=>t.mint));
      fresh.forEach(t=>{ if(!existing.has(t.mint)) t._new = Date.now(); });
      tokens = fresh;
      renderList();
    }
    lastTick = Date.now();
  }catch(e){}
  feedBusy = false;
}
async function pollPrices(){
  if(priceBusy) return;
  priceBusy = true;
  try{
    const mints = new Set(Object.keys(S.positions));
    if(page.name==='token' && page.mint) mints.add(page.mint);
    if(page.name==='list') tokens.slice(0,25).forEach(t=>mints.add(t.mint));
    if(mints.size){
      const fresh = remember(await fetchMints([...mints]));
      const map={}; fresh.forEach(t=>map[t.mint]=t);
      // flash detection
      for(const m in map){
        const prev = lastPrice[m];
        if(prev!=null && map[m].priceUsd!==prev){
          flash(m, map[m].priceUsd>prev);
        }
        lastPrice[m]=map[m].priceUsd;
      }
      tokens.forEach(t=>{ if(map[t.mint]){ t.priceUsd=map[t.mint].priceUsd; t.priceSol=map[t.mint].priceSol; t.mc=map[t.mint].mc||t.mc; } });
      for(const m in S.positions){ if(map[m]){ S.positions[m].priceSol=map[m].priceSol; S.positions[m].priceUsd=map[m].priceUsd; } }
      updatePriceCells(map);
      lastTick = Date.now();
    }
  }catch(e){}
  priceBusy = false;
}
function flash(mint, up){
  document.querySelectorAll('[data-px="'+mint+'"]').forEach(el=>{
    el.classList.remove('fl-up','fl-down');
    void el.offsetWidth;
    el.classList.add(up?'fl-up':'fl-down');
  });
}
function updatePriceCells(map){
  document.querySelectorAll('[data-px]').forEach(el=>{
    const t = map[el.dataset.px] || known[el.dataset.px];
    if(!t) return;
    el.textContent = el.dataset.mode==='mc' && t.mc ? money(t.mc)+' MC' : '$'+fmt(t.priceUsd);
  });
  if(page.name==='token') renderTokenStats();
  renderDeck();
  if(page.name==='portfolio') renderPortfolioBody();
}
function localTick(){
  // ages + freshness indicator, zero network
  document.querySelectorAll('[data-age]').forEach(el=>{ el.textContent = age(el.dataset.age); });
  const el=$('#livedot');
  if(el){ const s=(Date.now()-lastTick)/1000; el.classList.toggle('stale', s>15); el.title='Last update '+(s|0)+'s ago'; }
}

/* ---------------- trading ---------------- */
function tokenOf(mint){ return known[mint]; }
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
  S.history.unshift({t:Date.now(),side:'BUY',sym:t.symbol,mint:t.mint,qty,sol:amt});
  save(); renderDeck();
  if(page.name==='token') renderTradeCol();
  toast('<b class="mono">BUY</b> '+fmt(qty)+' '+esc(t.symbol)+' for '+fmt(amt,4)+' SOL','ok');
}
function quickBuy(mint){ const t=tokenOf(mint); if(t) buyToken(t, 0.1); }
function sellPct(mint, pct){
  const t = tokenOf(mint);
  const p = S.positions[mint];
  if(!p || !(p.qty>0)) return toast('No position here.','err');
  const priceSol = (t&&t.priceSol) || p.priceSol;
  if(!(priceSol>0)) return toast('No live price right now.','err');
  const qty = p.qty * pct;
  const gross = qty*priceSol, fee = gross*FEE, proceeds = gross-fee-NETFEE;
  const costPart = p.cost*(qty/p.qty);
  S.realized += proceeds - costPart;
  S.cash += Math.max(proceeds,0);
  p.qty -= qty; p.cost -= costPart;
  if(p.qty < 1e-9) delete S.positions[mint];
  S.history.unshift({t:Date.now(),side:'SELL',sym:p.symbol,mint,qty,sol:proceeds});
  save(); renderDeck();
  if(page.name==='token') renderTradeCol();
  if(page.name==='portfolio') renderPortfolioBody();
  toast('<b class="mono">SELL</b> '+fmt(qty)+' '+esc(p.symbol)+' → '+fmt(proceeds,4)+' SOL','ok');
}

/* ---------------- deck ---------------- */
function pnlTotals(){
  let u=0; for(const m in S.positions){ const p=S.positions[m]; u += p.qty*(p.priceSol||0) - p.cost; }
  return {unreal:u, total:u+S.realized};
}
function renderDeck(){
  $('#solusd').textContent = solUsd? '$'+fmt(solUsd,2) : '–';
  const z=$('#walletzone');
  if(!S.wallet){ z.innerHTML=''; return; }
  const P=pnlTotals();
  const col = P.total>=0?'var(--up)':'var(--down)';
  z.innerHTML = `
    <div id="walletchip">
      <span id="livedot" class="livedot" title="Live"></span>
      <div class="deck-stat"><span class="k">Devnet SOL</span><span class="v">${devnetBal==null?'–':fmt(devnetBal,3)}</span></div>
      <div class="deck-stat"><span class="k">Practice SOL</span><span class="v">${fmt(S.cash,3)}</span></div>
      <div class="deck-stat"><span class="k">Total PnL</span><span class="v" style="color:${col}">${P.total>=0?'+':''}${fmt(P.total,3)}</span></div>
      <a class="navlink ${page.name==='list'?'on':''}" href="#/">Tokens</a>
      <a class="navlink ${page.name==='portfolio'?'on':''}" href="#/portfolio">Portfolio</a>
      <button class="btn-brand" id="airdropbtn" onclick="airdrop()">Claim 1 devnet SOL</button>
    </div>`;
}
function chgCell(v){ if(v==null||isNaN(v)) return '<span class="chg">–</span>';
  return `<span class="chg ${v>=0?'pos-chg':'neg-chg'}">${v>=0?'+':''}${fmt(v,1)}%</span>`; }

/* ---------------- page: LIST ---------------- */
function renderListPage(){
  $('#app').innerHTML = `
    <section class="panel wide">
      <div class="panel-h" style="gap:.35rem;flex-wrap:wrap">
        <button id="tab-new" class="tabb" onclick="switchTab('new')">NEW</button>
        <button id="tab-grad" class="tabb" onclick="switchTab('grad')">GRADUATING</button>
        <button id="tab-done" class="tabb" onclick="switchTab('done')">GRADUATED</button>
        <button id="tab-hot" class="tabb" onclick="switchTab('hot')">HOT</button>
        <div style="flex:1"></div>
        <input id="q" style="max-width:280px" placeholder="Name, symbol, or mint address" onkeydown="if(event.key==='Enter')doSearch()">
        <button class="btn-ghost" onclick="doSearch()">Go</button>
      </div>
      <div class="panel-b" style="padding:0"><div id="toklist"></div></div>
    </section>`;
  setTabs(); renderList();
  if(!tokens.length) pollFeed();
}
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
    <div class="tok ${t._new && Date.now()-t._new<20000 ? 'newrow':''}" onclick="location.hash='#/t/${t.mint}'">
      ${t.img?`<img src="${esc(t.img)}" alt="" onerror="this.style.visibility='hidden'">`:`<div class="noimg"></div>`}
      <div class="tokmid">
        <div class="symrow"><span class="sym">${esc(t.symbol)}</span>${t.created?`<span class="age" data-age="${esc(t.created)}">${age(t.created)}</span>`:''}</div>
        ${rowExtra(t)}
      </div>
      <div class="tokright">
        <div class="px" data-px="${t.mint}" data-mode="${t.mc?'mc':'px'}">${t.mc?money(t.mc)+' MC':'$'+fmt(t.priceUsd)}</div>
        ${chgCell(t.chg1!=null?t.chg1:t.chg24)}
      </div>
      <button class="quick" title="Quick buy 0.1 SOL" onclick="event.stopPropagation();quickBuy('${t.mint}')">⚡.1</button>
    </div>`).join('') || '<div class="skel">Loading feed…</div>';
  el.parentElement.scrollTop = st;
}
function setTabs(){ ['new','grad','done','hot'].forEach(t=>$('#tab-'+t)?.classList.toggle('on', tab===t)); }
function switchTab(t){ tab=t; setTabs(); tokens=[]; renderList(); pollFeed(); }
async function doSearch(){
  const q=$('#q').value.trim(); if(!q) return;
  tab='search'; setTabs();
  try{
    tokens = remember(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q) ? await fetchMints([q]) : await fetchSearch(q));
    renderList();
  }catch(e){ toast('Search failed: '+esc(e.message),'err'); }
}

/* ---------------- page: TOKEN ---------------- */
async function renderTokenPage(mint){
  let t = known[mint];
  $('#app').innerHTML = `<section class="panel wide" id="tpanel"><div class="skel">Loading token…</div></section>`;
  if(!t){
    try{ const f=remember(await fetchMints([mint])); t=f[0]; }catch(e){}
  }
  if(!t){ $('#tpanel').innerHTML='<div class="skel">Token not found. <a href="#/" style="color:var(--brand2)">Back to feed</a></div>'; return; }
  $('#tpanel').innerHTML = `
    <div id="tokhead">
      <a class="backbtn" href="#/">←</a>
      ${t.img?`<img src="${esc(t.img)}" alt="" onerror="this.style.display='none'">`:''}
      <div><div class="t-name">${esc(t.symbol)}</div><div class="t-sub">${esc(t.name)} · <span class="mono">${mint.slice(0,4)}…${mint.slice(-4)}</span> · <span class="mono">${esc(t.dex||'')}</span></div></div>
      <div class="statgrid" id="tokstats"></div>
    </div>
    <div id="centergrid">
      <div id="chartwrap"><iframe title="Live chart" src="https://dexscreener.com/solana/${t.pair}?embed=1&theme=dark&info=0&trades=0" loading="lazy"></iframe></div>
      <div id="tradecol"></div>
    </div>`;
  renderTokenStats(); renderTradeCol();
  pollPrices();
}
function renderTokenStats(){
  const el=$('#tokstats'); if(!el || page.name!=='token') return;
  const t = known[page.mint]; if(!t) return;
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
  const el=$('#tradecol'); if(!el || page.name!=='token') return;
  const t = known[page.mint]; if(!t) return;
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
        <button onclick="$('#buyamt').value=(Math.max(S.cash-0.001,0)).toFixed(3)">MAX</button>
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

/* ---------------- page: PORTFOLIO ---------------- */
function renderPortfolioPage(){
  $('#app').innerHTML = `
    <section class="panel wide">
      <div class="panel-h"><a class="backbtn" href="#/">←</a><h3>Portfolio & Wallet</h3>
        <button class="btn-ghost" style="margin-left:auto;font-size:.68rem;padding:.3rem .6rem" onclick="if(confirm('Reset practice account? Your wallet address stays the same, only trades and balances clear.')){S.cash=0;S.positions={};S.history=[];S.realized=0;save();renderPortfolioBody();renderDeck();}">Reset trades</button>
      </div>
      <div class="panel-b" id="pbody"></div>
    </section>`;
  renderPortfolioBody();
}
function renderPortfolioBody(){
  const el=$('#pbody'); if(!el) return;
  const P=pnlTotals();
  const rows = Object.entries(S.positions).map(([m,p])=>{
    const val=p.qty*(p.priceSol||0), u=val-p.cost, c=u>=0?'pos-chg':'neg-chg';
    return `<tr><td style="cursor:pointer" onclick="location.hash='#/t/${m}'">${esc(p.symbol)}</td>
      <td>${fmt(p.qty)}</td><td>${fmt(val,3)}</td><td class="${c}">${u>=0?'+':''}${fmt(u,3)}</td>
      <td><button class="btn-ghost" style="font-size:.66rem;padding:.2rem .5rem" onclick="sellPct('${m}',1)">Close</button></td></tr>`;
  }).join('');
  el.innerHTML = `
    <div class="pgrid">
      <div>
        <h3 class="ph">WALLET · one address, keep it</h3>
        <div class="cashrow"><span>Address</span><span class="v" style="cursor:pointer" title="Copy" onclick="navigator.clipboard.writeText('${S.wallet.address}').then(()=>toast('Address copied.','ok'))">${S.wallet.address.slice(0,8)}…${S.wallet.address.slice(-8)} ⧉</span></div>
        <div class="cashrow"><span>Devnet balance</span><span class="v">${devnetBal==null?'–':fmt(devnetBal,4)+' SOL'}</span></div>
        <div style="display:flex;gap:.5rem;margin:.7rem 0 1.4rem">
          <button class="btn-ghost" onclick="exportKey()">Export secret key</button>
          <button class="btn-ghost" onclick="importKey()">Import wallet</button>
        </div>
        <h3 class="ph">BALANCES</h3>
        <div class="cashrow"><span>Practice cash</span><span class="v">${fmt(S.cash,4)} SOL</span></div>
        <div class="cashrow"><span>Unrealized PnL</span><span class="v" style="color:${P.unreal>=0?'var(--up)':'var(--down)'}">${P.unreal>=0?'+':''}${fmt(P.unreal,4)} SOL</span></div>
        <div class="cashrow"><span>Realized PnL</span><span class="v" style="color:${S.realized>=0?'var(--up)':'var(--down)'}">${S.realized>=0?'+':''}${fmt(S.realized,4)} SOL</span></div>
      </div>
      <div>
        <h3 class="ph">OPEN POSITIONS</h3>
        <table class="postbl">
          <tr><th>Token</th><th>Qty</th><th>Val (SOL)</th><th>PnL</th><th></th></tr>
          ${rows || '<tr><td colspan="5" style="color:var(--muted);font-family:Space Grotesk">No open positions.</td></tr>'}
        </table>
        <h3 class="ph" style="margin-top:1.2rem">HISTORY</h3>
        ${S.history.slice(0,40).map(h=>`<div class="hist"><span class="${h.side==='BUY'?'b':'s'}">${h.side}</span> <b style="cursor:pointer" onclick="location.hash='#/t/${h.mint||''}'">${esc(h.sym)}</b> · ${fmt(h.qty)} · ${fmt(h.sol,3)} SOL · ${new Date(h.t).toLocaleTimeString()}</div>`).join('') || '<div class="hist">No trades yet.</div>'}
      </div>
    </div>`;
}

/* ---------------- onboarding + router ---------------- */
function renderOnboard(){
  $('#app').innerHTML = `
    <div id="onboard"><div class="ob-card">
      <h1>Practice like it's <b>real.</b></h1>
      <p>Trade live Solana memecoins with devnet SOL. Real market data, real wallet, zero real money. Blow up here so you don't blow up on mainnet.</p>
      <div class="ob-steps">
        <div><b>01</b> Generate your practice wallet — one address, yours to keep</div>
        <div><b>02</b> Claim free devnet SOL from the faucet</div>
        <div><b>03</b> Trade new, graduating, and graduated pump.fun tokens live</div>
      </div>
      <button class="btn-brand" style="padding:.8rem 1.6rem;font-size:1rem" onclick="makeWallet();route();refreshBalance();toast('Wallet created and saved to this browser. Export the key from the Portfolio page to back it up. Never send real SOL to it.','ok')">Generate practice wallet</button>
      <p style="font-size:.75rem;margin-top:1rem">Already have a DryRun key? <a href="javascript:importKey()" style="color:var(--brand2)">Import wallet</a></p>
    </div></div>`;
}
function route(){
  const h = location.hash || '#/';
  if(!S.wallet){ page={name:'onboard'}; renderOnboard(); renderDeck(); return; }
  if(h.startsWith('#/t/')){ page={name:'token', mint:h.slice(4)}; renderTokenPage(page.mint); }
  else if(h.startsWith('#/portfolio')){ page={name:'portfolio'}; renderPortfolioPage(); }
  else { page={name:'list'}; renderListPage(); }
  renderDeck();
}
window.addEventListener('hashchange', route);

/* ---------------- boot ---------------- */
(async function(){
  await load();
  route();
  refreshBalance();
  pollFeed();
  setInterval(pollFeed, 10000);     // feed: new tokens appear
  setInterval(pollPrices, 3000);    // prices: flash on change
  setInterval(localTick, 1000);     // ages + live indicator
  setInterval(refreshBalance, 30000);
})();
