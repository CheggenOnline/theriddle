
var currentTask = "";
var currentTaskContent = "";
var currentT0 = "";
var currentTaskQuestion = "";
var currentTaskAnswer = "";
var currentTaskHint = "";
var refreshTimer;

//Hei Knut Erlend. Get out!!! Du finner ingenting her, hverken hints eller svar ;)

var canvas;
var context;
var content;
var loader;
var answeredCorrect = "false";
var currentAnswerID;

// === Airtable config ===
const AIRTABLE_TOKEN = 'patYXth0O4whddbgU.6839f6c364c624db2cc69ae37aaa9664fe817296987505bda5bdb5d18d696f24';
const AIRTABLE_BASE  = 'appk2AU7HZVhGVNlb';
const TABLE_FLOW     = 'flow';     // or the exact table name
const TABLE_ANSWERS  = 'answers';  // or the exact table name

// We will cache answers table record IDs by elemID (T1..T4)
const ANSWER_ROW_IDS = {}; // e.g. { T1: 'recXXXXXXXX', T2:'recYYYYYYYY', ... }

////////////////////////////////////////

// in app.js, replace the jQuery ready with this:
document.addEventListener('DOMContentLoaded', function () {
  prepareCanvasAndDiv();
  findCurrentTask();
  // readDB(); // if you still use it
});

function questionFromCountdown(cid){ return 'T' + cid.slice(1); }  // C3 -> T3
function nextCountdownFromQuestion(tid){
  const n = parseInt(tid.slice(1), 10);
  return 'C' + (n + 1);                                           // T3 -> C4
}
let timerId = null;
let isAdvancing = false;  // guard against double updates

/////////////////////////////////////////////

function prepareCanvasAndDiv(){
    
    //const canvas = document.getElementById('Matrix');
    //const context = canvas.getContext('2d');
    canvas = document.getElementById('Matrix');
    context = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const contentWrapper = document.getElementById('contentWrapper');
    contentWrapper.width = window.innerWidth;
    contentWrapper.height = window.innerHeight;
    
    content = document.getElementById('content');
    loader = document.getElementById("loader");
    
    loader.style.display = "none";
    //content.style.display = "block";
}

function runTheMatrix(){

    const katakana = 'アァカサタナハマヤャラワガザダバパイィキシチニヒミリヰギジヂビピウゥクスツヌフムユュルグズブヅプエェケセテネヘメレヱゲゼデベペオォコソトノホモヨョロヲゴゾドボポヴッン';
    const latin = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const nums = '0123456789';
    
    const alphabet = katakana + latin + nums;
    
    const fontSize = 16;
    const columns = canvas.width/fontSize;
    
    const rainDrops = [];
    
    for( let x = 0; x < columns; x++ ) {
        rainDrops[x] = 1;
    }
    
    
    
    const draw = () => {
        context.fillStyle = 'rgba(0, 0, 0, 0.05)';
        context.fillRect(0, 0, canvas.width, canvas.height);
    
        context.fillStyle = '#0F0';
        context.font = fontSize + 'px monospace';
    
        for(let i = 0; i < rainDrops.length; i++)
        {
            const text = alphabet.charAt(Math.floor(Math.random() * alphabet.length));
            context.fillText(text, i*fontSize, rainDrops[i]*fontSize);
    
            if(rainDrops[i]*fontSize > canvas.height && Math.random() > 0.975){
                rainDrops[i] = 0;
            }
            rainDrops[i]++;
        }
    };
    
    setInterval(draw, 30);


}

///////////////////////////////////////////////////////////////////

async function findCurrentTask(){
  // 1) get currentTask pointer from flow
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(TABLE_FLOW)}?filterByFormula=${encodeURIComponent(`{elemID}="currentTask"`)}`, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
  });
  const data = await res.json();
  if(!data.records || !data.records[0]) { alert('No currentTask found'); return; }

  currentTask = data.records[0].fields.taskText; // e.g. "C1" or "T1"
  
  // 2) ensure we know the answers-row record IDs (T1..T4)
  await cacheAnswersRowIds();

  // 3) load content for the current task
  readTaskContent();
}

async function cacheAnswersRowIds(){
  if(Object.keys(ANSWER_ROW_IDS).length) return; // already cached

  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(TABLE_ANSWERS)}`, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
  });
  const data = await res.json();
  (data.records || []).forEach(r => {
    const eid = r.fields.elemID;
    if(eid) ANSWER_ROW_IDS[eid] = r.id;
  });
}


