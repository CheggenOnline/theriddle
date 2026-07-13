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
    if(s.type === 'countdown'){ currentT0 = s.countdownTo; runCountdown(); return; }
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
  const delay = o.delay || 0, easing = o.easing || 'cubic-bezier(.16,.84,.22,1)';
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
    if(cells[i].cur !== str[i]) rollTo(cells[i], str[i], { dur: 550, spin: 0 });
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
  // Odometer-sekvens: alle sifre ruller -> en og en ruller gjennom bokstaver/
  // spesialtegn og lander paa "riddle" (ekstra ruter -> "*") -> holdes ~1 s ->
  // ruller tilbake og lander paa naavaerende nedtelling.
  lostAnimating = true;
  const startStr = String(Math.max(0, secsIgjen()));
  let W = Math.max(startStr.length, 6);
  if((W - 6) % 2 === 1) W++;                       // symmetrisk *-padding
  const lp = (W - 6) / 2, rp = W - 6 - lp;
  const word = ('*'.repeat(lp) + 'riddle' + '*'.repeat(rp)).split('');
  const DIG = '0123456789';
  const ALP = 'abcdefghijklmnopqrstuvwxyz*!?#@&';
  ensureCells(W, true);

  // Fase 1: alle ruller tall (~2 s) og lander paa tilfeldige sifre
  for(let i = 0; i < W; i++)
    rollTo(cells[i], DIG[Math.floor(Math.random() * 10)],
           { dur: 2000, spin: 24, fill: DIG, delay: i * 45, easing: 'cubic-bezier(.2,.7,.2,1)' });

  // Fase 2: en og en ruller gjennom bokstaver/spesialtegn og lander paa ordet
  const P2 = 2150, STAG = 260, RUN = 1200;
  for(let i = 0; i < W; i++){
    (function(i){
      setTimeout(function(){
        rollTo(cells[i], word[i], { dur: RUN, spin: 18, fill: ALP, easing: 'cubic-bezier(.13,.85,.2,1)' });
      }, P2 + i * STAG);
    })(i);
  }
  const p2done = P2 + (W - 1) * STAG + RUN;

  // Fase 3 (hold ~1 s) -> Fase 4: rull tilbake til nedtellingen
  setTimeout(function(){
    const b = String(Math.max(0, secsIgjen()));
    const bp = (' '.repeat(Math.max(0, W - b.length)) + b).slice(-W).split('');
    for(let i = 0; i < W; i++){
      (function(i){
        setTimeout(function(){
          rollTo(cells[i], bp[i], { dur: 1200, spin: 20, fill: DIG, easing: 'cubic-bezier(.2,.7,.2,1)' });
        }, i * 110);
      })(i);
    }
    const done = (W - 1) * 110 + 1200 + 120;
    setTimeout(function(){
      lostAnimating = false;
      lastLostVal = secsIgjen();
      const f = content.querySelector('.flip'); if(f) f.classList.remove('lost');
      updateTimer();                                 // synk til eksakt tid
    }, done);
  }, p2done + 1000);
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
