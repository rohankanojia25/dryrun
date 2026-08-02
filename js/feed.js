/* DryRun · feed.js — index.html · three-column Pulse (New Pairs | Final Stretch | Migrated)
   Streams from PumpPortal websocket, seeded and backfilled by GeckoTerminal/DexScreener. */

let cols = { new:[], grad:[], done:[] };
const CAP = { new:40, grad:30, done:30 };
const NEW_MIN_MC = 5000;     // New Pairs: only mints that trade above this market cap
const GRAD_MIN = 0.40;       // Final Stretch: >= 40% along the bonding curve
const MIG_MIN_MC = 5000;     // Migrated: minimum believable market cap
let searching = false;
let priceBusy = false;
let pending = new Map();     // fresh mints below the floor, watched until they cross it
const MIG_KEY = 'dryrun:migrated';
const MIG_TTL = 48*3600*1000;   // remember migrations for 2 days

function saveMigrated(){
  try{
    const slim = cols.done.slice(0,CAP.done).map(t=>({
      mint:t.mint, symbol:t.symbol, name:t.name, img:t.img, pair:t.pair, dex:t.dex,
      mc:t.mc, priceUsd:t.priceUsd, priceSol:t.priceSol, chg1:t.chg1, chg24:t.chg24,
      created:t.created, seen:t.seen||Date.now(), src:t.src
    }));
    localStorage.setItem(MIG_KEY, JSON.stringify(slim));
  }catch(e){}
}
function loadMigrated(){
  try{
    const raw = localStorage.getItem(MIG_KEY); if(!raw) return [];
    return JSON.parse(raw).filter(t=>Date.now()-(t.seen||0) < MIG_TTL);
  }catch(e){ return []; }
}

/* ---------------- rows ---------------- */
function openToken(mint){
  const t = known[mint]||{};
  location.href = 'token.html?mint='+encodeURIComponent(mint)
    +'&pair='+encodeURIComponent(t.pair||'')
    +'&sym='+encodeURIComponent(t.symbol||'');
}
function rowHTML(t){
  const isNew = t._new && Date.now()-t._new<15000;
  const prog = t.progress!=null
    ? `<div class="prog"><div class="prog-fill" data-prog="${t.mint}" style="width:${Math.round(t.progress*100)}%"></div></div><div class="nm"><span data-progtxt="${t.mint}">${Math.round(t.progress*100)}%</span> to graduation · est.</div>`
    : `<div class="nm">${esc(t.name||'')}</div>`;
  return `
    <div class="tok ${isNew?'newrow':''}" onclick="openToken('${t.mint}')">
      <img data-img="${t.mint}" src="${esc(t.img||'')}" alt="" style="${t.img?'':'visibility:hidden'}" onerror="this.style.visibility='hidden'">
      <div class="tokmid">
        <div class="symrow"><span class="sym">${esc(t.symbol||'?')}</span>${t.created?`<span class="age" data-age="${esc(t.created)}">${age(t.created)}</span>`:''}</div>
        ${prog}
      </div>
      <div class="tokright">
        <div class="px" data-px="${t.mint}" data-mode="mc">${t.mc?money(t.mc)+' MC':(t.priceUsd?'$'+fmt(t.priceUsd):'—')}</div>
        <span data-chg="${t.mint}">${chgCell(t.chg1!=null?t.chg1:t.chg24)}</span>
      </div>
      <button class="quick" title="Quick buy 0.1 SOL" onclick="event.stopPropagation();quickBuy('${t.mint}')">⚡.1</button>
    </div>`;
}
function renderCol(key){
  const el=$('#col-'+key); if(!el) return;
  const st = el.scrollTop;
  el.innerHTML = cols[key].map(rowHTML).join('') || '<div class="skel">Waiting for the chain…</div>';
  el.scrollTop = st;
  const c=$('#count-'+key); if(c) c.textContent = cols[key].length;
}
function pushCol(key, t){
  cols[key] = [t, ...cols[key].filter(x=>x.mint!==t.mint)].slice(0, CAP[key]);
  renderCol(key);
}

