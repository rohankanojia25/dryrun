/* DryRun · portfoliopage.js — portfolio.html logic */

let priceBusy = false;

function renderBody(){
  const el=$('#pbody'); if(!el) return;
  const P=pnlTotals();
  const rows = Object.entries(S.positions).map(([m,p])=>{
    const val=p.qty*(p.priceSol||0), u=val-p.cost, c=u>=0?'pos-chg':'neg-chg';
    return `<tr><td style="cursor:pointer" onclick="location.href='token.html?mint=${m}&pair=${encodeURIComponent(p.pair||'')}&sym=${encodeURIComponent(p.symbol||'')}'">${esc(p.symbol)}</td>
      <td>${fmt(p.qty)}</td><td>${fmt(val,3)}</td><td class="${c}" data-px="${m}" data-mode="pnl">${u>=0?'+':''}${fmt(u,3)}</td>
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
        <div class="cashrow"><span>Buying power</span><span class="v">${fmt(cash(),4)} SOL</span></div>
        <div class="cashrow"><span>Trade flow</span><span class="v" style="color:${(S.flow||0)>=0?'var(--up)':'var(--down)'}">${(S.flow||0)>=0?'+':''}${fmt(S.flow||0,4)} SOL</span></div>
        <div class="cashrow"><span>Unrealized PnL</span><span class="v" style="color:${P.unreal>=0?'var(--up)':'var(--down)'}">${P.unreal>=0?'+':''}${fmt(P.unreal,4)} SOL</span></div>
        <div class="cashrow"><span>Realized PnL</span><span class="v" style="color:${S.realized>=0?'var(--up)':'var(--down)'}">${S.realized>=0?'+':''}${fmt(S.realized,4)} SOL</span></div>
      </div>
      <div>
        <h3 class="ph">OPEN POSITIONS</h3>
        <table class="postbl">
          <tr><th>Token</th><th>Qty</th><th>Val (SOL)</th><th>PnL</th><th></th></tr>
          ${rows || '<tr><td colspan="5" style="color:var(--muted);font-family:Space Grotesk">No open positions. <a href="index.html" style="color:var(--brand2)">Find a token</a></td></tr>'}
        </table>
        <h3 class="ph" style="margin-top:1.2rem">HISTORY</h3>
        ${S.history.slice(0,40).map(h=>`<div class="hist"><span class="${h.side==='BUY'?'b':'s'}">${h.side}</span> <b>${esc(h.sym)}</b> · ${fmt(h.qty)} · ${fmt(h.sol,3)} SOL · ${new Date(h.t).toLocaleTimeString()}</div>`).join('') || '<div class="hist">No trades yet.</div>'}
      </div>
    </div>`;
}
async function pollPrices(){
  if(priceBusy) return;
  priceBusy = true;
  try{
    const mints = Object.keys(S.positions);
    if(mints.length){
      const fresh = remember(await fetchMints(mints));
      const map={}; fresh.forEach(t=>map[t.mint]=t);
      for(const m in S.positions){ if(map[m]){ S.positions[m].priceSol=map[m].priceSol; S.positions[m].priceUsd=map[m].priceUsd; } }
      renderBody(); renderDeck();
      lastTick = Date.now();
    }
  }catch(e){}
  priceBusy = false;
}
function onTrade(){ renderBody(); }

(async function(){
  await loadState();
  if(!requireWallet()) return;
  renderDeck(); renderBody();
  refreshBalance(); pollPrices();
  setInterval(pollPrices, 4000);
  setInterval(localTick, 1000);
  setInterval(refreshBalance, 30000);
})();
