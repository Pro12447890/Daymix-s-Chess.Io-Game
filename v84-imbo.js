'use strict';
/* Shared session adapter for board variants. Host validates actions; guests never publish arbitrary state. */
const imboV83 = {start:imboStart, render:imboRenderAll, canAct:imboCanAct, panels:imboUpdatePanels, handle:handleImboNet, down:imboDodgeDown, up:imboDodgeUp};
function imboActor(){return ui.imboMode==='online'?ui.imboSide:ui.imbo?.turn;}
function imboCancelPending(){clearTimeout(ui.imboPendingTimer);ui.imboPendingTimer=0;ui.imboPending=null;}
stopImboGame=function(){const g=ui.imbo;if(g?.raf)cancelAnimationFrame(g.raf);if(g)g.raf=0;clearTimeout(ui.imboBotTimer);ui.imboBotTimer=0;imboCancelPending();ui.imboBusy=false;};
imboStart=function(kind,variant,opts={}){
  stopImboGame();if(ui.st){ui.running=false;clearInterval(ui.timer);stopBotWorker();stopBrawl();stopStrategy();}
  ui.imboFrames=[];ui.imboView=0;
  imboV83.start(kind,variant,opts);const g=ui.imbo;if(!g)return;
  g.seq=0;ui.imboFrames=[VariantEngine.serialize(g)];ui.imboView=0;ui.imboHistoryOpen=true;ui.imboChatOpen=false;
  showScreen('imbo');imboRenderAll();if(g.kind==='dodgeball')imboDodgeLoop();
};
imboCanAct=function(){return !!(imboV83.canAct()&&!ui.imboPending&&(ui.imboView==null||ui.imboView===(ui.imboFrames?.length||1)-1));};
function imboExecute(action,actor){
  const g=ui.imbo;if(!g||g.over||g.turn!==actor||!action||typeof action!=='object')return null;
  let res=null,text='';
  if(action.kind==='move'&&Number.isInteger(action.from)&&Number.isInteger(action.to))res=VariantEngine.apply(g,action.from,action.to);
  else if(action.kind==='roll'&&g.kind==='backgammon'){const dice=VariantEngine.roll(g);if(dice){res={ok:true};text='Кости: '+dice.join(' · ');}}
  else if(action.kind==='pass'&&g.kind==='backgammon'){if(VariantEngine.pass(g)){res={ok:true};text='Нет ходов — передача';}}
  else if(action.kind==='shoot'&&g.kind==='dodgeball'&&Number.isInteger(action.index)&&Number.isFinite(action.dx)&&Number.isFinite(action.dy)){
    if(VariantEngine.shoot(g,action.index,action.dx,action.dy,Date.now())){res={ok:true};text='Удар '+(actor==='w'?'белых':'чёрных');}
  }else if(action.kind==='ready'&&g.kind==='dodgeball'){if(VariantEngine.ready(g)){res={ok:true};text='Расстановка завершена';}}
  else if(action.kind==='swap'&&g.kind==='dodgeball'&&g.phase==='setup'){
    if(g.discs[action.a]?.team!==actor||g.discs[action.b]?.team!==actor)return null;
    if(VariantEngine.swap(g,action.a,action.b)){res={ok:true};text='Перестановка';}
  }else if(action.kind==='count'&&g.kind==='dodgeball'&&g.phase==='setup'&&Number.isInteger(action.count)&&action.count>=4&&action.count<=12){if(VariantEngine.setCount(g,action.count)){res={ok:true};text='Состав: '+g.count;}}
  if(!res?.ok)return null;
  g.seq=(g.seq||0)+1;
  if(action.kind==='move')imboPushHistory(res,actor);else ui.imboHistory.push({n:ui.imboHistory.length+1,color:actor,text,capture:false});
  ui.imboFrames=ui.imboFrames||[];ui.imboFrames.push(VariantEngine.serialize(g));ui.imboView=ui.imboFrames.length-1;
  imboRenderAll();if(g.kind==='dodgeball'&&action.kind==='ready')imboDodgeLoop();if(action.kind==='move')imboAnimate(res,null);
  imboSyncState();if(!g.over)imboMaybeBot();return res;
}
function imboSubmit(action,opts={}){
  const g=ui.imbo;if(!g||(!opts.bot&&!imboCanAct())){if(!opts.bot)imboTurnWarn();return null;}
  if(ui.imboMode==='online'&&ui.online?.role==='guest'){
    const id=ui.online.clientId+'-'+Date.now()+'-'+(g.seq||0);ui.imboPending={id,baseSeq:g.seq||0,action};
    netPublish({t:'imbo-action',requestId:id,baseSeq:g.seq||0,action});
    ui.imboPendingTimer=setTimeout(()=>{if(ui.imboPending?.id===id)netPublish({t:'imbo-sync-request'});},4500);
    imboModeUi();return {ok:true,pending:true};
  }
  const res=imboExecute(action,g.turn);if(!res&&!opts.bot)toast('Это действие недоступно. Проверьте подсветку и правила.');return res;
}
imboApplyMove=function(from,to,opts={}){return imboSubmit({kind:'move',from,to},opts);};
imboMaybeBot=function(){
  const g=ui.imbo;if(ui.imboMode!=='bot'||!g||g.over||!ui.imboBot||g.turn!==ui.imboBot.color||ui.imboBotTimer||ui.screen!=='imbo')return;
  if(g.kind==='dodgeball'&&g.phase!=='aim')return;
  const seq=g.seq;ui.imboBusy=true;
  ui.imboBotTimer=setTimeout(()=>{ui.imboBotTimer=0;ui.imboBusy=false;if(ui.imbo!==g||g.over||g.seq!==seq||ui.imboMode!=='bot')return;
    if(g.kind==='dodgeball'){const shot=VariantEngine.botShot(g);if(shot)imboSubmit({kind:'shoot',...shot},{bot:true});return;}
    const choice=VariantEngine.botMove(g,ui.imboBot.level);if(!choice)return;
    imboSubmit(choice.type==='move'?{kind:'move',from:choice.move.from,to:choice.move.to}:{kind:choice.type},{bot:true});
  },450);
};
imboSyncState=function(){
  const s=ui.online,g=ui.imbo;if(!s?.imbo||!s.started||!g||s.role!=='host')return;
  netPublish({t:'imbo-state',state:VariantEngine.serialize(g),history:ui.imboHistory,seq:g.seq||0,ackRequest:s.imboAck||null});
};
function imboAcceptSnapshot(msg,initial=false){
  const session=ui.online;if(!session?.imbo||session.role!=='guest'||msg.sender!=='host')return false;
  const g=VariantEngine.deserialize(msg.state);if(!g||!Number.isInteger(g.seq)||g.seq<0)return false;
  if(!Array.isArray(msg.history)||msg.history.length>4096)return false;
  if(!initial&&ui.imbo&&g.kind!==ui.imbo.kind)return false;
  if(!initial&&g.seq<(ui.imbo?.seq||0))return false;
  if(!initial&&g.seq===(ui.imbo?.seq||0)){
    if(ui.imboPending&&(msg.ackRequest===ui.imboPending.id||msg.syncReply))imboCancelPending();return true;
  }
  stopImboGame();ui.imbo=g;ui.imboMode='online';ui.imboSide='b';ui.imboBot=null;ui.imboResult=null;ui.imboBusy=false;ui.imboBursts=[];
  ui.imboHistory=msg.history.map(m=>({n:Number(m.n)||0,color:m.color==='b'?'b':'w',text:String(m.text||'').slice(0,180),capture:!!m.capture}));
  if(initial)ui.imboFrames=[];ui.imboFrames=ui.imboFrames||[];ui.imboFrames.push(VariantEngine.serialize(g));ui.imboView=ui.imboFrames.length-1;
  imboResetView(imboTitle(g));imboModeUi();imboRenderAll();showScreen('imbo');if(g.kind==='dodgeball')imboDodgeLoop();return true;
}
handleImboNet=function(msg){
  const s=ui.online;if(!s?.imbo)return;
  if(msg.t==='imbo-start'&&s.role==='guest'){
    if(s.started&&s.sid!==msg.sid)return;
    if(!imboAcceptSnapshot(msg,!s.started))return;
    s.sid=msg.sid;s.started=true;s.names=msg.names||{w:'Хозяин',b:profile.name};clearInterval(s.joinTimer);startNetHeartbeat(s);imboModeUi();return;
  }
  if(msg.t==='imbo-state'){imboAcceptSnapshot(msg);return;}
  if(msg.t==='imbo-action'&&s.role==='host'&&s.started&&msg.sender==='guest'){
    if(msg.baseSeq!==(ui.imbo?.seq||0)||ui.imbo?.turn!=='b'){s.imboAck=msg.requestId;imboSyncState();return;}
    s.imboAck=msg.requestId;const result=imboExecute(msg.action,'b');if(!result)imboSyncState();return;
  }
  if(msg.t==='imbo-sync-request'&&s.role==='host'&&s.started){netPublish({t:'imbo-state',state:VariantEngine.serialize(ui.imbo),history:ui.imboHistory,seq:ui.imbo.seq||0,syncReply:true,ackRequest:s.imboAck||null});return;}
  if(msg.t==='imbo-join'&&s.role==='host'&&s.started){netPublish({t:'imbo-start',state:VariantEngine.serialize(ui.imbo),history:ui.imboHistory,names:s.names,kind:ui.imbo.kind});return;}
  imboV83.handle(msg);if(s.started)startNetHeartbeat(s);
};
imboDodgeDown=function(e){
  const g=ui.imbo;if(!g||g.kind!=='dodgeball'||g.over)return;
  if(g.phase==='setup'){if(!imboCanAct())return;const i=imboDodgeNearest(imboDodgeLocal(e),g.turn);if(i<0)return;if(g.setupSel==null)g.setupSel=i;else{const a=g.setupSel;g.setupSel=null;imboSubmit({kind:'swap',a,b:i});}imboDodgeDraw();return;}
  imboV83.down(e);if(g.drag){g.drag.pointerId=e.pointerId;try{e.currentTarget.setPointerCapture(e.pointerId);}catch(_){}}
};
imboDodgeUp=function(e){const g=ui.imbo,d=g?.drag;if(!d)return;if(d.pointerId!=null&&e.pointerId!=null&&d.pointerId!==e.pointerId)return;g.drag=null;try{e.currentTarget.releasePointerCapture(e.pointerId);}catch(_){}if(e.type==='pointercancel'||e.type==='lostpointercapture'){imboDodgeDraw();return;}if(!imboCanAct()){imboDodgeDraw();return;}imboSubmit({kind:'shoot',index:d.index,dx:d.x0-d.x1,dy:d.y0-d.y1});imboDodgeDraw();};
imboDodgeLoop=function(){
  const g=ui.imbo;if(!g||g.kind!=='dodgeball'||g.over||ui.screen!=='imbo')return;
  if(g.raf)cancelAnimationFrame(g.raf);const now=performance.now(),dt=g.lastFrameAt?Math.max(0,(now-g.lastFrameAt)/1000):0;g.lastFrameAt=now;
  const oldPhase=g.phase,oldTurn=g.turn;
  if(!document.hidden&&!g.awaitingHost)VariantEngine.step(g,dt,Date.now());
  if((oldPhase==='settle'&&g.phase!=='settle')||(!g._reportedOver&&g.over)){
    if(ui.imboMode!=='online'||ui.online?.role==='host'){g.seq=(g.seq||0)+1;ui.imboFrames.push(VariantEngine.serialize(g));ui.imboView=ui.imboFrames.length-1;imboSyncState();}
    else {g.phase='settle';g.turn=oldTurn;g.over=false;g.awaitingHost=true;}
  }
  VariantEngine.status(g);imboDodgeHud();imboDodgeDraw();if(g.over){g._reportedOver=true;imboCheckFinish();}else{imboMaybeBot();g.raf=requestAnimationFrame(imboDodgeLoop);}
};
imboRenderAll=function(){imboV83.render();imboSharedControls();};
function imboSharedControls(){
  const g=ui.imbo;if(!g)return;
  v84ReactionBar($('#imboPlay .imbo-modebar'));
  let help=$('#imboRules');if(!help){help=document.createElement('details');help.id='imboRules';help.className='imbo-rules';$('#imboPlay .imbo-modebar').after(help);}
  const rules={checkers:g.variant==='intl'?'Международные: бой обязателен, выбирайте цепочку с наибольшим числом взятий. Простые бьют назад, дамки летают. Превращение — в конце хода.':'Русские: бой обязателен, простые бьют назад. Если добрался до последней линии во время боя — продолжай как дамка. Выбор цепочки свободный.',backgammon:'Короткие нарды: брось кости, используй обе, если возможно. При доступной только одной — старшую. Одиночную чужую шашку можно сбить на бар. Сначала верни шашки с бара. Собери все 15 в свой дом, затем вынеси их.',corners:'Переведи все 9 фигур в противоположный угол. Шаг на соседнюю клетку или цепочка прыжков через любые фигуры. Подсвечены все конечные клетки; взятий нет.',dodgeball:'Потяни свою шашку назад и отпусти. Отмена касания не стреляет. Очередь сменится не раньше 2 секунд с удара; если полёт длиннее — через 0,5 с после остановки. Времени на прицеливание достаточно.'};
  const key=g.kind+g.variant;if(help.dataset.kind!==key){help.innerHTML='<summary>Как играть</summary><p></p>';help.querySelector('p').textContent=rules[g.kind];help.dataset.kind=key;}
  let bar=$('#imboSharedBar');if(!bar){bar=document.createElement('div');bar.id='imboSharedBar';bar.className='imbo-shared-bar';$('#imboPlay .imbo-modebar').appendChild(bar);
    for(const [label,fn] of [['‹',()=>imboHistoryJump(-1)],['›',()=>imboHistoryJump(1)],['📤 JSON',imboExport],['📥 Импорт',imboImport],['⚙ Настройки',()=>{ui.prevScreen='imbo';showScreen('settings');}]]){const b=document.createElement('button');b.type='button';b.className='btn btn-sm';b.textContent=label;b.onclick=fn;bar.appendChild(b);}
  }
  bar.children[0].disabled=ui.imboMode!=='local'||!(ui.imboView>0)||g.phase==='settle';bar.children[1].disabled=ui.imboMode!=='local'||ui.imboView>=(ui.imboFrames?.length||0)-1;

}
function imboHistoryJump(delta){if(ui.imboMode!=='local'||ui.imbo?.phase==='settle')return;const n=Math.max(0,Math.min(ui.imboFrames.length-1,(ui.imboView||0)+delta));if(n===ui.imboView)return;stopImboGame();ui.imbo=VariantEngine.deserialize(ui.imboFrames[n]);ui.imboView=n;ui.imboResult=null;$('#imboResult')?.classList.add('hidden');imboRenderAll();if(ui.imbo.kind==='dodgeball')imboDodgeLoop();}
function imboExport(){const data={app:'daymix-variant',version:1,state:VariantEngine.serialize(ui.imbo),history:ui.imboHistory,frames:ui.imboFrames};const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));a.href=url;a.download='daymix-'+ui.imbo.kind+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function imboImport(){const input=document.createElement('input');input.type='file';input.accept='.json';input.onchange=async()=>{try{const file=input.files[0];if(!file||file.size>3000000)throw Error();const d=JSON.parse(await file.text()),g=VariantEngine.deserialize(d.state);if(d.app!=='daymix-variant'||!g)throw Error();if(ui.online)leaveOnline(true);stopImboGame();ui.imbo=g;ui.imboMode='local';ui.imboBot=null;ui.imboFrames=(d.frames||[d.state]).filter(f=>VariantEngine.deserialize(f));ui.imboView=ui.imboFrames.length-1;ui.imboHistory=Array.isArray(d.history)?d.history:[];ui.imboResult=null;imboResetView(imboTitle(g));imboRenderAll();if(g.kind==='dodgeball')imboDodgeLoop();}catch(_){toast('Не удалось прочитать сохранение Имбовинок');}};input.click();}