/* ---------------- live stream handlers ---------------- */
function onCreate(d){
  const t = ppApply(d); if(!t) return;
  t.created = t.created || new Date().toISOString();
  ppImage(t, d.uri);
  wsSubTrades([t.mint]);                 // watch every mint for its first real bids
  if(t.mc >= NEW_MIN_MC){ t._new = Date.now(); pushCol('new', t); return; }
  pending.set(t.mint, t);
  if(pending.size > 400){                // keep the watchlist bounded
    const oldest = [...pending.keys()].slice(0, pending.size - 400);
    oldest.forEach(k=>pending.delete(k));
  }
}
function onMigrate(d){
  const t = ppApply(d) || known[d.mint]; if(!t) return;
  t._new = Date.now();
  t.created = new Date().toISOString();
  t.progress = null; t.dex = 'pumpswap';
  if(t.mc && t.mc < MIG_MIN_MC) t.mc = null;   // don't display drained-curve junk
  t.seen = Date.now();
  pushCol('done', t); saveMigrated();
  cols.grad = cols.grad.filter(x=>x.mint!==t.mint); renderCol('grad');
  cols.new  = cols.new.filter(x=>x.mint!==t.mint);  renderCol('new');
  const verify = async()=>{ try{ const f=remember(await fetchMints([t.mint])); if(f[0]&&f[0].mc>=MIG_MIN_MC){ Object.assign(t,f[0]); renderCol('done'); } }catch(e){} };
  setTimeout(verify, 6000); setTimeout(verify, 20000);
}
function onTradeTick(d){
  const t = ppApply(d); if(!t) return;
  const map={}; map[t.mint]=t;
  flashCells(map);
  const pt=document.querySelector('[data-progtxt="'+t.mint+'"]');
  if(pt && t.progress!=null) pt.textContent = Math.round(t.progress*100)+'%';
  // crossed the New Pairs floor: it just earned a slot
  if(pending.has(t.mint) && t.mc >= NEW_MIN_MC){
    pending.delete(t.mint);
    t._new = Date.now();
    pushCol('new', t);
  }
  // live promotion: crossed the graduation-run threshold -> Final Stretch
  if(t.progress!=null && t.progress>=GRAD_MIN && !cols.grad.find(x=>x.mint===t.mint)){
    t._new = Date.now();
    cols.new = cols.new.filter(x=>x.mint!==t.mint); renderCol('new');
    cols.grad = [t, ...cols.grad.filter(x=>x.mint!==t.mint)]
                  .sort((a,b)=>(b.progress||0)-(a.progress||0)).slice(0,CAP.grad);
    renderCol('grad');
  }
  if(S.positions[t.mint]){ S.positions[t.mint].priceSol=t.priceSol; S.positions[t.mint].priceUsd=t.priceUsd; renderDeck(); }
}

/* ---------------- seeding + backfill ---------------- */
async function seed(){
  const cached = remember(loadMigrated());
  if(cached.length){ cols.done = cached.slice(0,CAP.done); renderCol('done'); }
  await ensureSolUsd();
  const jobs = [
    loadNew().then(r=>{
      if(!cols.new.length){
        cols.new = r.filter(t=>t.mc >= NEW_MIN_MC).slice(0,CAP.new);
        renderCol('new');
      }
    }).catch(()=>{}),
    loadGraduating().then(r=>{
      cols.grad = r.filter(t=>t.progress>=GRAD_MIN)
                   .sort((a,b)=>(b.progress||0)-(a.progress||0))
                   .slice(0,CAP.grad);
      renderCol('grad');
    }).catch(()=>{}),
    loadGraduated().then(async r=>{
      const needFix = r.filter(t=>!t.mc || t.mc<MIG_MIN_MC).map(t=>t.mint);
      if(needFix.length){
        try{
          const fixed = remember(await fetchMints(needFix));
          const fm={}; fixed.forEach(t=>fm[t.mint]=t);
          r = r.map(t=>fm[t.mint]?Object.assign(t,fm[t.mint]):t);
        }catch(e){}
      }
      const fresh = r.filter(t=>t.mc>=MIG_MIN_MC);
      const merged = [], seen = {};
      [...fresh, ...remember(loadMigrated())].forEach(t=>{
        if(seen[t.mint]) return;
        seen[t.mint]=1; t.seen = t.seen||Date.now(); merged.push(t);
      });
      cols.done = merged.sort((a,b)=>new Date(b.created)-new Date(a.created)).slice(0,CAP.done);
      renderCol('done'); saveMigrated();
      wsSubTrades(cols.done.map(t=>t.mint));
    }).catch(()=>{})
  ];
  await Promise.all(jobs);
  remember([...cols.new,...cols.grad,...cols.done]);
  wsSubTrades([...cols.new,...cols.grad,...cols.done].map(t=>t.mint), onTradeTick);
}
async function backfill(){
  try{
    const r = remember(await loadGraduating()).filter(t=>t.progress>=GRAD_MIN);
    const fresh = {}; r.forEach(t=>fresh[t.mint]=t);
    // update rows we already show (no flicker), keep them if they briefly drop out
    cols.grad.forEach(t=>{ if(fresh[t.mint]) mergeToken(t, fresh[t.mint]); });
    const have = new Set(cols.grad.map(t=>t.mint));
    const added = r.filter(t=>!have.has(t.mint));
    cols.grad = [...cols.grad, ...added]
      .sort((a,b)=>(b.progress||0)-(a.progress||0))
      .slice(0, CAP.grad);
    renderCol('grad'); wsSubTrades(cols.grad.map(t=>t.mint));
  }catch(e){}
}
async function pollPrices(){
  if(priceBusy) return; priceBusy=true;
  try{
    const need = new Set(Object.keys(S.positions));
    cols.done.forEach(t=>need.add(t.mint));   // migrated pools only; curve tokens come from GT/stream
    if(need.size){
      const fresh = remember(await fetchMints([...need].slice(0,30)));
      const map={}; fresh.forEach(t=>map[t.mint]=t);
      for(const m in S.positions){ if(map[m]){ S.positions[m].priceSol=map[m].priceSol; S.positions[m].priceUsd=map[m].priceUsd; } }
      cols.done.forEach(t=>{ if(map[t.mint]) mergeToken(t, map[t.mint]); });
      flashCells(map);
      renderCol('done'); saveMigrated();
      renderDeck();
    }
  }catch(e){}
  priceBusy=false;
}

