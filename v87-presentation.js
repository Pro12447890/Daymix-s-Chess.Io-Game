'use strict';
/* Presentation helpers. Rule calculations and legal move checks are never cached. */
function localFaceToFace() {
  return innerWidth < 1000 && ui.mode === 'local' && !ui.bot && !ui.spectator && !ui.reviewOnly && !ui.training && !ui.imported;
}
function syncLocalSeats() {
  const active = !!ui.st && localFaceToFace();
  document.body.classList.toggle('local-face-to-face', active);
  document.body.classList.toggle('local-seat-clocks', active && !!profile.flip);
  document.body.classList.toggle('local-seat-names', active && !!profile.flipAll);
  if (!active) return;
  ui.orientation = 'w'; ui.rotated = false; ui.tableRotated = false;
  document.body.classList.remove('flip-all');
  $('#board')?.classList.remove('board-rotated');
}
function captureAfterArrival(items) {
  cancelQueenArrival();
  if (!ui.st || profile.calm) { captureFx(items); return; }
  const state = ui.st, ply = ui.moves.length, mover = ui.pieceNodes.get(ui.movedId);
  const token = { state, ply, cancelled:false, ghosts:[], locked:!ui.gameLocked };
  ui.queenArrival = token; ui.gameLocked = true;
  for (const item of items.filter(x => x.type === 'q')) {
    const ghost = document.createElement('div'), pos = disp(state, item.square);
    ghost.className = 'piece queen-arrival-ghost ' + item.color;
    ghost.innerHTML = pieceSvg('q'); ghost.style.width = ui.sq+'px'; ghost.style.height=ui.sq+'px';
    ghost.style.transform=`translate(${pos.dx*ui.sq}px,${pos.dy*ui.sq}px)`;
    ghost.style.zIndex='9'; $('#pieces').appendChild(ghost); token.ghosts.push(ghost);
  }
  const impact = () => {
    if (token.cancelled || ui.queenArrival !== token || ui.st !== state || ui.moves.length !== ply) return;
    token.ghosts.forEach(el=>el.remove()); ui.queenArrival=null;
    captureFx(items);
    if (!queenDrama.timer && token.locked) { ui.gameLocked=false; if(state.status==='play')maybeBotTurn(); }
  };
  // Flush the move transition, then wait for its actual end, not for an arbitrary instant.
  requestAnimationFrame(() => {
    if(token.cancelled)return;
    const travel = mover?.getAnimations?.().filter(a => a.transitionProperty === 'transform') || [];
    if (travel.length) Promise.all(travel.map(a=>a.finished.catch(()=>{}))).then(impact);
    else requestAnimationFrame(impact); // dragged pieces are already at their destination
  });
}
function cancelQueenArrival() {
  const token=ui.queenArrival;if(!token)return;
  token.cancelled=true;token.ghosts.forEach(el=>el.remove());
  if(token.state===ui.st&&token.locked)ui.gameLocked=false;
  ui.queenArrival=null;
}
const DRAW_RULE_MODES = new Set(['classic','blackFirst','mirror','noCastling','asymmetric960','chess960','fischer']);
function canonicalDrawKey(st) {
  if (!st || !DRAW_RULE_MODES.has(st.modeId)) return null;
  const rights=[];
  for(const c of ['w','b'])for(const flank of ['k','q']) {
    const id=st.castling[c][flank],sq=id==null?-1:st.board.findIndex(p=>p?.id===id);
    rights.push(sq);
  }
  // En-passant matters to repetition only when it is a legal option (including king safety).
  const ep=st.ep>=0&&legalMoves(st,st.turn).some(m=>m.ep)?st.ep:-1;
  return st.modeId+'|'+st.board.map(p=>p?p.c+p.t:'.').join(',')+'|'+st.turn+'|'+rights.join(',')+'|'+ep;
}
function repeatedPositionResult(st, frames) {
  const key=canonicalDrawKey(st);if(!key)return null;
  let count=1;
  const start=Math.max(0,frames.length-(st.half||0));
  for(let i=start;i<frames.length;i++) {
    const f=frames[i],saved=f.repetitionKey || canonicalDrawKey({...st,...f});
    if(saved===key&&++count>=3) {
      st.status='over';return st.result={winner:null,reason:'repetition'};
    }
  }
  return null;
}
function renderDrawProgress() {
  $('#repRing')?.classList.add('hidden');
  const board=$('#board');if(!board)return;
  let layer=$('#drawProgress');
  if(!layer){layer=document.createElement('div');layer.id='drawProgress';board.appendChild(layer);}
  layer.innerHTML='';
  const st=viewState();
  if(!st||!DRAW_RULE_MODES.has(st.modeId)||st.status!=='play')return;
  const ply=Math.min(ui.viewPly,ui.moves.length),frame=ui.frames[ply];
  const half=frame?.half ?? st.half ?? 0;
  if(!half)return;
  const remaining=Math.max(0,100-half),moves=Math.ceil(remaining/2),progress=Math.min(1,half/100);
  for(const color of ['w','b']) {
    let count=0,id=null;
    for(let i=ply-1;i>=0;i--) {
      const move=ui.moves[i];if(move.color!==color)continue;
      const piece=ui.frames[i]?.board[move.from];if(!piece)break;
      if(id==null)id=piece.id;
      if(piece.id!==id)break;
      if(++count>=3)break;
    }
    if(count<3)continue;
    const sq=findKing(st,color);if(sq<0)continue;
    const pos=disp(st,sq),ring=document.createElement('div');ring.className='draw-progress-ring '+color;
    ring.style.left=pos.dx*ui.sq+'px';ring.style.top=pos.dy*ui.sq+'px';
    ring.style.width=ui.sq+'px';ring.style.height=ui.sq+'px';
    const en=profile.language==='en';
    ring.title=en?`${moves} full moves (${remaining} plies) until the 50-move draw; pawn moves and captures reset it. Stalemate is separate.`:`До ничьей по правилу 50 ходов: ${moves} полных ходов (${remaining} полуходов). Пешка или взятие сбрасывает счётчик. Это не пат.`;
    ring.setAttribute('aria-label',ring.title);
    ring.innerHTML=`<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="draw-track" cx="50" cy="50" r="44"/><circle class="draw-fill" cx="50" cy="50" r="44" pathLength="100" stroke-dasharray="${progress*100} 100" transform="rotate(-90 50 50)"/></svg><span>${moves}<small>${en?'to draw':'до ничьей'}</small></span>`;
    layer.appendChild(ring);
  }
}
(function setupV87Presentation(){
  const board=renderBoard;renderBoard=function(...args){syncLocalSeats();board(...args);renderDrawProgress();};
  const players=renderPlayers;renderPlayers=function(...args){syncLocalSeats();return players(...args);};
  const start=newGame;newGame=function(...args){cancelQueenArrival();return start(...args);};
  const load=importGameData;importGameData=function(...args){cancelQueenArrival();return load(...args);};
  const history=gotoPly;gotoPly=function(...args){cancelQueenArrival();return history(...args);};
  const screen=showScreen;showScreen=function(name){if(name!=='game')cancelQueenArrival();return screen(name);};
  document.addEventListener('DOMContentLoaded',()=>{
    for(const id of ['optFlip','gFlip','optFlipAll'])$('#'+id)?.addEventListener('change',()=>{syncLocalSeats();if(ui.st){renderBoard(false);renderPlayers();}});
    const labels={optFlip:['Поворачивать часы чёрных к второму игроку','Face Black’s clock toward the second player'],gFlip:['Часы к второму игроку','Face clock toward second player'],optFlipAll:['Поворачивать ник чёрных к второму игроку','Face Black’s name toward the second player']};
    for(const [id,text] of Object.entries(labels)){const label=$('#'+id)?.parentElement.querySelector('span');if(label)label.textContent=text[profile.language==='en'?1:0];}
  });
})();
