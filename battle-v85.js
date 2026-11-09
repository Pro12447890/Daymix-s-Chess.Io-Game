'use strict';
function battleFxClear() {
  clearTimeout(ui.battleFxTimer); ui.battleFxTimer=0; ui.battleFxBusy=false;ui.battleFxState=null;
  document.querySelectorAll('.battle-projectile,.battle-action-toast,.battle-shockwave,.battle-piece-ghost,.battle-income').forEach(el=>el.remove());
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
  if(badge){if(badge.parentElement!==bar)bar.appendChild(badge);badge.style.setProperty('--coins',`${Math.min(100,100*s.gold[color]/s.cap)}%`);
    badge.setAttribute('aria-label',`Казна ${s.factions[color]}: ${s.gold[color]} из ${s.cap}, доход ${strategyRuleIncome(st,color)} за раунд`);
    badge.title=`Казна · следующий доход +${strategyRuleIncome(st,color)} монет / раунд`;
    badge.innerHTML=`<span class="battle-coin">🪙</span><b>${s.gold[color]} <small>/ ${s.cap}</small></b><span class="battle-next-income">+${strategyRuleIncome(st,color)} / раунд</span>`;
  }
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
    const s=st.strategy,bottom=barOrientation()==='w'?'w':'b';battleRenderCountry(st,other(bottom),'top');battleRenderCountry(st,bottom,'bottom');
    let nuke=$('#battleNuke');if(!nuke){nuke=document.createElement('button');nuke.type='button';nuke.id='battleNuke';nuke.className='battle-nuke-card';$('#strategyBar').appendChild(nuke);}
    const own=(ui.mode==='online'||ui.bot)?myColor():st.turn;
    let reason=s.nukeUsed[own]?'Запуск уже использован':s.round<STRAT_NUKE.round?`Откроется в раунде ${STRAT_NUKE.round} (сейчас ${s.round})`:s.gold[own]<STRAT_NUKE.cost?`Нужно ${STRAT_NUKE.cost} монет, есть ${s.gold[own]}`:s.phase!=='attack'?'Дождитесь фазы атаки':st.turn!==own?'Сейчас очередь противника':!strategyCanAct()?'Действие временно недоступно':'';
    nuke.disabled=!!reason;
    nuke.innerHTML=`<span class="battle-nuke-icon">☢</span><span><b>Ядерный удар · ${STRAT_NUKE.cost} 🪙</b><small>${reason||'Выбери цель → подтверди повторным нажатием'} · 1 запуск на сторону</small></span>`;
    nuke.onclick=()=>{const king=findKing(ui.st,ui.st.turn);if(king<0)return;ui.strategy.special='nuke';ui.strategy.previewTarget=null;strategySelectAttacker(king);toast('Ядерный удар: выбери цель. Удар заденет и своих.');};battleLockButton(nuke,reason||'Два нажатия на цель для подтверждения');
    let country=$('#battleCountryCard');if(!country){country=document.createElement('div');country.id='battleCountryCard';country.className='battle-country-card';$('#stratInfoPanel').prepend(country);}
    const levels=s.upgrades[own];country.innerHTML=`<span>${own==='w'?'🏛':'🏰'}</span><div><b>${escapeHtml(s.factions[own])}</b><small>Экономика ${levels.income}/3 · Арсенал ${levels.arsenal}/3 · Снабжение ${levels.logistics}/3</small></div>`;
    let legend=$('#battleObjectLegend');if(!legend){legend=document.createElement('details');legend.id='battleObjectLegend';legend.className='battle-object-legend';$('#stratInfoPanel').appendChild(legend);}
    legend.innerHTML='<summary>Объекты и захват земли</summary><p>🏭 Завод: +4 · ⚓ Порт: +4 · 🏙 Торговый город: +6 монет за раунд владельцу клетки. Цвет рамки показывает владельца. Три взаимодействия вокруг своих фигур захватывают клетку; при споре выигрывает ближайшая фигура.</p>';
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
function battleIncomeEvents(events) {
  for(const event of events||[]){if(event.type!=='income')continue;const c=event.color;
     const badge=$('#gameShell')?.classList.contains('strategy-phone')?document.querySelector(`.strategy-phone-money[data-side="${c}"]`):$('#stratGoldBadge'+c.toUpperCase());if(!badge)continue;
    badge.classList.remove('battle-income-pulse');void badge.offsetWidth;badge.classList.add('battle-income-pulse');
    const el=document.createElement('span'),r=badge.getBoundingClientRect();el.className='battle-income';el.textContent=`+${event.amount} 🪙`;el.style.left=r.left+r.width/2+'px';el.style.top=r.top+'px';document.body.appendChild(el);setTimeout(()=>{el.remove();badge.classList.remove('battle-income-pulse');},1800);
  }
}
function battleAnimationDuration(events) {
  if(profile.calm||matchMedia('(prefers-reduced-motion: reduce)').matches)return 120;
  const shot=events.find(e=>e.type==='shot');return shot?(shot.special==='nuke'?4000:shot.special==='rocket'||shot.special==='catapult'?1800:1250):events.some(e=>['move','deploy','knockback'].includes(e.type))?700:350;
}
function battleAnimateAction(kind,result,record,done) {
  const events=result.events||[],st=ui.st,duration=battleAnimationDuration(events),shot=events.find(e=>e.type==='shot');
  battleFxClear();ui.battleFxBusy=true;
  const before=result.before;if(before)ui.battleFxState=restoreNetworkState(before);
  renderBoard(false);battleRenderUi();battleShowAction(record.san,result.mover);battleIncomeEvents(events);
  const quiet=profile.calm||matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(shot&&!quiet)strategyProjectile(shot.from,shot.to,shot.special==='nuke'?'☢':shot.special==='rocket'?'🚀':shot.special==='catapult'?'🪨':'•',shot.special==='nuke'?2200:duration-500);
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
  const delay=shot&&!quiet?(shot.special==='nuke'?2200:duration-500):0;
  if(delay){ui.battleFxTimer=setTimeout(()=>{impact();ui.battleFxTimer=setTimeout(finish,duration-delay);},delay);}else{impact();ui.battleFxTimer=setTimeout(finish,duration);}
  function finish(){if(ui.st!==st||ui.moves.length!==seq)return;ui.battleFxBusy=false;ui.battleFxState=null;ui.battleFxTimer=0;renderAll(false);done();}
  return duration;
}
function battleShockwave(sq) {
  if(profile.calm||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const r=ui.squareEls[sq]?.getBoundingClientRect();if(!r)return;
  const el=document.createElement('div');el.className='battle-shockwave';el.style.left=r.left+r.width/2+'px';el.style.top=r.top+r.height/2+'px';el.style.setProperty('--shock-end',Math.hypot(innerWidth,innerHeight)*2+'px');document.body.appendChild(el);setTimeout(()=>el.remove(),2200);
}
