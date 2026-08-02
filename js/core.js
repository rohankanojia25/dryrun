/* ================================================================
   DryRun · core.js (shared by all pages)
   index.html      token feed (new / graduating / graduated / hot)
   token.html      trade page  (?mint=...&pair=...)
   portfolio.html  wallet, positions, history
   ================================================================ */

const RPC = 'https://api.devnet.solana.com';
const DS  = 'https://api.dexscreener.com';
const GT  = 'https://api.geckoterminal.com/api/v2';
const KEY = 'dryrun:v1';
const FEE = 0.01;
const NETFEE = 0.0005;
const GRAD_MC = 69000;

let S = { wallet:null, flow:0, lastBal:null, positions:{}, history:[], realized:0 };
let known = {};
let solUsd = 0;
let devnetBal = null;
let lastTick = Date.now();
let lastPrice = {};
let lastMc = {};

/* Trading balance = on-chain devnet SOL + cumulative trade flow (sells - buys).
   The airdrop raises it automatically via the on-chain balance. No separate ledger. */
function cash(){
  const base = devnetBal!=null ? devnetBal : (S.lastBal!=null ? S.lastBal : 0);
  return Math.max(base + (S.flow||0), 0);
}

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
function chgCell(v){ if(v==null||isNaN(v)) return '<span class="chg">–</span>';
  return `<span class="chg ${v>=0?'pos-chg':'neg-chg'}">${v>=0?'+':''}${fmt(v,1)}%</span>`; }

