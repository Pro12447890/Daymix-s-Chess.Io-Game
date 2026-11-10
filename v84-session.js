'use strict';
function specialMode(st=ui.st){return st&&(st.flags.strategy?'strategy':st.flags.clashBrawl?'brawl':null);}
function bindSpecialState(st=ui.st){
 if(!st)return;
 if(st.flags.strategy){strategyBindState(st);document.documentElement.dataset.strategy='1';$('#strategyBar')?.classList.remove('hidden');$('#stratInfoPanel')?.classList.remove('hidden');}
 if(st.flags.clashBrawl){brawlBindState(st);document.documentElement.dataset.brawl='1';$('#brawlPanel')?.classList.remove('hidden');}
}
function reduceSpecialAction(st,action){
 if(!action||typeof action!=='object')return {ok:false};
 return st.flags.strategy?strategyReduceAction(st,action):brawlApplyAction(st,action,{color:st.brawl?.draft?.turn||st.turn});
}
function replayRecordedMove(rec,importing=false){
 if(!ui.st)return false;
 if(!specialMode())return commitMove(rec,{remote:true,silent:true,noAnim:true});
 const r=reduceSpecialAction(ui.st,rec.action);if(!r?.ok)return false;
 const from=Number.isInteger(rec.from)?rec.from:rec.from?parseSquare(ui.st,rec.from):-1;
 const to=Number.isInteger(rec.to)?rec.to:rec.to?parseSquare(ui.st,rec.to):-1;
 ui.moves.push({...rec,from,to,color:r.mover,special:specialMode(),spent:Number(rec.spent??rec.ms)||0});
 ui.lastMove=from>=0&&to>=0?{from,to}:null;ui.frames.push(snap(ui.st,ui.lastMove));ui.viewPly=ui.frames.length-1;
 if(!importing)bindSpecialState(ui.st);return true;
}
function specialLabel(kind,r){
 if(r.record)return typeof r.record==='string'?r.record:r.record.san;
 const a=r.action||{},names={move:'Манёвр',attack:'Выстрел',upgrade:'Улучшение',support:'Поддержка',deploy:'Подкрепление',pass:'Пропуск',mine:'Мина','draft-start':'Начало драфта','draft-card':'Выбор карты'};
 return (names[a.kind||a.type]||'Действие')+(a.upgrade?' · '+STRAT_UPGRADES[a.upgrade].name:'')+(a.from>=0?' '+sqName(ui.st,a.from):'')+(a.to>=0?' → '+sqName(ui.st,a.to):'');
}
function specialActionCommitted(kind,r,opts={}){
 if(!r?.ok||!ui.st)return false;
 const st=ui.st,mover=r.mover,a=r.action||{},now=performance.now();let spent=0;
 if(ui.mode==='local'&&!ui.bot&&ui.viewPly<ui.frames.length-1){ui.frames=ui.frames.slice(0,ui.viewPly+1);ui.moves=ui.moves.slice(0,ui.viewPly);}
 if(!opts.remote&&ui.running&&ui.timeMs){spent=Math.max(0,now-ui.turnStart);ui.clocks[mover]=Math.max(0,ui.clocks[mover]-spent);}
 const from=Number.isInteger(a.from)?a.from:-1,to=Number.isInteger(a.to)?a.to:from;
 const captured=!!r.record?.captured||r.events?.some(e=>['destroy','death','capture'].includes(e.type));
 const rec={san:specialLabel(kind,r),from,to,color:mover,action:JSON.parse(JSON.stringify(a)),special:kind,spent,at:Date.now(),clock:ui.clocks[mover],captured:!!captured};
 ui.moves.push(rec);ui.lastMove=from>=0&&to>=0?{from,to}:null;ui.frames.push(snap(st,ui.lastMove));ui.viewPly=ui.frames.length-1;
 ui.turnStart=now;ui.running=st.status==='play';ui.selected=-1;ui.hint=null;
  if(!opts.silent){renderAll(false);renderMoves();renderPgnBox();updateNav();}
  if(!opts.remote&&ui.mode==='online'&&ui.online?.started)netPublish({t:'mode-action',kind,action:rec.action,ply:ui.moves.length,hash:netPositionHash(st),cw:ui.clocks.w,cb:ui.clocks.b});
  if(!opts.replay&&!opts.silent)saveCurrentGame();
  const next=()=>{
    if(ui.st!==st)return;
    if(st.status==='over'){if(!opts.silent)finishGame(st.result);return;}
    if(opts.replay||opts.silent)return;
    if(kind==='strategy')strategyMaybeBot();
    else {clearTimeout(ui.specialBotTimer);const seq=ui.moves.length;ui.specialBotTimer=setTimeout(()=>{if(ui.st===st&&ui.moves.length===seq&&!ui.paused&&!ui.away&&!ui.gameLocked&&!ui.battleFxBusy)brawlMaybeBot();},650);}
  };
  if(!opts.silent&&!opts.replay&&typeof battleAnimateAction==='function')battleAnimateAction(kind,r,rec,next);
  else next();
  return true;
}

