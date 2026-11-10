'use strict';
const STRATEGY_PHONE_TABS = ['actions','countries','history'];
const strategyPhoneAnchors = new Map();
function strategyPhoneMove(el,parent){if(!el||!parent)return;if(!strategyPhoneAnchors.has(el)){const marker=document.createComment('strategy-phone-home:'+el.id);el.before(marker);strategyPhoneAnchors.set(el,marker);}if(el.parentElement!==parent)parent.appendChild(el);}
function strategyPhoneRestore(){for(const [el,marker]of strategyPhoneAnchors){if(marker.parentNode){marker.before(el);marker.remove();}}strategyPhoneAnchors.clear();$('#strategyPhone')?.classList.add('hidden');$('#gameShell')?.classList.remove('strategy-phone');}
function strategyShortName(text,max=18){const names={'Светлая республика':'Светл. респ.','Тёмная федерация':'Тёмн. фед.','Столица торговли':'Торг. город'};const value=names[text]||String(text||'');return value.length>max?value.slice(0,max-1)+'…':value;}
function strategyPhoneEnsure(){
  let root=$('#strategyPhone');if(root)return root;
  root=document.createElement('div');root.id='strategyPhone';root.className='strategy-phone-root hidden';
  const header=document.createElement('div');header.id='strategyPhoneHeader';header.className='strategy-phone-header';
  const board=document.createElement('section');board.id='strategyPhonePane-board';board.className='strategy-phone-board';board.setAttribute('aria-label','Игровое поле');
  const nav=document.createElement('div');nav.className='strategy-phone-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Меню под доской — листайте влево и вправо');
  for(const [key,label]of [['actions','Действия'],['countries','Страны'],['history','Ходы']]){
    const b=document.createElement('button');b.type='button';b.id='strategyPhoneTab-'+key;b.textContent=label;b.dataset.phoneTab=key;b.setAttribute('role','tab');b.setAttribute('aria-controls','strategyPhonePane-'+key);b.onclick=()=>strategyPhoneSelect(key);nav.appendChild(b);
  }
  const content=document.createElement('div');content.className='strategy-phone-content';content.setAttribute('aria-label','Свайп влево или вправо меняет меню');
  for(const key of STRATEGY_PHONE_TABS){const pane=document.createElement('section');pane.id='strategyPhonePane-'+key;pane.className='strategy-phone-pane';pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby','strategyPhoneTab-'+key);content.appendChild(pane);}
  content.addEventListener('scroll',()=>{if(!content.clientWidth)return;const key=STRATEGY_PHONE_TABS[Math.max(0,Math.min(STRATEGY_PHONE_TABS.length-1,Math.round(content.scrollLeft/content.clientWidth)))];if(key!==ui.strategyPhoneTab){ui.strategyPhoneTab=key;strategyPhoneMarkTab();}},{passive:true});
  nav.addEventListener('keydown',e=>{if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();const index=STRATEGY_PHONE_TABS.indexOf(ui.strategyPhoneTab);const key=STRATEGY_PHONE_TABS[(index+(e.key==='ArrowRight'?1:2))%3];strategyPhoneSelect(key);$('#strategyPhoneTab-'+key).focus();});
  root.append(header,board,nav,content);$('#gameShell').appendChild(root);
  for(const [paneId,type,items] of [['actions','action',[['combat','Бой'],['development','Развитие'],['army','Армия']]],['countries','country',[['own','Своя'],['enemy','Враг'],['objects','Объекты']]]]){
    const sub=document.createElement('div');sub.className='strategy-phone-subtabs';
    for(const [key,label]of items){const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.subTab=key;b.onclick=()=>{ui['strategyPhone'+(type==='action'?'Action':'Country')+'Tab']=key;strategyPhoneSubtabs();strategyPhoneRenderSummary();};sub.appendChild(b);}
    $('#strategyPhonePane-'+paneId).prepend(sub);
  }
  const help=document.createElement('div');help.id='strategyPhoneFieldHelp';help.className='strategy-phone-field-help';
  const call=document.createElement('button');call.type='button';call.textContent='Действия ↔';call.onclick=()=>strategyPhoneSelect('actions');help.appendChild(call);board.appendChild(help);
  const historyTools=document.createElement('div');historyTools.className='strategy-phone-history-tools';
  for(const [text,fn]of [['‹',()=>gotoPly(ui.viewPly-1)],['›',()=>gotoPly(ui.viewPly+1)],['Чат',()=>{switchTab('chat');togglePanel();}],['Экспорт',openExport],['Импорт',openImport],['Настройки',()=>openScreen('settings')]]){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;historyTools.appendChild(b);}
  $('#strategyPhonePane-history').appendChild(historyTools);
  return root;
}
function strategyPhoneSubtabs(){
  const root=$('#strategyPhone');if(!root)return;
  root.dataset.actionTab=ui.strategyPhoneActionTab||'combat';root.dataset.countryTab=ui.strategyPhoneCountryTab||'own';
  for(const [pane,type]of [['actions','action'],['countries','country']])for(const b of $('#strategyPhonePane-'+pane).querySelectorAll('.strategy-phone-subtabs button'))b.classList.toggle('active',b.dataset.subTab===root.dataset[type+'Tab']);
}
function strategyPhoneMarkTab(){
  const root=$('#strategyPhone');if(!root)return;root.dataset.tab=ui.strategyPhoneTab||'actions';
  for(const key of STRATEGY_PHONE_TABS){const b=$('#strategyPhoneTab-'+key);b.setAttribute('aria-selected',String(key===root.dataset.tab));b.tabIndex=key===root.dataset.tab?0:-1;}
}
function strategyPhoneSelect(tab){
  if(tab==='board'){strategyPhoneToField();return;}
  if(!STRATEGY_PHONE_TABS.includes(tab))tab='actions';ui.strategyPhoneTab=tab;
  const root=$('#strategyPhone');if(!root)return;
  strategyPhoneMarkTab();strategyPhoneSubtabs();strategyPhoneRenderSummary();
  const content=root.querySelector('.strategy-phone-content');content.scrollTo({left:STRATEGY_PHONE_TABS.indexOf(tab)*content.clientWidth,behavior:profile.calm?'auto':'smooth'});
}
function strategyPhoneOwnSide(){return myColor()==='b'?'b':'w';}
function strategyPhoneMoney(value){return typeof strategyMoney==='function'?strategyMoney(value):String(value);}
function strategyPhoneGold(color,st){return typeof battleDisplayedGold==='function'?battleDisplayedGold(color,st):st.strategy.gold[color];}
function strategyPhoneRenderSummary(){
  if(!ui.st?.flags.strategy||innerWidth>=1000||!$('#gameShell').classList.contains('strategy-phone'))return;
  const st=viewState(),s=st.strategy,own=strategyPhoneOwnSide(),enemy=other(own),phase=s.phase==='move'?'Манёвры':'Атака';
  const header=$('#strategyPhoneHeader');header.innerHTML='';
  const title=document.createElement('div');title.className='strategy-phone-turn';title.textContent=`Р${s.round} · ${phase} · ${strategyShortName(s.factions[st.turn],16)}${ui.botThinking?' · думает':''}`;header.appendChild(title);
  const countries=document.createElement('div');countries.className='strategy-phone-money-row';
  for(const [c,label]of [[own,'Вы'],[enemy,'Враг']]){const el=document.createElement('button');el.type='button';el.className='strategy-phone-money';el.dataset.side=c;el.style.setProperty('--money',100*strategyPhoneGold(c,st)/s.cap+'%');el.innerHTML=`<span>${label}: ${escapeHtml(strategyShortName(s.factions[c],15))}</span><b><span data-battle-gold="${c}">${strategyPhoneMoney(strategyPhoneGold(c,st))}</span> <small>/ ${s.cap} 🪙</small></b><em>+${strategyPhoneMoney(strategyRuleIncome(st,c))}/4 действия <span data-phone-clock="${c}"></span></em>`;el.onclick=()=>{ui.strategyPhoneCountryTab=c===own?'own':'enemy';strategyPhoneSelect('countries');};countries.appendChild(el);}header.appendChild(countries);
  const help=$('#strategyPhoneFieldHelp');let hint=help.querySelector('span');if(!hint){hint=document.createElement('span');help.prepend(hint);}hint.textContent=ui.battleFxBusy?'Действие выполняется…':ui.strategy.recruit?'Нажми пустую свою клетку':ui.strategy.support?'Нажми свою фигуру':ui.strategy.special==='nuke'?'Выбери цель ядерки и подтверди':s.phase==='attack'?'Фигура → подсвеченная цель':'Фигура → клетка · меню свайпом ↔';
  const history=$('#strategyPhonePane-history');let list=$('#strategyPhoneMoves');if(!list){list=document.createElement('div');list.id='strategyPhoneMoves';list.className='strategy-phone-moves';history.appendChild(list);}
  const key=ui.moves.length+'|'+ui.viewPly;if(list.dataset.key!==key){list.dataset.key=key;list.innerHTML='';if(!ui.moves.length)list.textContent='Пока нет действий';else for(let i=0;i<ui.moves.length;i++){const m=ui.moves[i],b=document.createElement('button');b.type='button';b.className=i+1===ui.viewPly?'active':'';b.textContent=`${i+1}. ${m.color==='w'?'Б':'Ч'} · ${m.san}`;b.onclick=()=>gotoPly(i+1);list.appendChild(b);}}
  const pane=$('#strategyPhonePane-countries');let stats=$('#strategyPhoneStats');if(!stats){stats=document.createElement('div');stats.id='strategyPhoneStats';const nav=pane.querySelector('.strategy-phone-subtabs');if(nav)nav.after(stats);else pane.prepend(stats);}stats.innerHTML='';
  const selectedCountry=ui.strategyPhoneCountryTab||'own';
  for(const [c,label]of (selectedCountry==='objects'?[]:selectedCountry==='enemy'?[[enemy,'Государство врага']]:[[own,'Ваше государство']])){
    const army=st.board.filter(p=>p&&p.c===c),king=army.find(p=>p.t==='k'),hp=army.reduce((n,p)=>n+strategyPieceHp(st,p),0),maxHp=army.reduce((n,p)=>n+STRAT[p.t].hp,0),shields=army.reduce((n,p)=>n+(s.shield[p.id]||0),0),land=Object.values(s.territory).filter(x=>x===c).length,objects=s.objects.filter(o=>s.territory[o.sq]===c),u=s.upgrades[c];
    const card=document.createElement('article');card.className='strategy-phone-state-card';card.dataset.side=c;
    const player=(ui.names?.[c]?.name||ui.online?.names?.[c]?.name||(c===own?profile.name:ui.bot?.name)||'Игрок');
    card.innerHTML=`<h3>${label}: ${escapeHtml(strategyShortName(s.factions[c],24))}</h3><p title="${escapeHtml(String(player))}">Игрок: ${escapeHtml(strategyShortName(player,18))}</p><dl><div><dt>Казна</dt><dd>${strategyPhoneMoney(strategyPhoneGold(c,st))}/${s.cap}</dd></div><div><dt>Доход / 4 действия</dt><dd>+${strategyPhoneMoney(strategyRuleIncome(st,c))}</dd></div><div><dt>Штаб</dt><dd>${king?strategyPieceHp(st,king):0}/${STRAT.k.hp} HP</dd></div><div><dt>Армия</dt><dd>${army.length} фигур</dd></div><div><dt>Здоровье армии</dt><dd>${hp}/${maxHp} HP</dd></div><div><dt>Щиты</dt><dd>${shields} HP</dd></div><div><dt>Земля</dt><dd>${land}/${st.board.length}</dd></div><div><dt>Объекты</dt><dd>${objects.length}/${s.objects.length}</dd></div></dl><p>Эконом. ${u.income}/5 · Арсенал ${u.arsenal}/5 · Снабж. ${u.logistics}/5</p><p>Ядерка: ${s.nukeUsed[c]?'использована':s.round<STRAT_NUKE.round?'с раунда '+STRAT_NUKE.round:'доступна за '+STRAT_NUKE.cost+' 🪙'}</p><small>${objects.map(o=>escapeHtml(o.name)+' +'+o.income).join(' · ')||'Нет доходных объектов'}</small>`;stats.appendChild(card);
  }
  strategyPhoneUpdateClocks();
}
function strategyPhoneSync(){
  const active=innerWidth<1000&&ui.screen==='game'&&ui.st?.flags.strategy;
  if(!active){if(strategyPhoneAnchors.size)strategyPhoneRestore();return false;}
  if(typeof v84BattleDesktopRestore==='function')v84BattleDesktopRestore();
  const fresh=ui.strategyPhoneState!==ui.st;
  if(fresh){ui.strategyPhoneState=ui.st;ui.strategyPhoneTab='actions';ui.strategyPhoneActionTab='combat';ui.strategyPhoneCountryTab='own';}
  const root=strategyPhoneEnsure(),shell=$('#gameShell');root.classList.remove('hidden');shell.classList.add('strategy-phone');shell.classList.remove('v84-centered','v84-panel-below');
  const board=$('#strategyPhonePane-board'),actions=$('#strategyPhonePane-actions'),countries=$('#strategyPhonePane-countries');
  strategyPhoneMove($('#boardWrap'),board);board.insertBefore($('#boardWrap'),$('#strategyPhoneFieldHelp'));
  strategyPhoneMove($('#strategyBar'),actions);strategyPhoneMove($('#stratCards'),actions);strategyPhoneMove($('#stratInfoPanel .sip-actions')||$('#strategyPhonePane-actions .sip-actions'),actions);strategyPhoneMove($('#stage .mobile-actions')||$('#strategyPhonePane-actions .mobile-actions'),actions);
  strategyPhoneMove($('#battleCountryCard'),countries);strategyPhoneMove($('#battleObjectLegend'),countries);
  if(!STRATEGY_PHONE_TABS.includes(ui.strategyPhoneTab))ui.strategyPhoneTab='actions';
  strategyPhoneMarkTab();strategyPhoneSubtabs();strategyPhoneRenderSummary();
  if(fresh)root.querySelector('.strategy-phone-content').scrollLeft=0;
  return true;
}
function strategyPhoneLayout(){
  if(!strategyPhoneSync())return false;
  const root=$('#strategyPhone'),wrap=$('#boardWrap'),content=root.querySelector('.strategy-phone-content');
  const chrome=$('#strategyPhoneHeader').offsetHeight+root.querySelector('.strategy-phone-tabs').offsetHeight+$('#strategyPhoneFieldHelp').offsetHeight+14;
  const menuRoom=Math.max(115,Math.min(200,root.clientHeight*.25));
  const availableHeight=Math.max(96,root.clientHeight-chrome-menuRoom);
  const sq=Math.max(12,Math.floor(Math.min(170,(root.clientWidth-4)/ui.st.W,availableHeight/ui.st.H)));
  ui.sq=sq;wrap.style.width=sq*ui.st.W+'px';wrap.style.height=sq*ui.st.H+'px';wrap.style.padding='0';document.documentElement.style.setProperty('--sq',sq+'px');
  const key=content.clientWidth+'|'+ui.strategyPhoneState?.seed;
  if(content.dataset.layout!==key){content.dataset.layout=key;content.scrollLeft=STRATEGY_PHONE_TABS.indexOf(ui.strategyPhoneTab)*content.clientWidth;}
  return true;
}
function strategyPhoneToField(){if(innerWidth<1000&&ui.st?.flags.strategy){const board=$('#strategyPhonePane-board');if(board){board.classList.remove('field-attention');void board.offsetWidth;board.classList.add('field-attention');}}}
function strategyPhoneUpdateClocks(){
  if(!$('#gameShell')?.classList.contains('strategy-phone'))return;
  for(const el of document.querySelectorAll('[data-phone-clock]')){
    const color=el.dataset.phoneClock;let ms=ui.clocks[color];
    if(ui.running&&!ui.paused&&!ui.away&&ui.st.status==='play'&&ui.st.turn===color)ms=Math.max(0,ms-(performance.now()-ui.turnStart));
    el.textContent=' · '+fmtClock(ms);
  }
}
function setupStrategyPhone(){
  const originalClocks=updateClockEls;
  updateClockEls=function(...args){originalClocks(...args);strategyPhoneUpdateClocks();};
  const original=battleRenderUi;
  battleRenderUi=function(){original();strategyPhoneSync();if(innerWidth>=1000&&typeof v84BattleDesktopSync==='function')v84BattleDesktopSync();};
  const originalLayout=battleMobileLayout;
  battleMobileLayout=function(){if(innerWidth<1000&&typeof v84BattleDesktopRestore==='function')v84BattleDesktopRestore();if(innerWidth<1000&&ui.st?.flags.strategy)return strategyPhoneLayout();strategyPhoneRestore();return originalLayout();};
  const originalAnimate=battleAnimateAction;
  battleAnimateAction=function(...args){strategyPhoneToField();return originalAnimate(...args);};
  const originalSelect=strategySelectAttacker;
  strategySelectAttacker=function(...args){const result=originalSelect(...args);strategyPhoneToField();return result;};
  const originalCards=strategyRenderCards;
  strategyRenderCards=function(){originalCards();const cards=$('#stratCards');if(cards)for(const b of cards.querySelectorAll('button')){const click=b.onclick;b.onclick=(e)=>{click?.(e);strategyPhoneToField();};}};
  const originalShow=showScreen;
  showScreen=function(name){if(name!=='game'){strategyPhoneRestore();if(typeof v84BattleDesktopRestore==='function')v84BattleDesktopRestore();}originalShow(name);if(name==='game'&&ui.st?.flags.strategy){strategyPhoneSync();requestAnimationFrame(()=>{if(ui.screen==='game')renderBoard(false);});}};
  window.addEventListener('resize',()=>{strategyPhoneSync();if(ui.screen==='game'&&ui.st)requestAnimationFrame(()=>renderBoard(false));});
}
setupStrategyPhone();
