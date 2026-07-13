// the Riddle – klient. All fasit og flyt ligger bak en Cloudflare Worker (server-side).
// Ingen svar, tokens eller hemmeligheter i denne filen.
const API = 'https://riddle-api.cheggen.workers.dev';

var canvas, context, content, loader;
var refreshTimer = null;      // nedtellings-intervall
var matrixTimer = null;
var currentTask = '';
var currentType = '';
var currentT0 = '';
var busy = false;

document.addEventListener('DOMContentLoaded', function () {
  prepareCanvasAndDiv();
  loadState();
});

function prepareCanvasAndDiv(){
  canvas = document.getElementById('Matrix');
  context = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  content = document.getElementById('content');
  loader = document.getElementById('loader');
  loader.style.display = 'none';
  window.addEventListener('resize', function(){
    canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  });
}

// ---------- Hent tilstand fra serveren ----------
async function loadState(){
  stopCountdown();
  try{
    const s = await fetch(API + '/state', { cache:'no-store' }).then(r=>r.json());
    currentTask = s.task; currentType = s.type;
    if(s.type === 'final'){ window.location.href = s.redirect || 'thePrice'; return; }
    if(s.type === 'countdown'){ currentT0 = s.countdownTo; currentOrd = s.ord || ''; runCountdown(); return; }
    if(s.type === 'question'){ presentInputUI(s.question || '', s.hint || ''); return; }
    content.innerHTML = '<div class="timer">…</div>';
  }catch(e){
    content.innerHTML = '<div class="timer">…</div>';
    setTimeout(loadState, 4000);
  }
}

