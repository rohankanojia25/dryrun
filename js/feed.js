/* DryRun · feed.js — index.html logic */

let tokens = [];
let tab = 'new';
let feedBusy = false, priceBusy = false;
const LOADERS = { new:loadNew, grad:loadGraduating, done:loadGraduated, hot:loadHot };

function openToken(t){
  location.href = 'token.html?mint='+encodeURIComponent(t.mint)
    +'&pair='+encodeURIComponent(t.pair||'')
    +'&sym='+encodeURIComponent(t.symbol||'');
}
function rowExtra(t){
  if(t.progress!=null){
    const pc = Math.round(t.progress*100);
    return `<div class="prog"><div class="prog-fill" data-prog="${t.mint}" style="width:${pc}%"></div></div><div class="nm">${pc}% to graduation · est.</div>`;
  }
  return `<div class="nm">${esc(t.name)}</div>`;
}
function renderList(){
  const el=$('#toklist'); if(!el) return;
  const st = el.parentElement.scrollTop;
  el.innerHTML = tokens.map(t=>`
    <div class="tok ${t._new && Date.now()-t._new<20000 ? 'newrow':''}" onclick='openToken(${JSON.stringify({mint:t.mint,pair:t.pair,symbol:t.symbol}).replace(/'/g,"&#39;")})'>
      ${t.img?`<img src="${esc(t.img)}" alt="" onerror="this.style.visibility='hidden'">`:`<div class="noimg"></div>`}
      <div class="tokmid">
        <div class="symrow"><span class="sym">${esc(t.symbol)}</span>${t.created?`<span class="age" data-age="${esc(t.created)}">${age(t.created)}</span>`:''}</div>
        ${rowExtra(t)}
      </div>
      <div class="tokright">
        <div class="px" data-px="${t.mint}" data-mode="${t.mc?'mc':'px'}">${t.mc?money(t.mc)+' MC':'$'+fmt(t.priceUsd)}</div>
        <span data-chg="${t.mint}">${chgCell(t.chg1!=null?t.chg1:t.chg24)}</span>
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
async function pollFeed(){
  if(feedBusy || tab==='search') return;
  feedBusy = true;
  try{
    const fresh = remember(await LOADERS[tab]());
    if(fresh.length){
      const sameOrder = fresh.length===tokens.length && fresh.every((t,i)=>t.mint===tokens[i].mint);
      if(sameOrder){
        // in-place tick: update cells with flashes, no rebuild, no scroll jump
        const map={};
        fresh.forEach((t,i)=>{ tokens[i]=Object.assign(tokens[i],t); map[t.mint]=tokens[i]; });
        flashCells(map);
      }else{
        const existing = new Set(tokens.map(t=>t.mint));
        fresh.forEach(t=>{ if(existing.size && !existing.has(t.mint)) t._new = Date.now(); });
        tokens = fresh;
        renderList();
      }
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
    tokens.slice(0,25).forEach(t=>mints.add(t.mint));
    if(mints.size){
      const fresh = remember(await fetchMints([...mints]));
      const map={}; fresh.forEach(t=>map[t.mint]=t);
      tokens.forEach(t=>{ if(map[t.mint]){ t.priceUsd=map[t.mint].priceUsd; t.priceSol=map[t.mint].priceSol; t.mc=map[t.mint].mc||t.mc; } });
      for(const m in S.positions){ if(map[m]){ S.positions[m].priceSol=map[m].priceSol; S.positions[m].priceUsd=map[m].priceUsd; } }
      flashCells(map);
      renderDeck();
      lastTick = Date.now();
    }
  }catch(e){}
  priceBusy = false;
}
function onTrade(){ /* feed page: deck already re-rendered by core */ }

function renderOnboard(){
  $('#feedwrap').innerHTML = `
    <div id="onboard"><div class="ob-card">
      <h1>Practice like it's <b>real.</b></h1>
      <p>Trade live Solana memecoins with devnet SOL. Real market data, real wallet, zero real money. Blow up here so you don't blow up on mainnet.</p>
      <div class="ob-steps">
        <div><b>01</b> Generate your practice wallet — one address, yours to keep</div>
        <div><b>02</b> Claim free devnet SOL from the faucet</div>
        <div><b>03</b> Trade new, graduating, and graduated pump.fun tokens live</div>
      </div>
      <button class="btn-brand" style="padding:.8rem 1.6rem;font-size:1rem" onclick="makeWallet();boot();toast('Wallet created and saved to this browser. Export the key from the Portfolio page to back it up. Never send real SOL to it.','ok')">Generate practice wallet</button>
      <p style="font-size:.75rem;margin-top:1rem">Already have a DryRun key? <a href="javascript:importKey()" style="color:var(--brand2)">Import wallet</a></p>
    </div></div>`;
}
function renderFeedShell(){
  $('#feedwrap').innerHTML = `
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
}
function boot(){
  if(!S.wallet){ renderOnboard(); renderDeck(); return; }
  renderFeedShell(); renderDeck();
  refreshBalance(); pollFeed();
}
(async function(){
  await loadState();
  boot();
  setInterval(pollFeed, 6000);
  setInterval(pollPrices, 2000);
  setInterval(localTick, 1000);
  setInterval(refreshBalance, 30000);
})();