async function readTaskContent(){
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(TABLE_FLOW)}?filterByFormula=${encodeURIComponent(`{elemID}="${currentTask}"`)}`, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
  });
  const data = await res.json();
  const rec = (data.records || [])[0];
  if(!rec){ alert('Task not found'); return; }

  currentT0          = rec.fields.countdownTo || "";
  currentTaskQuestion= rec.fields.taskText || "";
  currentTaskAnswer  = rec.fields.answer || "";
  currentTaskHint    = rec.fields.hint || "";

  if(currentTask === "F"){
    // final redirect: use your existing behavior
    window.location.href = "thePrice";
    return;
  }

  deployUI();
}


function deployUI(){
    var firstChar = currentTask.charAt(0);

    if(firstChar == "C"){
        runCountdown();
    }else{
        runTask();
    }
}


function runCountdown(){
    refreshTimer = setInterval('updateTimer()', 1000);
}

function updateTimer() {

    var fullDateTimeOrg = currentT0;
    var fullDateTime = fullDateTimeOrg.replace(/&#58;/g,":");
    
    var future = Date.parse(fullDateTime);
    var now = new Date();
    var diff = future - now;

    if(diff <= 1){
        //update task and rerun getTaskContent
        //clearInterval(refreshTimer);
        //updateCurrentTask();

      onCountdownTick(0);
      
        
    }else{
        var secs = Math.floor(diff / 1000);
        var s = secs;
        document.getElementById("content").innerHTML ='<div class="timer">' + s + '</div>';
    }
    
    if(answeredCorrect == "true"){
        answeredCorrect = "false";
        context.clearRect(0, 0, canvas.width, canvas.height);
        showContentField();
    }
}

async function onCountdownTick(msLeft){
  // ... your rendering of the remaining time ...
  if (msLeft <= 0) {
    if (timerId) { clearInterval(timerId); timerId = null; }
    if (isAdvancing) return;
    isAdvancing = true;

    // Move pointer from Cn to Tn (not beyond!)
    const qId = questionFromCountdown(currentTask); // e.g. C1 -> T1
    await updateDB(qId);                             // updates pointer in Airtable
    currentTask = qId;
    isAdvancing = false;

    // Load and render the question
    await readTaskContent();
  }
}

function runTask(){
    presentInputUI();
}

///////
function presentInputUI(){
    
    
    //document.getElementById("content").innerHTML ='<input type="text" id="inputField"><div class="bar"></div>';
    document.getElementById("content").innerHTML ='<label id="questionLabel">'+currentTaskQuestion+'</label><input type="text" id="inputField" autofocus><div class="bar"></div><label id="hintLabel">'+currentTaskHint+'</label>';
    
    var node = document.getElementById("inputField");
    node.addEventListener("keyup", function(event) {
        if (event.key === "Enter") {
            // Do work
            //hide input element
            //content.style.display = "none";
            //fadeOutInputField();
            hideContentField();
            
            var answer = document.getElementById("inputField").value;
            var answerLowerCase = answer.toLowerCase();
            if(answerLowerCase == "matrix"){
                runTheMatrix();
            }else{
                showLoader();
                
                storeAnswerInDB(answerLowerCase);
                
                //Check if the answer was correct
                setTimeout(function(){
                    compareToFasit(answerLowerCase);
                }, 6000);
            }
        }
    });
}

async function storeAnswerInDB(newAnswer){
  const rowId = ANSWER_ROW_IDS[currentTask]; // expects currentTask like "T1"
  if(!rowId) return; // for countdown steps (C1 etc.) there is no answers row
  
  // 1) get current text
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(TABLE_ANSWERS)}/${rowId}`, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
  });
  const rec = await res.json();
  const oldAnswers = rec.fields.answers || "";
  const allAnswers = `${oldAnswers} {${newAnswer}}`;

  // 2) update
  await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(TABLE_ANSWERS)}/${rowId}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields: { answers: allAnswers } })
  });
}


