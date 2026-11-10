'use strict';
function battleFxClear(keepIncome = false) {
  clearTimeout(ui.battleFxTimer); ui.battleFxTimer=0; ui.battleFxBusy=false;ui.battleFxState=null;
  document.querySelectorAll('.battle-projectile,.battle-action-toast,.battle-shockwave,.battle-piece-ghost').forEach(el=>el.remove());
  if (!keepIncome) battleIncomeClear();
}
function battleIncomeClear() {
  cancelAnimationFrame(ui.battleIncomeFrame); ui.battleIncomeFrame=0; ui.battleIncomeVisual=null;
  for(const id of ui.battleIncomeTimers||[])clearTimeout(id);ui.battleIncomeTimers=[];
  document.querySelectorAll('.battle-income,.battle-income-coin,.battle-income-cell,.battle-income-arrival').forEach(el=>el.remove());
  document.querySelectorAll('.battle-income-pulse').forEach(el=>el.classList.remove('battle-income-pulse'));
}
function battleDisplayedGold(color, st = ui.st) {
  const visual = ui.battleIncomeVisual;
  return visual && visual.state === ui.st && st?.strategy?.seq === ui.st?.strategy?.seq ? (visual.gold[color] ?? st.strategy.gold[color]) : (st?.strategy?.gold[color] || 0);
}
function battleIncomeBadge(color) {
  const candidates=[...document.querySelectorAll(`#strategyTreasury[data-side="${color}"],.strategy-phone-money[data-side="${color}"]`),$('#stratGoldBadge'+color.toUpperCase())].filter(Boolean);
  return candidates.find(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight;})||candidates[0];
}
function battlePaintIncomeGold() {
  const st=ui.st;if(!st?.strategy)return;
  for(const color of ['w','b']) {
    const amount=battleDisplayedGold(color,st);
    for(const el of document.querySelectorAll(`[data-battle-gold="${color}"]`))el.textContent=strategyMoney(amount);
    for(const badge of [$('#stratGoldBadge'+color.toUpperCase()),...document.querySelectorAll(`.strategy-phone-money[data-side="${color}"]`)])if(badge){badge.style.setProperty('--coins',100*amount/st.strategy.cap+'%');badge.style.setProperty('--money',100*amount/st.strategy.cap+'%');}
  }
}
function battleLockButton(button, reason) {
  if(!button)return;
  button.dataset.locked=button.disabled?'true':'false';
  const old=button.querySelector('.battle-lock');if(old)old.remove();
  if(button.disabled){const lock=document.createElement('span');lock.className='battle-lock';lock.textContent='🔒';lock.setAttribute('aria-hidden','true');button.prepend(lock);}
  if(reason)button.title=reason;
}
function battleRenderCountry(st,color,prefix) {
  const s=st.strategy,bar=$('#bar'+(prefix==='top'?'Top':'Bottom'));
  if(!s||!bar)return;
  bar.classList.add('battle-country');
  $('#'+prefix+'Name').textContent=s.factions[color];
  $('#'+prefix+'Role').textContent=(color===myColor()?'Ваше государство':'Противник')+' · штаб '+(st.board.find(p=>p?.c===color&&p.t==='k')?strategyPieceHp(st,st.board.find(p=>p?.c===color&&p.t==='k')):0)+' HP';
  $('#'+prefix+'Avatar').textContent=color==='w'?'🏛':'🏰';
  const badge=$('#stratGoldBadge'+(color==='w'?'W':'B'));
  if(badge){const displayed=battleDisplayedGold(color,st);if(badge.parentElement!==bar)bar.appendChild(badge);badge.style.setProperty('--coins',`${Math.min(100,100*displayed/s.cap)}%`);
    badge.setAttribute('aria-label',`Казна ${s.factions[color]}: ${strategyMoney(s.gold[color])} из ${s.cap}, доход ${strategyMoney(strategyRuleIncome(st,color))} за 4 действия`);
    badge.title=`Следующий сбор +${strategyMoney(strategyRuleIncome(st,color))} монет через ${4-s.seq%4} действия`;
    badge.innerHTML=`<span class="battle-coin">🪙</span><b><span data-battle-gold="${color}">${strategyMoney(displayed)}</span> <small>/ ${s.cap}</small></b><span class="battle-next-income">+${strategyMoney(strategyRuleIncome(st,color))} / 4 действия</span>`;
  }
}
function battleRenderTreasury(st) {
  const s=st.strategy,own=myColor()==='b'?'b':'w';
  let box=$('#strategyTreasury');
  if(!box){box=document.createElement('section');box.id='strategyTreasury';box.className='strategy-treasury';$('#stratInfoPanel').prepend(box);}
  box.dataset.side=own;
  box.innerHTML=`<div class="treasury-heading"><span>Моя казна</span><span class="treasury-side">${escapeHtml(s.factions[own])}</span></div><div class="treasury-amount"><i>🪙</i><strong data-battle-gold="${own}">${strategyMoney(battleDisplayedGold(own,st))}</strong><small>монет</small></div><div class="treasury-available">Доступно: <b>${strategyMoney(s.gold[own])}</b> · лимит ${s.cap}</div><div class="treasury-footer"><span>+${strategyMoney(strategyRuleIncome(st,own))} за сбор</span><span>через ${4-s.seq%4} действия</span></div><div class="treasury-cycle">${[0,1,2,3].map(i=>`<i class="${i<s.seq%4?'done':''}"></i>`).join('')}</div>`;
}
function battleRenderUi() {
  const st=ui.st;if(!st)return;
  const battle=!!(st.flags.strategy||st.flags.clashBrawl),shell=$('#gameShell');
  shell?.classList.toggle('battle-v85',battle);
  shell?.classList.toggle('battle-strategy',!!st.flags.strategy);
  shell?.classList.toggle('battle-brawl',!!st.flags.clashBrawl);
  for(const prefix of ['top','bottom'])$('#bar'+(prefix==='top'?'Top':'Bottom'))?.classList.toggle('battle-country',!!st.flags.strategy);
  if(!st.flags.strategy)$('#battleNuke')?.classList.add('hidden');
  else $('#battleNuke')?.classList.remove('hidden');
  if(!battle)return;
  for(const btn of shell.querySelectorAll('#strategyBar button,#stratInfoPanel button,#brawlPanel button'))battleLockButton(btn);
  if(st.flags.strategy){
    const s=st.strategy,bottom=barOrientation()==='w'?'w':'b';battleRenderCountry(st,other(bottom),'top');battleRenderCountry(st,bottom,'bottom');battleRenderTreasury(st);
    let nuke=$('#battleNuke');if(!nuke){nuke=document.createElement('button');nuke.type='button';nuke.id='battleNuke';nuke.className='battle-nuke-card';$('#strategyBar').appendChild(nuke);}
    const own=(ui.mode==='online'||ui.bot)?myColor():st.turn;
    let reason=s.nukeUsed[own]?'Запуск уже использован':s.round<STRAT_NUKE.round?`Откроется в раунде ${STRAT_NUKE.round} (сейчас ${s.round})`:s.gold[own]<STRAT_NUKE.cost?`Нужно ${STRAT_NUKE.cost} монет, есть ${s.gold[own]}`:s.phase!=='attack'?'Дождитесь фазы атаки':st.turn!==own?'Сейчас очередь противника':!strategyCanAct()?'Действие временно недоступно':'';
    nuke.disabled=!!reason;
    nuke.innerHTML=`<span class="battle-nuke-icon">☢</span><span><b>Ядерный удар · ${STRAT_NUKE.cost} 🪙</b><small>${reason||'Выбери цель → подтверди повторным нажатием'} · 1 запуск на сторону</small></span>`;
    nuke.onclick=()=>{const king=findKing(ui.st,ui.st.turn);if(king<0)return;ui.strategy.special='nuke';ui.strategy.previewTarget=null;strategySelectAttacker(king);toast('Ядерный удар: выбери цель. Удар заденет и своих.');};battleLockButton(nuke,reason||'Два нажатия на цель для подтверждения');
    let country=$('#battleCountryCard');if(!country){country=document.createElement('div');country.id='battleCountryCard';country.className='battle-country-card';$('#stratInfoPanel').prepend(country);}
    const levels=s.upgrades[own];country.innerHTML=`<span>${own==='w'?'🏛':'🏰'}</span><div><b>${escapeHtml(s.factions[own])}</b><small>Экономика ${levels.income}/5 · Арсенал ${levels.arsenal}/5 · Снабжение ${levels.logistics}/5</small></div>`;
    let legend=$('#battleObjectLegend');if(!legend){legend=document.createElement('details');legend.id='battleObjectLegend';legend.className='battle-object-legend';$('#stratInfoPanel').appendChild(legend);}
    legend.innerHTML='<summary>Доход территории и объектов</summary><p>Сбор обеим странам каждые 4 действия: полная клетка — 1 монета, 75% — 0,75, половина — по 0,5 обеим. Захват идёт четвертями. 🏭 Завод +4 · ⚓ Порт +4 · 🏙 Город +6 дополнительно за тот же сбор, пропорционально доле клетки.</p><p>Экономика 0→5: удваивается доход 1/10, 1/5, 1/4, 1/3, 1/2, 2/3 ваших доходных клеток (число округляется вниз). Улучшения стоят ×1,8 за каждый следующий уровень и списывают монеты.</p>';
    $('#stratSpecial').title='Выбери коня (мина), ладью (катапульта) или ферзя (ракета). Ядерка — отдельная карточка ниже.';
  }
}
function battleMobileLayout() {
  if(innerWidth>=1000||!ui.st||!(ui.st.flags.strategy||ui.st.flags.clashBrawl))return false;
  const stage=$('#stage'),wrap=$('#boardWrap'),shell=$('#gameShell');if(!stage||!wrap||!shell)return false;
  shell.classList.remove('v84-centered','v84-panel-below');shell.classList.add('battle-v85');
  stage.style.width='100%';stage.style.height='auto';stage.style.left='';stage.style.flex='none';
  const size=Math.max(16,Math.floor(Math.min(170,(shell.clientWidth-16)/ui.st.W)));
  ui.sq=size;wrap.style.width=size*ui.st.W+'px';wrap.style.height=size*ui.st.H+'px';wrap.style.padding='0';
  for(const id of ['barTop','barBottom'])$('#'+id).style.width=size*ui.st.W+'px';
  document.documentElement.style.setProperty('--sq',size+'px');
  $('#stratInfoPanel').style.height='auto';$('#stratInfoPanel').style.marginTop='0';$('#sidePanel').style.height='';
  return true;
}
function battleShowAction(text,color='w') {
  document.querySelectorAll('.battle-action-toast').forEach(el=>el.remove());
  const el=document.createElement('div');el.className='battle-action-toast '+color;el.textContent=text;
  const r=$('#board').getBoundingClientRect();el.style.left=Math.max(8,r.left+r.width/2)+'px';el.style.top=Math.max(10,r.top+r.height*.12)+'px';document.body.appendChild(el);setTimeout(()=>el.remove(),1800);
}
function battleIncomeRows(events) {
  const groups=new Map();
  for(const event of events||[]){
    if(event.type!=='income'||event.amount<=0)continue;
    const previous=groups.get(event.color);
    const cells=event.cells?.length?event.cells:[{sq:findKing(ui.st,event.color),amount:event.amount}];
    if(previous){previous.amount+=event.amount;previous.after=event.after??previous.after;previous.collection=previous.collection||event.collection;previous.cells.push(...cells);}
    else groups.set(event.color,{...event,cells:cells.slice()});
  }
  return [...groups.values()];
}
function battlePrepareIncome(events) {
  const income=battleIncomeRows(events);
  if(!income.length||!ui.st?.strategy)return;
  battleIncomeClear();
  const gold={...ui.st.strategy.gold};
  for(const e of income)gold[e.color]=e.before??gold[e.color]-e.amount;
  ui.battleIncomeVisual={state:ui.st,gold,rows:[],waiting:true};
}
function battleIncomeDuration(events) {
  if(!(events||[]).some(e=>e.type==='income'&&e.amount>0))return 0;
  if(profile.calm||matchMedia('(prefers-reduced-motion: reduce)').matches)return 450;
  return events.some(e=>e.collection)?3100:1100;
}
function battleIncomeEvents(events) {
  const income=battleIncomeRows(events),st=ui.st;if(!income.length||!st?.strategy)return;
  const quiet=profile.calm||matchMedia('(prefers-reduced-motion: reduce)').matches;
  battleIncomeClear();
  const visual={state:st,gold:{...st.strategy.gold},started:performance.now(),rows:[]};ui.battleIncomeVisual=visual;ui.battleIncomeTimers=[];
  const duration=battleIncomeDuration(events);
  for(const event of income){
    const color=event.color,badge=battleIncomeBadge(color);if(!badge)continue;
    const before=event.before??st.strategy.gold[color]-event.amount;
    visual.gold[color]=before;
    const cells=(event.cells?.length?event.cells:[{sq:findKing(st,color),amount:event.amount}]).slice().sort((a,b)=>a.sq-b.sq);
    const collect=!!event.collection,step=cells.length>1?Math.min(45,1200/(cells.length-1)):0,hold=collect?650:80,flight=collect?950:650;
    visual.rows.push({color,before,after:event.after??st.strategy.gold[color],cells,step,flight:hold+flight});
    badge.classList.add('battle-income-pulse');
    const label=document.createElement('span'),br=badge.getBoundingClientRect();label.className='battle-income';label.textContent=`${color===myColor()?'Мой сбор':'Сбор соперника'} +${strategyMoney(event.amount)}`;label.style.left=br.left+br.width/2+'px';label.style.top=br.top+'px';document.body.appendChild(label);
    if(!quiet)cells.forEach((cell,i)=>{const id=setTimeout(()=>{
      if(ui.battleIncomeVisual!==visual||ui.st!==st)return;
      const target=battleIncomeBadge(color),from=ui.squareEls[cell.sq]?.getBoundingClientRect(),to=target?.getBoundingClientRect();if(!from||!to||!from.width||!to.width)return;
      const x=from.left+from.width/2,y=from.top+from.height/2,dx=to.left+to.width/2-x,dy=to.top+to.height/2-y;
      const coin=document.createElement('span');coin.className='battle-income-coin coin-v88'+(cell.boosted?' doubled':'')+(color===myColor()?' own':' enemy');
      coin.innerHTML=`<i class="income-coin-face">${cell.boosted?'×2':'₵'}</i><b>+${strategyMoney(cell.amount)}</b>`;coin.style.left=x+'px';coin.style.top=y+'px';document.body.appendChild(coin);
      const halo=document.createElement('span');halo.className='battle-income-cell';halo.style.left=from.left+'px';halo.style.top=from.top+'px';halo.style.width=from.width+'px';halo.style.height=from.height+'px';document.body.appendChild(halo);
      const total=hold+flight;
      const animation=coin.animate([
        {transform:'translate(-50%,-30%) scale(.25)',opacity:0},
        {transform:'translate(-50%,-90%) scale(1.12)',opacity:1,offset:Math.min(.16,hold/total*.65)},
        {transform:'translate(-50%,-90%) scale(1)',opacity:1,offset:hold/total},
        {transform:`translate(calc(-50% + ${dx*.45}px),calc(-50% + ${Math.min(dy*.5,-60)}px)) scale(.95)`,opacity:1,offset:hold/total+(1-hold/total)*.48},
        {transform:`translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.4)`,opacity:.7}
      ],{duration:total,easing:'cubic-bezier(.22,.55,.3,1)',fill:'forwards'});
      animation.onfinish=()=>{coin.remove();halo.remove();if(ui.battleIncomeVisual!==visual)return;const arrival=document.createElement('i');arrival.className='battle-income-arrival';arrival.style.left=(to.left+to.width/2)+'px';arrival.style.top=(to.top+to.height/2)+'px';document.body.appendChild(arrival);ui.battleIncomeTimers.push(setTimeout(()=>arrival.remove(),380));};
    },i*step);ui.battleIncomeTimers.push(id);});
  }
  const tick=now=>{if(ui.battleIncomeVisual!==visual||ui.st!==st){battleIncomeClear();return;}
    const elapsed=now-visual.started;
    for(const row of visual.rows){const collected=quiet?(row.after-row.before)*Math.min(1,elapsed/duration):row.cells.reduce((n,c,i)=>n+(elapsed>=i*row.step+row.flight?c.amount:0),0);visual.gold[row.color]=Math.min(row.after,row.before+collected);}
    battlePaintIncomeGold();
    if(elapsed<duration)ui.battleIncomeFrame=requestAnimationFrame(tick);else {battleIncomeClear();battlePaintIncomeGold();}
  };
  battlePaintIncomeGold();ui.battleIncomeFrame=requestAnimationFrame(tick);
}
function battleAnimationDuration(events) {
  const quiet=profile.calm||matchMedia('(prefers-reduced-motion: reduce)').matches;
  const shot=events.find(e=>e.type==='shot');
  const base=quiet?120:shot?(shot.special==='nuke'?4000:shot.special==='rocket'||shot.special==='catapult'?1800:1250):events.some(e=>['move','deploy','knockback'].includes(e.type))?700:350;
  return base+battleIncomeDuration(events);
}
function battleAnimateAction(kind,result,record,done) {
  const events=result.events||[],st=ui.st,duration=battleAnimationDuration(events),incomeDuration=battleIncomeDuration(events),actionDuration=duration-incomeDuration,shot=events.find(e=>e.type==='shot');
  battleFxClear(true);ui.battleFxBusy=true;
  const before=result.before;if(before)ui.battleFxState=restoreNetworkState(before);
  renderBoard(false);battleRenderUi();battleShowAction(record.san,result.mover);
  const quiet=profile.calm||matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(shot&&!quiet)strategyProjectile(shot.from,shot.to,shot.special==='nuke'?'☢':shot.special==='rocket'?'🚀':shot.special==='catapult'?'🪨':'•',shot.special==='nuke'?2200:actionDuration-500);
  const seq=ui.moves.length;
  const impact=()=>{
    if(ui.st!==st||ui.moves.length!==seq)return;
    ui.battleFxState=null;renderBoard(false);
    if(shot?.special==='nuke')strategyNuke(shot.to);
    for(const e of events){
      if(e.type==='damage')strategyFloat(e.sq,`−${e.amount}${e.absorbed?' 🛡':''}`,'red');
      if(e.type==='shot'&&!e.hit)strategyFloat(e.to,'МИМО','purple');
      if(e.type==='knockback'||e.type==='knockout')strategyKnockbackFx(e);
      if(e.type==='destroy')strategyBurst(e.sq,'#ff944b');
      if(e.type==='king-explosion'){const hit=events.find(x=>x.victim?.t==='k');if(hit)kingDeathFx({type:'k',color:e.color,square:hit.to});}
      if(e.type==='destroy'&&e.piece?.t==='k')kingDeathFx({type:'k',color:e.piece.c,square:e.sq});
      if(e.type==='support')strategyFloat(e.sq,e.support==='shield'?'🛡 Щит':'💚 Ремонт','blue');
      if(kind==='brawl'&&e.damage)damageFx(e.to,e.damage.dmg,e.damage.survived,e.damage.type);
      if(e.type==='move'&&before){const p=before.board[e.from],el=p&&ui.pieceNodes.get(p.id);if(el){const a=disp(st,e.from),b=disp(st,e.to);el.animate([{transform:`translate(${a.dx*ui.sq}px,${a.dy*ui.sq}px) scale(.95)`},{transform:`translate(${b.dx*ui.sq}px,${b.dy*ui.sq}px) scale(1)`}],{duration:500,easing:'ease-in-out'});}}
    }
  };
  const delay=shot&&!quiet?(shot.special==='nuke'?2200:actionDuration-500):0;
  if(delay){ui.battleFxTimer=setTimeout(()=>{impact();ui.battleFxTimer=setTimeout(collect,actionDuration-delay);},delay);}else{impact();ui.battleFxTimer=setTimeout(collect,actionDuration);}
  function collect(){if(ui.st!==st||ui.moves.length!==seq)return;if(incomeDuration){battleIncomeEvents(events);ui.battleFxTimer=setTimeout(finish,incomeDuration);}else finish();}
  function finish(){if(ui.st!==st||ui.moves.length!==seq)return;ui.battleFxBusy=false;ui.battleFxState=null;ui.battleFxTimer=0;renderAll(false);done();}
  return duration;
}
function battleShockwave(sq) {
  if(profile.calm||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const r=ui.squareEls[sq]?.getBoundingClientRect();if(!r)return;
  const el=document.createElement('div');el.className='battle-shockwave';el.style.left=r.left+r.width/2+'px';el.style.top=r.top+r.height/2+'px';el.style.setProperty('--shock-end',Math.hypot(innerWidth,innerHeight)*2+'px');document.body.appendChild(el);setTimeout(()=>el.remove(),2200);
}
