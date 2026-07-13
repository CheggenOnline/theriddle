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
// Hieroglyfer i ånden av Lost-nedtellingens symboler
var LOST_GLYPHS = ['𓂀','𓆑','𓉔','𓊖','𓁷','𓃰','𓎛','𓆓','𓅓','𓐍','𓏏','𓋹'];
function glyph(){ return LOST_GLYPHS[Math.floor(Math.random()*LOST_GLYPHS.length)]; }

// Flip-klokke: hvert tegn får en fast kvadrat-rute. Symbolet skaleres slik at
// det alltid passer innenfor ruten - ogsaa de brede Lost-hieroglyfene.
var lastChars = [];
var lastLostFlag = false;
function fitSym(el){
  el.style.transform = 'scale(1)';           // nullstill foer maaling
  const cell = el.parentNode.parentNode;     // .sym -> .face -> .cell
  const maxW = cell.clientWidth  * 0.80;
  const maxH = cell.clientHeight * 0.80;
  const w = el.offsetWidth, h = el.offsetHeight;
  if(!w || !h) return;
  const s = Math.min(maxW / w, maxH / h, 1);
  el.style.transform = 'scale(' + s + ')';
}
function visTid(txt, lost){
  const chars = Array.from(String(txt));     // kodepunkt-trygt (hieroglyfer = surrogatpar)
  const reset = (lost !== lastLostFlag) || (chars.length !== lastChars.length);
  let h = '<div class="flip' + (lost ? ' lost' : '') + '">';
  for(let i = 0; i < chars.length; i++){
    const endret = reset || lastChars[i] !== chars[i];
    h += '<div class="cell' + (endret ? ' flipin' : '') + '"><div class="face">' +
         '<span class="sym">' + chars[i] + '</span></div></div>';
  }
  h += '</div>';
  content.innerHTML = h;
  const syms = content.querySelectorAll('.flip .sym');
  requestAnimationFrame(function(){ syms.forEach(fitSym); });
  lastChars = chars;
  lastLostFlag = lost;
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
  // Ny sekvens: alle sifre spinner (flipklokke) -> en og en bytter til
  // bokstaver/spesialtegn og lander paa "riddle" (ekstra ruter -> "*") ->
  // holdes ~1 s -> spinner tilbake og lander paa naavaerende nedtelling.
  lostAnimating = true;
  const startStr = String(Math.max(0, secsIgjen()));
  let W = Math.max(startStr.length, 6);
  if((W - 6) % 2 === 1) W++;                    // symmetrisk *-padding
  const lp = (W - 6) / 2, rp = W - 6 - lp;
  const wordTarget = '*'.repeat(lp) + 'riddle' + '*'.repeat(rp);
  const NUM = '0123456789';
  const ALPHA = 'abcdefghijklmnopqrstuvwxyz*!?#@&';

  // tidslinje (ms)
  const STAG = 330, ALPHARUN = 990, TICK = 333;   // flip 3 ganger i sekundet
  const p1end = 2000;                           // fase 1: alle spinner tall
  const switchT = [], lockT = [];
  for(let i = 0; i < W; i++){ switchT[i] = p1end + i * STAG; lockT[i] = switchT[i] + ALPHARUN; }
  const p2end = lockT[W - 1];                   // fase 2: en og en -> bokstaver -> land
  const p3end = p2end + 1000;                   // fase 3: hold ordet ~1 s
  const p4spinEnd = p3end + 700;                // fase 4: spinn tall igjen ...
  const backLockT = [];
  for(let i = 0; i < W; i++) backLockT[i] = p4spinEnd + i * 180;
  const p4end = backLockT[W - 1] + 140;         // ... og land tilbake paa nedtellingen

  const t0 = Date.now();
  let backPadded = null;
  const iv = setInterval(function(){
    const t = Date.now() - t0;
    const k = Math.floor(t / TICK);
    let out = [];
    if(t < p1end){
      for(let i = 0; i < W; i++) out.push(NUM[(k + i) % 10]);
    } else if(t < p2end){
      for(let i = 0; i < W; i++){
        if(t >= lockT[i]) out.push(wordTarget[i]);
        else if(t >= switchT[i]) out.push(ALPHA[(k + i * 3) % ALPHA.length]);
        else out.push(NUM[(k + i) % 10]);
      }
    } else if(t < p3end){
      for(let i = 0; i < W; i++) out.push(wordTarget[i]);
    } else if(t < p4end){
      if(backPadded === null){
        const b = String(Math.max(0, secsIgjen()));
        backPadded = (' '.repeat(Math.max(0, W - b.length)) + b).slice(-W);
      }
      for(let i = 0; i < W; i++){
        if(t >= backLockT[i]) out.push(backPadded[i]);
        else out.push(NUM[(k + i) % 10]);
      }
    } else {
      clearInterval(iv);
      lostAnimating = false;
      updateTimer();                            // synk til eksakt naavaerende tid
      return;
    }
    visTid(out.join(''), true);
  }, TICK);
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