function compareToFasit(answer){
  if(!currentTaskAnswer) { wrongAnswerNew(); return; }
  const normalized = (answer||'').trim().toLowerCase();
  if(normalized === String(currentTaskAnswer).trim().toLowerCase()){
    correctAnswer();
  }else{
    wrongAnswerNew();
  }
}


function correctAnswerOLD(){
    answeredCorrect = "true";
    hideLoader();
    turnCanvasGreen();
    
    setTimeout(function(){
               
        updateCurrentTask();
        
    }, 4000);
}

async function correctAnswer(){
  // ... your existing “correct!” UI/animation ...

  if (isAdvancing) return;
  isAdvancing = true;

  const nextC = nextCountdownFromQuestion(currentTask); // e.g. T1 -> C2
  await updateDB(nextC);                                 // update pointer in Airtable
  currentTask = nextC;
  isAdvancing = false;

  await readTaskContent(); // will now show the next countdown

  answeredCorrect = "true";
    hideLoader();
    turnCanvasGreen();
    
    setTimeout(function(){
               
        updateCurrentTask();
        
    }, 4000);
}


function wrongAnswerNew(){

    hideLoader();
    turnCanvasRed();
    
    setTimeout(function(){
        
        //clear canvas 
        context.clearRect(0, 0, canvas.width, canvas.height);
        
        showContentField();
        
        //empty the value
        document.getElementById("inputField").value = '';
        
        //set focus to input inputField
        document.getElementById("inputField").focus();
        
    }, 2000);
}

function wrongAnswer(){
    
    
    var ctx = canvas.getContext("2d");
    ctx.fillStyle = "red";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    //content.style.display = "none";
    setTimeout(function(){
        
        //get color back
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#333333";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.
        
        //get innput back
        //content.style.display = "block";
        content.style.opacity = 1;
        
        //empty the value
        document.getElementById("inputField").value = '';
        
        //set focus to input inputField
        document.getElementById("inputField").focus();
        
    }, 1000);
}

function hideContentField(){
    content.style.display = "none";
}

function hideLoader(){
    loader.style.display = "none";
}

function showContentField(){
    content.style.display = "block";
}

function showLoader(){
    loader.style.display = "block";
}

function turnCanvasRed(){
    
    context.fillStyle = '#FF0000';
    context.fillRect(0, 0, canvas.width, canvas.height);
}

function turnCanvasGreen(){
    
    context.fillStyle = '#008000';
    context.fillRect(0, 0, canvas.width, canvas.height);
}

function fadeOutInputField() {
    var fadeTarget = document.getElementById("content");
    var fadeEffect = setInterval(function () {
        if (!fadeTarget.style.opacity) {
            fadeTarget.style.opacity = 1;
        }
        if (fadeTarget.style.opacity > 0) {
            fadeTarget.style.opacity -= 0.1;
        } else {
            clearInterval(fadeEffect);
        }
    }, 100);
}

function updateCurrentTask(){
    if(currentTask == "C1"){
            updateDB("T1");
    }else if(currentTask == "C2"){
            updateDB("T2");
    }else if(currentTask == "C3"){
            updateDB("T3");
    }else if(currentTask == "C4"){
            updateDB("F");//skipped the last task
    }else if(currentTask == "T1"){
            updateDB("C2");
    }else if(currentTask == "T2"){
            updateDB("C3");
    }else if(currentTask == "T3"){
            updateDB("C4");
    }else if(currentTask == "T4"){
            updateDB("F");
    }
}

async function updateDB(newTask){
  // 1) find the single row where elemID="currentTask"
  const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(TABLE_FLOW)}?filterByFormula=${encodeURIComponent(`{elemID}="currentTask"`)}`, {
    headers: { Authorization: `Bearer ${AIRTABLE_TOKEN}` }
  });
  const data = await res.json();
  const row = (data.records||[])[0];
  if(!row){ alert('currentTask row missing'); return; }

  // 2) set taskText to the new pointer
  await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/${encodeURIComponent(TABLE_FLOW)}/${row.id}`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${AIRTABLE_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ fields: { taskText: newTask } })
  });

  // 3) local refresh
  currentTask = newTask;
  readTaskContent();
}