function applyIncomingSpecial(msg,s=ui.online){
 if(!s?.started||!ui.st||!specialMode()||msg.kind!==specialMode()||!msg.action||!['host','guest'].includes(msg.sender)||!Number.isInteger(msg.ply)||msg.ply<1)return false;
 if(msg.ply<=ui.moves.length){const old=ui.moves[msg.ply-1];return old?.special===msg.kind&&JSON.stringify(old.action)===JSON.stringify(msg.action);}
 if(msg.ply!==ui.moves.length+1){s.specialBuffer||=new Map();if(s.specialBuffer.size<64)s.specialBuffer.set(msg.ply,msg);requestNetworkSync(s,'mode-gap');return false;}
 const expected=msg.sender==='host'?(s.hostColor||'w'):other(s.hostColor||'w');
 if((ui.st.brawl?.draft?.turn||ui.st.turn)!==expected){requestNetworkSync(s,'mode-turn');return false;}
 const before=ui.moves.length;
 if(msg.kind==='strategy')strategyReceiveAction(msg.action,{remote:true});else brawlSubmitAction(msg.action,{remote:true});
 if(ui.moves.length!==before+1){requestNetworkSync(s,'mode-invalid');return false;}
 if(Number.isFinite(msg.cw))ui.clocks.w=msg.cw;if(Number.isFinite(msg.cb))ui.clocks.b=msg.cb;
 if(msg.hash&&msg.hash!==netPositionHash(ui.st))requestNetworkSync(s,'mode-hash');
 let next;while(s.specialBuffer&&(next=s.specialBuffer.get(ui.moves.length+1))){s.specialBuffer.delete(next.ply);if(!applyIncomingSpecial(next,s))break;acknowledgePacket(next,s);}return true;
}
function specialRulesHash(st){
 const src=st.flags.strategy?st.strategy:st.brawl;if(!src)return '';
 const skip=new Set(['attacker','targets','aim','selected','deckKey','deckButtons','suppressCardClick','timer','radTimer','lastCheck','ui','drag','hover','preview','previewTarget','support','recruit','selectedCard','special','hand']);
 const stable=v=>{if(v==null||typeof v!=='object')return v;if(Array.isArray(v))return v.map(stable);const o={};for(const k of Object.keys(v).sort())if(!skip.has(k)&&typeof v[k]!=='function')o[k]=stable(v[k]);return o;};return JSON.stringify(stable(src));
}

function validSpecialState(st) {
  const numeric=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
  const sides=(v,min,max)=>v&&['w','b'].every(c=>numeric(v[c],min,max));
  if(st.flags.strategy){const s=st.strategy;
    if(!s||s.version!==84||!['move','attack'].includes(s.phase)||![0,1].includes(s.phaseSide)||!Number.isInteger(s.seq)||s.seq<0||!numeric(s.round,1,100000)||!sides(s.gold,0,10000)||!numeric(s.cap,1,10000)||!s.hp||!s.shield||!s.moved||!s.territory||!s.influence||!s.upgrades||!s.nukeUsed||!s.factions||!Array.isArray(s.objects)||s.objects.length>10||!Array.isArray(s.rad)||s.rad.length>2||!Array.isArray(s.mines)||s.mines.length>64)return false;
    if(!['w','b'].every(c=>s.upgrades[c]&&['income','arsenal','logistics'].every(k=>Number.isInteger(s.upgrades[c][k])&&s.upgrades[c][k]>=0&&s.upgrades[c][k]<=5)&&typeof s.nukeUsed[c]==='boolean'))return false;
    if(st.board.some(p=>p&&!numeric(s.hp[p.id],0,1000)))return false;
    if(s.objects.some(o=>!Number.isInteger(o.sq)||o.sq<0||o.sq>=st.board.length||!numeric(o.income,0,100)))return false;
  }
  if(st.flags.clashBrawl){const s=st.brawl;
    if(!s||s.version!==84||!Number.isInteger(s.seq)||s.seq<0||!Number.isInteger(s.plies)||s.plies<0||!['develop','battle'].includes(s.phase)||!['upgrade','main','over'].includes(s.stage)||!sides(s.elixir,0,200)||!sides(s.maxByColor,1,200)||!sides(s.income,0,10)||!sides(s.power,0,10000)||!s.decks||!['w','b'].every(c=>Array.isArray(s.decks[c])&&s.decks[c].length<=6&&s.decks[c].every(card=>BRAWL_COST[card.t]===card.cost))||!Array.isArray(s.offer)||s.offer.some(k=>!BRAWL_UPGRADES[k]))return false;
    if(s.upgradeLevels&&!['w','b'].every(c=>s.upgradeLevels[c]&&Object.keys(BRAWL_UPGRADES).every(k=>Number.isInteger(s.upgradeLevels[c][k])&&s.upgradeLevels[c][k]>=0&&s.upgradeLevels[c][k]<=5)))return false;
    if(st.board.some(p=>p&&(!numeric(p.hp,0,1000)||!numeric(p.maxHp,1,1000))))return false;
    if(s.draft&&(!['w','b'].includes(s.draft.turn)||!['ban','pick'].includes(s.draft.step)||!s.draft.pools||!s.draft.picks||!s.draft.bans))return false;
  }
  return true;
}