/* ---------------- persistence ---------------- */
async function save(){
  const raw = JSON.stringify(S);
  try{ if(window.storage){ await window.storage.set(KEY, raw); } }catch(e){}
  try{ localStorage.setItem(KEY, raw); }catch(e){}
}
async function loadState(){
  let raw=null;
  try{ if(window.storage){ const r=await window.storage.get(KEY); raw=r&&r.value; } }catch(e){}
  if(!raw){ try{ raw=localStorage.getItem(KEY); }catch(e){} }
  if(raw){ try{
    S = Object.assign(S, JSON.parse(raw));
    if(typeof S.flow!=='number') S.flow = 0;   // migrate from old cash-ledger versions
  }catch(e){} }
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
    if(S.lastBal!==devnetBal){ S.lastBal = devnetBal; save(); }
    $('#netdot')?.classList.add('on');
  }catch(e){ $('#netdot')?.classList.remove('on'); }
  renderDeck();
}
function makeWallet(){
  const kp = nacl.sign.keyPair();
  S.wallet = { address: b58(kp.publicKey), secret: Array.from(kp.secretKey) };
  S.flow = 0; S.lastBal = null; S.positions={}; S.history=[]; S.realized=0;
  save();
}
function exportKey(){
  if(!S.wallet) return;
  const k = b58(Uint8Array.from(S.wallet.secret));
  navigator.clipboard.writeText(k).then(()=>toast('<b>Secret key copied.</b> Store it safely. Paste it on any device to restore this wallet. Practice wallet only — never fund it with real SOL.','ok'));
}
function importKey(){
  const k = prompt('Paste your DryRun secret key (base58). This restores that wallet on this device.');
  if(!k) return;
  try{
    const sk = b58d(k.trim());
    if(sk.length!==64) throw new Error('Key must decode to 64 bytes');
    const kp = nacl.sign.keyPair.fromSecretKey(sk);
    S.wallet = { address: b58(kp.publicKey), secret: Array.from(sk) };
    save(); refreshBalance();
    toast('<b>Wallet restored:</b> '+S.wallet.address.slice(0,4)+'…'+S.wallet.address.slice(-4),'ok');
    setTimeout(()=>location.href='index.html', 900);
  }catch(e){ toast('<b>Import failed:</b> '+esc(e.message),'err'); }
}
async function airdrop(){
  const btn=$('#airdropbtn'); if(btn){btn.disabled=true;btn.textContent='Requesting…';}
  try{
    await rpc('requestAirdrop',[S.wallet.address, 1e9]);
    toast('<b>1 devnet SOL claimed.</b> Your trading balance rises as soon as it confirms on-chain (a few seconds).','ok');
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
    let mc = +a.market_cap_usd || +a.fdv_usd || 0;
    if(mc < 1000) mc = 0;   // junk / still-syncing values
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

/* ---------------- flash helpers ---------------- */
function flashOne(el, up){
  el.classList.remove('fl-up','fl-down');
  void el.offsetWidth;
  el.classList.add(up?'fl-up':'fl-down');
}
function flashCells(map){
  for(const m in map){
    const t = map[m];
    const prevP = lastPrice[m], prevM = lastMc[m];
    const pxUp = prevP!=null && t.priceUsd!==prevP ? t.priceUsd>prevP : null;
    const mcUp = prevM!=null && t.mc && t.mc!==prevM ? t.mc>prevM : null;
    document.querySelectorAll('[data-px="'+m+'"]').forEach(el=>{
      const isMc = el.dataset.mode==='mc';
      const moved = isMc ? (mcUp!=null?mcUp:pxUp) : pxUp;
      if(moved!=null) flashOne(el, moved);
      el.textContent = isMc && t.mc ? money(t.mc)+' MC' : '$'+fmt(t.priceUsd);
    });
    document.querySelectorAll('[data-chg="'+m+'"]').forEach(el=>{
      const v = t.chg1!=null?t.chg1:t.chg24;
      if(v!=null && !isNaN(v)){
        el.className = 'chg '+(v>=0?'pos-chg':'neg-chg');
        el.textContent = (v>=0?'+':'')+fmt(v,1)+'%';
      }
    });
    document.querySelectorAll('[data-prog="'+m+'"]').forEach(el=>{
      if(t.progress!=null) el.style.width = Math.round(t.progress*100)+'%';
    });
    lastPrice[m]=t.priceUsd; if(t.mc) lastMc[m]=t.mc;
  }
}
function localTick(){
  document.querySelectorAll('[data-age]').forEach(el=>{ el.textContent = age(el.dataset.age); });
  const el=$('#livedot');
  if(el){ const s=(Date.now()-lastTick)/1000; el.classList.toggle('stale', s>15); el.title='Last update '+(s|0)+'s ago'; }
}

/* ---------------- trading ---------------- */
function pnlTotals(){
  let u=0; for(const m in S.positions){ const p=S.positions[m]; u += p.qty*(p.priceSol||0) - p.cost; }
  return {unreal:u, total:u+S.realized};
}
function buyToken(t, amt){
  amt = +amt;
  if(!t) return;
  if(!(amt>0)) return toast('Enter a SOL amount to buy.','err');
  if(amt+NETFEE > cash()) return toast('Not enough SOL. Balance = your devnet SOL + trade PnL. Claim an airdrop first.','err');
  if(!(t.priceSol>0)) return toast('No live price for '+esc(t.symbol)+' right now.','err');
  const qty = amt*(1-FEE)/t.priceSol;
  S.flow -= (amt+NETFEE);
  const p = S.positions[t.mint] || {symbol:t.symbol,name:t.name,img:t.img,qty:0,cost:0,priceSol:t.priceSol,priceUsd:t.priceUsd,pair:t.pair};
  p.qty += qty; p.cost += amt+NETFEE; p.priceSol=t.priceSol; p.priceUsd=t.priceUsd;
  S.positions[t.mint]=p;
  S.history.unshift({t:Date.now(),side:'BUY',sym:t.symbol,mint:t.mint,qty,sol:amt});
  save(); renderDeck();
  if(typeof onTrade==='function') onTrade();
  toast('<b class="mono">BUY</b> '+fmt(qty)+' '+esc(t.symbol)+' for '+fmt(amt,4)+' SOL','ok');
}
function quickBuy(mint){ const t=known[mint]; if(t) buyToken(t, 0.1); }
function sellPct(mint, pct){
  const t = known[mint];
  const p = S.positions[mint];
  if(!p || !(p.qty>0)) return toast('No position here.','err');
  const priceSol = (t&&t.priceSol) || p.priceSol;
  if(!(priceSol>0)) return toast('No live price right now.','err');
  const qty = p.qty * pct;
  const gross = qty*priceSol, fee = gross*FEE, proceeds = gross-fee-NETFEE;
  const costPart = p.cost*(qty/p.qty);
  S.realized += proceeds - costPart;
  S.flow += Math.max(proceeds,0);
  p.qty -= qty; p.cost -= costPart;
  if(p.qty < 1e-9) delete S.positions[mint];
  S.history.unshift({t:Date.now(),side:'SELL',sym:p.symbol,mint,qty,sol:proceeds});
  save(); renderDeck();
  if(typeof onTrade==='function') onTrade();
  toast('<b class="mono">SELL</b> '+fmt(qty)+' '+esc(p.symbol)+' → '+fmt(proceeds,4)+' SOL','ok');
}

/* ---------------- deck ---------------- */
function renderDeck(){
  const su=$('#solusd'); if(su) su.textContent = solUsd? '$'+fmt(solUsd,2) : '–';
  const z=$('#walletzone'); if(!z) return;
  if(!S.wallet){ z.innerHTML=''; return; }
  const P=pnlTotals();
  const col = P.total>=0?'var(--up)':'var(--down)';
  const here = location.pathname.split('/').pop() || 'index.html';
  z.innerHTML = `
    <div id="walletchip">
      <span id="livedot" class="livedot" title="Live"></span>
      <div class="deck-stat"><span class="k">Devnet SOL</span><span class="v">${devnetBal==null?'…':fmt(devnetBal,3)}</span></div>
      <div class="deck-stat"><span class="k">Buying power</span><span class="v">${fmt(cash(),3)}</span></div>
      <div class="deck-stat"><span class="k">Total PnL</span><span class="v" style="color:${col}">${P.total>=0?'+':''}${fmt(P.total,3)}</span></div>
      <a class="navlink ${here==='index.html'||here===''?'on':''}" href="index.html">Tokens</a>
      <a class="navlink ${here==='portfolio.html'?'on':''}" href="portfolio.html">Portfolio</a>
      <button class="btn-brand" id="airdropbtn" onclick="airdrop()">Claim 1 devnet SOL</button>
    </div>`;
}
function requireWallet(){
  if(!S.wallet){ location.href='index.html'; return false; }
  return true;
}

/* ================================================================
   Real-time engine · PumpPortal public websocket (no key)
   Streams: token creations, per-trade ticks, migrations
   ================================================================ */
let ws=null, wsWant={new:false,mig:false}, wsTradeKeys=new Set();
let wsOn={create:null,trade:null,migrate:null};
function wsSend(o){ try{ if(ws&&ws.readyState===1) ws.send(JSON.stringify(o)); }catch(e){} }
function wsConnect(){
  try{ ws = new WebSocket('wss://pumpportal.fun/api/data'); }catch(e){ return; }
  ws.onopen = ()=>{
    lastTick=Date.now();
    if(wsWant.new) wsSend({method:'subscribeNewToken'});
    if(wsWant.mig) wsSend({method:'subscribeMigration'});
    if(wsTradeKeys.size) wsSend({method:'subscribeTokenTrade', keys:[...wsTradeKeys]});
  };
  ws.onmessage = ev=>{
    let d; try{ d=JSON.parse(ev.data); }catch(e){ return; }
    if(!d || !d.txType) return;
    lastTick=Date.now();
    if(d.txType==='create'){ if(wsOn.create) wsOn.create(d); }
    else if(d.txType==='buy'||d.txType==='sell'){ if(wsOn.trade) wsOn.trade(d); }
    else if(/migrat/i.test(d.txType)){ if(wsOn.migrate) wsOn.migrate(d); }
  };
  ws.onclose = ()=>{ setTimeout(wsConnect, 3000); };
  ws.onerror = ()=>{ try{ ws.close(); }catch(e){} };
}
function wsSubNew(fn){ wsWant.new=true; wsOn.create=fn; wsSend({method:'subscribeNewToken'}); }
function wsSubMig(fn){ wsWant.mig=true; wsOn.migrate=fn; wsSend({method:'subscribeMigration'}); }
function wsSubTrades(mints, fn){
  if(fn) wsOn.trade=fn;
  const add=(mints||[]).filter(m=>m && !wsTradeKeys.has(m));
  add.forEach(m=>wsTradeKeys.add(m));
  if(add.length) wsSend({method:'subscribeTokenTrade', keys:add});
}
/* map a pumpportal message onto our token model */
function ppApply(d){
  const m=d.mint; if(!m) return null;
  const t = known[m] = known[m] || {mint:m, symbol:d.symbol||'?', name:d.name||'', img:'', pair:d.bondingCurveKey||'', dex:'pump-fun'};
  if(d.symbol) t.symbol=d.symbol;
  if(d.name) t.name=d.name;
  if(!t.pair && d.bondingCurveKey) t.pair=d.bondingCurveKey;
  const vS=+d.vSolInBondingCurve, vT=+d.vTokensInBondingCurve;
  if(vS>0 && vT>0) t.priceSol = vS/vT;
  const mcSol = +d.marketCapSol;
  if(mcSol > 1){   // ignore drained-curve dust that produced fake $0.03 caps
    t.mcSol = mcSol;
    if(solUsd){ t.mc = t.mcSol*solUsd; if(/pump/.test(t.dex)&&!/swap/.test(t.dex)) t.progress = Math.min(t.mc/GRAD_MC,1); }
  }
  if(t.priceSol && solUsd) t.priceUsd = t.priceSol*solUsd;
  return t;
}
/* lazy-load a new token's image from its metadata uri */
function ppImage(t, uri){
  if(!uri || t.img) return;
  fetch(uri.replace('ipfs://','https://ipfs.io/ipfs/')).then(r=>r.json()).then(j=>{
    if(j && j.image){
      t.img = j.image.replace('ipfs://','https://ipfs.io/ipfs/');
      document.querySelectorAll('img[data-img="'+t.mint+'"]').forEach(el=>{ el.src=t.img; el.style.visibility='visible'; });
    }
  }).catch(()=>{});
}
async function ensureSolUsd(){
  if(solUsd) return;
  try{
    const p = await (await fetch(DS+'/tokens/v1/solana/So11111111111111111111111111111111111111112')).json();
    const g = (p||[]).find(x=>+x.priceUsd>0);
    if(g) solUsd = +g.priceUsd;
  }catch(e){}
}