// ---------- Nedtelling ----------
function runCountdown(){
  showContentField();
  updateTimer();
  refreshTimer = setInterval(updateTimer, 1000);
}
function stopCountdown(){ if(refreshTimer){ clearInterval(refreshTimer); refreshTimer = null; } }
var lostAnimating = false;
var lastLostVal = null;
var lostTimers = [];
var currentOrd = '';
var lostRAF = 0;
// ---------- Odometer-rulle (fungerer med baade sifre, bokstaver og *) ----------
var cells = [], cellCount = 0;
function getFlip(){
  let f = content.querySelector('.flip');
  if(!f){ content.innerHTML = '<div class="flip"></div>'; f = content.querySelector('.flip'); cellCount = 0; cells = []; }
  return f;
}
function ensureCells(n, lost){
  const f = getFlip();
  f.classList.toggle('lost', !!lost);
  if(cellCount !== n){
    let h = '';
    for(let i = 0; i < n; i++) h += '<div class="cell"><div class="reel"><div class="g"></div></div></div>';
    f.innerHTML = h;
    cells = [];
    f.querySelectorAll('.cell').forEach(function(el){ cells.push({ el: el, reel: el.querySelector('.reel'), cur: null }); });
    cellCount = n;
  }
}
// Rull en celle til target. spin = antall mellomtegn som ruller forbi (odometer-effekt).
function rollTo(c, target, o){
  o = o || {};
  const dur = o.dur || 550, spin = o.spin || 0, fill = o.fill || '0123456789';
  const delay = o.delay || 0, easing = o.easing || 'cubic-bezier(0,0,.2,1)';
  const seq = [ c.cur == null ? target : c.cur ];
  for(let i = 0; i < spin; i++) seq.push(fill[Math.floor(Math.random() * fill.length)]);
  seq.push(target);
  c.cur = target;
  c.reel.style.transition = 'none';
  c.reel.innerHTML = seq.map(function(ch){ return '<div class="g">' + esc(ch) + '</div>'; }).join('');
  c.reel.style.transform = 'translateY(0)';
  const gH = c.reel.firstChild.offsetHeight || c.el.clientHeight || 1;   // eksakt glyfhoyde
  const end = -(seq.length - 1) * gH;
  const go = function(){
    c.reel.style.transition = 'transform ' + dur + 'ms ' + easing;
    c.reel.style.transform = 'translateY(' + end + 'px)';
  };
  if(delay) setTimeout(go, delay); else requestAnimationFrame(go);
  clearTimeout(c._t);
  c._t = setTimeout(function(){
    c.reel.style.transition = 'none';
    c.reel.innerHTML = '<div class="g">' + esc(target) + '</div>';
    c.reel.style.transform = 'translateY(0)';
  }, dur + delay + 60);
}
// Vanlig nedtelling: rull hvert siffer som endrer seg.
function visTid(txt, lost){
  const str = String(txt);
  ensureCells(str.length, lost);
  for(let i = 0; i < str.length; i++){
    if(cells[i].cur !== str[i]) rollTo(cells[i], str[i], { dur: 820, spin: 0 });
  }
}
function secsIgjen(){
  const future = Date.parse((currentT0 || '').replace(/&#58;/g, ':'));
  return Math.floor((future - Date.now()) / 1000);
}
function updateTimer(){
  const future = Date.parse((currentT0 || '').replace(/&#58;/g, ':'));
  const diff = future - Date.now();
  if(diff <= 1000){
    stopCountdown();
    loadState();
    return;
  }
  if(lostAnimating) return;                 // ikke overskriv mens animasjonen kjører
  const s = Math.floor(diff / 1000);
  visTid(String(s), false);
  // hver gang telleren treffer et tall som slutter på to nuller
  if(s % 100 === 0 && s !== lastLostVal){
    lastLostVal = s;
    lostAnim();
  }
}
function lostAnim(){
  // Reel-animasjon. Runde 1: avslor skjult ord (h->v). Runde 2: spinn tilbake til
  // nedtellingen (h->v); hvert siffer teller live saa snart det lander.
  lostAnimating = true;
  lostTimers.forEach(clearTimeout); lostTimers = [];
  cancelAnimationFrame(lostRAF);

  const startStr = String(Math.max(0, secsIgjen()));
  const W = startStr.length;
  ensureCells(W, true);
  const H = cells[0].el.getBoundingClientRect().height || 1;

  const DIG = '0123456789';
  const LET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const BASE = DIG + LET;                 // felles spinnsett (ingen mellomrom -> ingen "blank"-glimt)
  const ACC = 0.55, DEC = 0.95, VMAX = 26, STAG = 0.5, CRUISE = 0.5, HOLD = 0.9;

  function ordMaal(){
    let w = (currentOrd || '').trim().toUpperCase();
    if(!w) return null;
    if(W >= w.length){ const pad = W - w.length, lp = Math.floor(pad/2); return (' '.repeat(lp) + w + ' '.repeat(pad-lp)).split(''); } // blanke ruter (ingen *)
    return w.slice(0, W).split('');
  }
  function liveStr(){
    const b = String(Math.max(0, secsIgjen()));
    return (' '.repeat(Math.max(0, W - b.length)) + b).slice(-W).split('');
  }
  function cruise(pl, tt){
    let p = pl.pos0;
    if(tt <= pl.tStart) return p;
    const a = Math.min(tt, pl.tStart + ACC) - pl.tStart;
    if(a > 0) p += 0.5 * (VMAX/ACC) * a * a;
    if(tt > pl.tStart + ACC) p += VMAX * (tt - (pl.tStart + ACC));
    return p;
  }
  function alignFinal(pl){
    let baseP = pl.pDecel + VMAX * DEC * 0.45;
    let fp = Math.ceil(baseP);
    fp += (((pl.idx - (fp % pl.n)) % pl.n) + pl.n) % pl.n;
    return fp;
  }
  function posAt(pl, tt){
    if(tt < pl.tDecel || pl.finalPos == null) return cruise(pl, Math.min(tt, pl.tDecel));
    const u = Math.min(1, (tt - pl.tDecel)/DEC);
    const e = 1 - Math.pow(1 - u, 3);
    return pl.pDecel + (pl.finalPos - pl.pDecel) * e;
  }
  function buildStrip(pl){
    pl.reel.style.transition = 'none';
    pl.reel.innerHTML = (pl.set + pl.set).split('').map(function(ch){ return '<div class="g">' + esc(ch) + '</div>'; }).join('');
  }
  function setY(pl, pos){
    const off = ((pos % pl.n) + pl.n) % pl.n;
    pl.reel.style.transition = 'none';
    pl.reel.style.transform = 'translateY(' + (-off * H) + 'px)';
  }
  function plan(c, i, tgt, initial){
    const rank = W - 1 - i;
    let set = BASE;
    if(tgt != null && set.indexOf(tgt) < 0) set += tgt;
    if(initial != null && set.indexOf(initial) < 0) set += initial;
    const pl = { c:c, reel:c.reel, set:set, n:set.length, tgt:tgt, idx:(tgt!=null?set.indexOf(tgt):0),
                 pos0:0, tStart:rank*STAG, tDecel:(W-1)*STAG+ACC+CRUISE+rank*STAG,
                 pDecel:null, finalPos:null, live:false, liveShown:null };
    if(initial != null){ const ii = set.indexOf(initial); if(ii >= 0) pl.pos0 = ii; }
    return pl;
  }

  const word = ordMaal();
  const cycEnd = (W-1)*STAG + ACC + CRUISE + (W-1)*STAG + DEC;
  const cyc2Start = word ? (cycEnd + HOLD) : 0;

  // Runde 1: fra naavaerende siffer -> skjult ord (sommlos start: tegn straks paa pos0)
  let cyc1 = null;
  if(word){
    cyc1 = cells.map(function(c,i){ return plan(c, i, word[i], startStr[i]); });
    cyc1.forEach(function(pl){ pl.pDecel = cruise(pl, pl.tDecel); pl.finalPos = alignFinal(pl); buildStrip(pl); setY(pl, pl.pos0); });
  }

  let cyc2 = null;
  function buildCyc2(){
    const init = word ? word : startStr.split('');     // fortsett fra det som vises (ingen hopp til 0)
    cyc2 = cells.map(function(c,i){ return plan(c, i, null, init[i]); });
    cyc2.forEach(function(pl){ buildStrip(pl); setY(pl, pl.pos0); });
  }

  const t0 = performance.now();
  function frame(now){
    const t = (now - t0) / 1000;
    if(cyc1 && t < cyc2Start){
      cyc1.forEach(function(pl){ setY(pl, posAt(pl, t)); });
      lostRAF = requestAnimationFrame(frame); return;
    }
    if(!cyc2) buildCyc2();
    const t2 = t - cyc2Start;
    const ls = liveStr();
    let allLive = true;
    cyc2.forEach(function(pl, i){
      if(pl.live){
        const d = ls[i];
        if(d !== pl.liveShown){
          pl.liveShown = d;
          if(pl.set.indexOf(d) < 0){ pl.set += d; buildStrip(pl); }
          const idx = pl.set.indexOf(d);
          pl.reel.style.transition = 'transform .45s cubic-bezier(0,0,.2,1)';
          pl.reel.style.transform = 'translateY(' + (-idx * H) + 'px)';
        }
        return;
      }
      allLive = false;
      if(t2 >= pl.tDecel && pl.finalPos == null){
        pl.pDecel = cruise(pl, pl.tDecel);
        const d = ls[i];
        if(pl.set.indexOf(d) < 0){ pl.set += d; buildStrip(pl); }
        pl.tgt = d; pl.idx = pl.set.indexOf(d);
        pl.finalPos = alignFinal(pl);
      }
      setY(pl, posAt(pl, t2));
      if(pl.finalPos != null && t2 >= pl.tDecel + DEC){ pl.live = true; pl.liveShown = pl.tgt; }
    });
    if(allLive){
      lostAnimating = false;
      lastLostVal = secsIgjen();
      cells.forEach(function(c, i){ c.cur = (cyc2[i] ? cyc2[i].liveShown : null); });
      const f = content.querySelector('.flip'); if(f) f.classList.remove('lost');
      return;    // normal refreshTimer overtar neste sekund (ingen full rebuild -> ingen hopp)
    }
    lostRAF = requestAnimationFrame(frame);
  }
  lostRAF = requestAnimationFrame(frame);
}

// ---------- Spørsmål ----------
function presentInputUI(question, hint){
  showContentField();
  content.innerHTML =
    '<label id="questionLabel">' + esc(question) + '</label>' +
    '<input type="text" id="inputField" autofocus>' +
    '<div class="bar"></div>' +
    '<label id="hintLabel">' + esc(hint) + '</label>';
  const node = document.getElementById('inputField');
  node.focus();
  node.addEventListener('keyup', function(event){
    if(event.key !== 'Enter' || busy) return;
    const answer = node.value.trim();
    if(answer.toLowerCase() === 'matrix'){ runTheMatrix(); return; }
    if(!answer) return;
    sendAnswer(answer);
  });
}

async function sendAnswer(answer){
  busy = true;
  hideContentField();
  showLoader();
  try{
    const res = await fetch(API + '/answer', {
      method:'POST', headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({ answer })
    }).then(r=>r.json());
    hideLoader();
    if(res && res.correct){ correctAnswer(); }
    else { wrongAnswer(); }
  }catch(e){
    hideLoader();
    wrongAnswer();
  }
}

function correctAnswer(){
  turnCanvasGreen();
  setTimeout(function(){
    busy = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    loadState();               // henter neste steg (nedtelling) fra serveren
  }, 3000);
}
function wrongAnswer(){
  turnCanvasRed();
  setTimeout(function(){
    busy = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    showContentField();
    const f = document.getElementById('inputField');
    if(f){ f.value = ''; f.focus(); }
  }, 1600);
}

// ---------- Effekter ----------
function turnCanvasRed(){ context.fillStyle = '#FF0000'; context.fillRect(0,0,canvas.width,canvas.height); }
function turnCanvasGreen(){ context.fillStyle = '#008000'; context.fillRect(0,0,canvas.width,canvas.height); }
function hideContentField(){ content.style.display = 'none'; }
function showContentField(){ content.style.display = 'block'; }
function hideLoader(){ loader.style.display = 'none'; }
function showLoader(){ loader.style.display = 'block'; }
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ---------- Matrix-easter-egg ----------
function runTheMatrix(){
  if(matrixTimer) return;
  const katakana = 'アァカサタナハマヤャラワガザダバパイィキシチニヒミリヰギジヂビピウゥクスツヌフムユュルグズブヅプエェケセテネヘメレヱゲゼデベペオォコソトノホモヨョロヲゴゾドボポヴッン';
  const latin = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const nums = '0123456789';
  const alphabet = katakana + latin + nums;
  const fontSize = 16;
  const columns = canvas.width / fontSize;
  const rainDrops = [];
  for(let x = 0; x < columns; x++) rainDrops[x] = 1;
  const draw = () => {
    context.fillStyle = 'rgba(0, 0, 0, 0.05)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#0F0';
    context.font = fontSize + 'px monospace';
    for(let i = 0; i < rainDrops.length; i++){
      const text = alphabet.charAt(Math.floor(Math.random() * alphabet.length));
      context.fillText(text, i * fontSize, rainDrops[i] * fontSize);
      if(rainDrops[i] * fontSize > canvas.height && Math.random() > 0.975) rainDrops[i] = 0;
      rainDrops[i]++;
    }
  };
  matrixTimer = setInterval(draw, 30);
}
