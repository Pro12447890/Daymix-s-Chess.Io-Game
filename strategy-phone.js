'use strict';
const STRATEGY_PHONE_TABS = ['board','actions','countries','history'];
const strategyPhoneAnchors = new Map();
function strategyPhoneMove(el,parent){if(!el||!parent)return;if(!strategyPhoneAnchors.has(el)){const marker=document.createComment('strategy-phone-home:'+el.id);el.before(marker);strategyPhoneAnchors.set(el,marker);}if(el.parentElement!==parent)parent.appendChild(el);}
function strategyPhoneRestore(){for(const [el,marker]of strategyPhoneAnchors){if(marker.parentNode){marker.before(el);marker.remove();}}strategyPhoneAnchors.clear();$('#strategyPhone')?.classList.add('hidden');$('#gameShell')?.classList.remove('strategy-phone');}
function strategyShortName(text,max=18){const names={'Светлая республика':'Светл. респ.','Тёмная федерация':'Тёмн. фед.','Столица торговли':'Торг. город'};const value=names[text]||String(text||'');return value.length>max?value.slice(0,max-1)+'…':value;}
function strategyPhoneEnsure(){
  let root=$('#strategyPhone');if(root)return root;
  root=document.createElement('div');root.id='strategyPhone';root.className='strategy-phone-root hidden';
  const header=document.createElement('div');header.id='strategyPhoneHeader';header.className='strategy-phone-header';
  const nav=document.createElement('div');nav.className='strategy-phone-tabs';nav.setAttribute('role','tablist');nav.setAttribute('aria-label','Разделы Стратегии');
  for(const [key,label]of [['board','Поле'],['actions','Действия'],['countries','Страны'],['history','Ходы']]){
    const b=document.createElement('button');b.type='button';b.id='strategyPhoneTab-'+key;b.textContent=label;b.dataset.phoneTab=key;b.setAttribute('role','tab');b.setAttribute('aria-controls','strategyPhonePane-'+key);b.onclick=()=>strategyPhoneSelect(key);nav.appendChild(b);
  }
  const content=document.createElement('div');content.className='strategy-phone-content';
  for(const key of STRATEGY_PHONE_TABS){const pane=document.createElement('section');pane.id='strategyPhonePane-'+key;pane.className='strategy-phone-pane';pane.setAttribute('role','tabpanel');pane.setAttribute('aria-labelledby','strategyPhoneTab-'+key);content.appendChild(pane);}
  root.append(header,nav,content);$('#gameShell').appendChild(root);
  for(const [paneId,type,items] of [['actions','action',[['combat','Бой'],['development','Развитие'],['army','Армия']]],['countries','country',[['own','Своя'],['enemy','Враг'],['objects','Объекты']]]]){
    const sub=document.createElement('div');sub.className='strategy-phone-subtabs';
    for(const [key,label]of items){const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.subTab=key;b.onclick=()=>{ui['strategyPhone'+(type==='action'?'Action':'Country')+'Tab']=key;strategyPhoneSubtabs();strategyPhoneRenderSummary();};sub.appendChild(b);}
    $('#strategyPhonePane-'+paneId).prepend(sub);
  }
  const help=document.createElement('div');help.id='strategyPhoneFieldHelp';help.className='strategy-phone-field-help';
  const call=document.createElement('button');call.type='button';call.textContent='Выбрать действие';call.onclick=()=>strategyPhoneSelect('actions');help.appendChild(call);
  $('#strategyPhonePane-board').appendChild(help);
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
function strategyPhoneSelect(tab){
  if(!STRATEGY_PHONE_TABS.includes(tab))tab='board';ui.strategyPhoneTab=tab;
  const root=$('#strategyPhone');if(!root)return;
  root.dataset.tab=tab;
  for(const key of STRATEGY_PHONE_TABS){const button=$('#strategyPhoneTab-'+key),pane=$('#strategyPhonePane-'+key);button.setAttribute('aria-selected',String(key===tab));button.tabIndex=key===tab?0:-1;pane.classList.toggle('hidden',key!==tab);pane.scrollTop=0;}
  strategyPhoneSubtabs();
  if(tab==='board'&&ui.st){renderBoard(false);}strategyPhoneRenderSummary();
}
function strategyPhoneOwnSide(){return myColor()==='b'?'b':'w';}
function strategyPhoneRenderSummary(){
  if(!ui.st?.flags.strategy||innerWidth>=1000||!$('#gameShell').classList.contains('strategy-phone'))return;
  const st=viewState(),s=st.strategy,own=strategyPhoneOwnSide(),enemy=other(own),phase=s.phase==='move'?'Манёвры':'Атака';
  const header=$('#strategyPhoneHeader');header.innerHTML='';
  const title=document.createElement('div');title.className='strategy-phone-turn';title.textContent=`Р${s.round} · ${phase} · ${strategyShortName(s.factions[st.turn],16)}${ui.botThinking?' · думает':''}`;header.appendChild(title);
  const countries=document.createElement('div');countries.className='strategy-phone-money-row';
  for(const [c,label]of [[own,'Вы'],[enemy,'Враг']]){const el=document.createElement('button');el.type='button';el.className='strategy-phone-money';el.dataset.side=c;el.style.setProperty('--money',100*s.gold[c]/s.cap+'%');el.innerHTML=`<span>${label}: ${escapeHtml(strategyShortName(s.factions[c],15))}</span><b>${s.gold[c]} <small>/ ${s.cap} 🪙</small></b><em>+${strategyRuleIncome(st,c)}/раунд <span data-phone-clock="${c}"></span></em>`;el.onclick=()=>{ui.strategyPhoneCountryTab=c===own?'own':'enemy';strategyPhoneSelect('countries');};countries.appendChild(el);}header.appendChild(countries);
  const help=$('#strategyPhoneFieldHelp');let hint=help.querySelector('span');if(!hint){hint=document.createElement('span');help.prepend(hint);}hint.textContent=ui.battleFxBusy?'Атака выполняется…':ui.strategy.recruit?'Нажми пустую свою клетку':ui.strategy.support?'Нажми свою фигуру':ui.strategy.special==='nuke'?'Выбери цель ядерки и подтверди':s.phase==='attack'?'Выбери фигуру → подсвеченную цель':'Выбери фигуру → клетку';
  const history=$('#strategyPhonePane-history');let list=$('#strategyPhoneMoves');if(!list){list=document.createElement('div');list.id='strategyPhoneMoves';list.className='strategy-phone-moves';history.appendChild(list);}
  const key=ui.moves.length+'|'+ui.viewPly;if(list.dataset.key!==key){list.dataset.key=key;list.innerHTML='';if(!ui.moves.length)list.textContent='Пока нет действий';else for(let i=0;i<ui.moves.length;i++){const m=ui.moves[i],b=document.createElement('button');b.type='button';b.className=i+1===ui.viewPly?'active':'';b.textContent=`${i+1}. ${m.color==='w'?'Б':'Ч'} · ${m.san}`;b.onclick=()=>gotoPly(i+1);list.appendChild(b);}}
  const pane=$('#strategyPhonePane-countries');let stats=$('#strategyPhoneStats');if(!stats){stats=document.createElement('div');stats.id='strategyPhoneStats';const nav=pane.querySelector('.strategy-phone-subtabs');if(nav)nav.after(stats);else pane.prepend(stats);}stats.innerHTML='';
  const selectedCountry=ui.strategyPhoneCountryTab||'own';
  for(const [c,label]of (selectedCountry==='objects'?[]:selectedCountry==='enemy'?[[enemy,'Государство врага']]:[[own,'Ваше государство']])){
    const army=st.board.filter(p=>p&&p.c===c),king=army.find(p=>p.t==='k'),hp=army.reduce((n,p)=>n+strategyPieceHp(st,p),0),maxHp=army.reduce((n,p)=>n+STRAT[p.t].hp,0),shields=army.reduce((n,p)=>n+(s.shield[p.id]||0),0),land=Object.values(s.territory).filter(x=>x===c).length,objects=s.objects.filter(o=>s.territory[o.sq]===c),u=s.upgrades[c];
    const card=document.createElement('article');card.className='strategy-phone-state-card';card.dataset.side=c;
    const player=(ui.names?.[c]?.name||ui.online?.names?.[c]?.name||(c===own?profile.name:ui.bot?.name)||'Игрок');
    card.innerHTML=`<h3>${label}: ${escapeHtml(strategyShortName(s.factions[c],24))}</h3><p title="${escapeHtml(String(player))}">Игрок: ${escapeHtml(strategyShortName(player,18))}</p><dl><div><dt>Казна</dt><dd>${s.gold[c]}/${s.cap}</dd></div><div><dt>Доход</dt><dd>+${strategyRuleIncome(st,c)}/раунд</dd></div><div><dt>Штаб</dt><dd>${king?strategyPieceHp(st,king):0}/${STRAT.k.hp} HP</dd></div><div><dt>Армия</dt><dd>${army.length} фигур</dd></div><div><dt>Здоровье армии</dt><dd>${hp}/${maxHp} HP</dd></div><div><dt>Щиты</dt><dd>${shields} HP</dd></div><div><dt>Земля</dt><dd>${land}/${st.board.length}</dd></div><div><dt>Объекты</dt><dd>${objects.length}/${s.objects.length}</dd></div></dl><p>Эконом. ${u.income}/3 · Арсенал ${u.arsenal}/3 · Снабж. ${u.logistics}/3</p><p>Ядерка: ${s.nukeUsed[c]?'использована':s.round<STRAT_NUKE.round?'с раунда '+STRAT_NUKE.round:'доступна за '+STRAT_NUKE.cost+' 🪙'}</p><small>${objects.map(o=>escapeHtml(o.name)+' +'+o.income).join(' · ')||'Нет доходных объектов'}</small>`;stats.appendChild(card);
  }
  strategyPhoneUpdateClocks();
}
function strategyPhoneSync(){
  const active=innerWidth<1000&&ui.st?.flags.strategy;
  if(!active){if(strategyPhoneAnchors.size)strategyPhoneRestore();return false;}
  if(ui.strategyPhoneState!==ui.st){ui.strategyPhoneState=ui.st;ui.strategyPhoneTab='board';ui.strategyPhoneActionTab='combat';ui.strategyPhoneCountryTab='own';}
  const root=strategyPhoneEnsure(),shell=$('#gameShell');root.classList.remove('hidden');shell.classList.add('strategy-phone');
  const board=$('#strategyPhonePane-board'),actions=$('#strategyPhonePane-actions'),countries=$('#strategyPhonePane-countries');
  strategyPhoneMove($('#boardWrap'),board);board.insertBefore($('#boardWrap'),$('#strategyPhoneFieldHelp'));
  strategyPhoneMove($('#strategyBar'),actions);strategyPhoneMove($('#stratCards'),actions);strategyPhoneMove($('#stratInfoPanel .sip-actions')||$('#strategyPhonePane-actions .sip-actions'),actions);strategyPhoneMove($('#stage .mobile-actions')||$('#strategyPhonePane-actions .mobile-actions'),actions);
  strategyPhoneMove($('#battleCountryCard'),countries);strategyPhoneMove($('#battleObjectLegend'),countries);
  ui.strategyPhoneTab=ui.strategyPhoneTab||'board';
  for(const key of STRATEGY_PHONE_TABS){const b=$('#strategyPhoneTab-'+key),pane=$('#strategyPhonePane-'+key);b.setAttribute('aria-selected',String(key===ui.strategyPhoneTab));pane.classList.toggle('hidden',key!==ui.strategyPhoneTab);}
  strategyPhoneSubtabs();strategyPhoneRenderSummary();return true;
}
function strategyPhoneLayout(){
  if(!strategyPhoneSync())return false;
  const pane=$('#strategyPhonePane-board'),header=$('#strategyPhoneHeader'),root=$('#strategyPhone'),wrap=$('#boardWrap');
  const availableHeight=root.clientHeight-header.offsetHeight-$('#strategyPhone .strategy-phone-tabs').offsetHeight-$('#strategyPhoneFieldHelp').offsetHeight-22;
  const sq=Math.max(12,Math.floor(Math.min(170,(root.clientWidth-12)/ui.st.W,availableHeight/ui.st.H)));
  ui.sq=sq;wrap.style.width=sq*ui.st.W+'px';wrap.style.height=sq*ui.st.H+'px';wrap.style.padding='0';document.documentElement.style.setProperty('--sq',sq+'px');return true;
}
function strategyPhoneToField(){if(innerWidth<1000&&ui.st?.flags.strategy)strategyPhoneSelect('board');}
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
  battleRenderUi=function(){original();strategyPhoneSync();};
  const originalLayout=battleMobileLayout;
  battleMobileLayout=function(){if(innerWidth<1000&&ui.st?.flags.strategy)return strategyPhoneLayout();strategyPhoneRestore();return originalLayout();};
  const originalAnimate=battleAnimateAction;
  battleAnimateAction=function(...args){strategyPhoneToField();return originalAnimate(...args);};
  const originalSelect=strategySelectAttacker;
  strategySelectAttacker=function(...args){const result=originalSelect(...args);strategyPhoneToField();return result;};
  const originalCards=strategyRenderCards;
  strategyRenderCards=function(){originalCards();const cards=$('#stratCards');if(cards)for(const b of cards.querySelectorAll('button')){const click=b.onclick;b.onclick=(e)=>{click?.(e);strategyPhoneToField();};}};
  const originalShow=showScreen;
  showScreen=function(name){if(name!=='game')strategyPhoneRestore();originalShow(name);if(name==='game'&&ui.st?.flags.strategy){strategyPhoneSync();requestAnimationFrame(()=>{if(ui.screen==='game')renderBoard(false);});}};
  window.addEventListener('resize',()=>{strategyPhoneSync();if(ui.screen==='game'&&ui.st)requestAnimationFrame(()=>renderBoard(false));});
}
setupStrategyPhone();