/* ---------------- search overlay ---------------- */
async function doSearch(){
  const q=$('#q').value.trim(); if(!q) return;
  searching=true;
  $('#pulse').style.display='none';
  $('#searchres').style.display='block';
  $('#searchlist').innerHTML='<div class="skel">Searching…</div>';
  try{
    const res = remember(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(q) ? await fetchMints([q]) : await fetchSearch(q));
    $('#searchlist').innerHTML = res.map(rowHTML).join('') || '<div class="skel">No results.</div>';
  }catch(e){ $('#searchlist').innerHTML='<div class="skel">Search failed: '+esc(e.message)+'</div>'; }
}
function closeSearch(){ searching=false; $('#searchres').style.display='none'; $('#pulse').style.display='grid'; $('#q').value=''; }
function onTrade(){ /* deck handled in core */ }

/* ---------------- shell ---------------- */
function renderOnboard(){
  $('#feedwrap').innerHTML = `
    <div id="onboard"><div class="ob-card">
      <h1>Practice like it's <b>real.</b></h1>
      <p>Trade live Solana memecoins with devnet SOL. Real market data streaming straight from pump.fun, real wallet, zero real money.</p>
      <div class="ob-steps">
        <div><b>01</b> Generate your practice wallet — one address, yours to keep</div>
        <div><b>02</b> Claim free devnet SOL from the faucet</div>
        <div><b>03</b> Watch new pairs stream in live and trade them with simulated fills</div>
      </div>
      <button class="btn-brand" style="padding:.8rem 1.6rem;font-size:1rem" onclick="makeWallet();boot();toast('Wallet created and saved to this browser. Export the key from the Portfolio page to back it up. Never send real SOL to it.','ok')">Generate practice wallet</button>
      <p style="font-size:.75rem;margin-top:1rem">Already have a DryRun key? <a href="javascript:importKey()" style="color:var(--brand2)">Import wallet</a></p>
    </div></div>`;
}
function renderPulseShell(){
  $('#feedwrap').innerHTML = `
    <div class="pulsebar">
      <h2 style="font-size:1rem;margin:0">Pulse</h2>
      <div style="flex:1"></div>
      <input id="q" style="max-width:300px" placeholder="Name, symbol, or mint address" onkeydown="if(event.key==='Enter')doSearch()">
      <button class="btn-ghost" onclick="doSearch()">Go</button>
    </div>
    <div id="searchres" style="display:none">
      <section class="panel wide">
        <div class="panel-h"><h3>Search results</h3><button class="btn-ghost" style="margin-left:auto;font-size:.7rem;padding:.3rem .6rem" onclick="closeSearch()">← Back to Pulse</button></div>
        <div class="panel-b" style="padding:0"><div id="searchlist"></div></div>
      </section>
    </div>
    <div class="pulse" id="pulse">
      <section class="panel pulse-col">
        <div class="panel-h"><h3>New Pairs</h3><span class="colcount" id="count-new">0</span><span class="livedot" style="margin-left:auto"></span></div>
        <div class="panel-b colbody" id="col-new"><div class="skel">Connecting to pump.fun stream…</div></div>
      </section>
      <section class="panel pulse-col">
        <div class="panel-h"><h3>Final Stretch</h3><span class="colcount" id="count-grad">0</span></div>
        <div class="panel-b colbody" id="col-grad"><div class="skel">Loading…</div></div>
      </section>
      <section class="panel pulse-col">
        <div class="panel-h"><h3>Migrated</h3><span class="colcount" id="count-done">0</span><span class="livedot" style="margin-left:auto"></span></div>
        <div class="panel-b colbody" id="col-done"><div class="skel">Loading…</div></div>
      </section>
    </div>`;
}
function boot(){
  if(!S.wallet){ renderOnboard(); renderDeck(); return; }
  renderPulseShell(); renderDeck();
  refreshBalance();
  wsConnect();
  wsSubNew(onCreate);
  wsSubMig(onMigrate);
  wsOn.trade = onTradeTick;
  seed();
}
(async function(){
  await loadState();
  boot();
  setInterval(backfill, 45000);
  setInterval(pollPrices, 5000);
  setInterval(localTick, 1000);
  setInterval(refreshBalance, 30000);
})();
