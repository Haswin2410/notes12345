/* ============ Config / Settings ============ */
const CFG_KEY = 'marginalia_cfg_v1';

function loadCfg(){
  try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; }
  catch(e){ return {}; }
}
function saveCfg(cfg){ localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); }

let cfg = loadCfg();
let db = null;
let currentNoteId = null;
let notes = {}; // id -> note object
let currentQuiz = null;
let quizAnswers = {};

/* ============ Toast ============ */
function toast(msg, isError){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.toggle('error', !!isError);
  t.classList.remove('hidden');
  clearTimeout(t._timer);
  t._timer = setTimeout(()=> t.classList.add('hidden'), 3800);
}

/* ============ Gate ============ */
function initGate(){
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  if (!cfg.passcode){
    // first run — no passcode set yet, let them straight in and set one via Settings
    gate.classList.add('hidden');
    app.classList.remove('hidden');
    boot();
    return;
  }
  const saved = sessionStorage.getItem('marginalia_unlocked');
  if (saved === cfg.passcode){
    gate.classList.add('hidden');
    app.classList.remove('hidden');
    boot();
    return;
  }
  document.getElementById('gate-submit').onclick = tryUnlock;
  document.getElementById('gate-input').addEventListener('keydown', e=>{
    if (e.key === 'Enter') tryUnlock();
  });
  function tryUnlock(){
    const val = document.getElementById('gate-input').value;
    if (val === cfg.passcode){
      sessionStorage.setItem('marginalia_unlocked', val);
      gate.classList.add('hidden');
      app.classList.remove('hidden');
      boot();
    } else {
      document.getElementById('gate-error').textContent = 'Wrong passcode.';
    }
  }
}

/* ============ Firebase ============ */
function initFirebase(){
  if (!cfg.firebase) return false;
  try {
    if (!firebase.apps.length) firebase.initializeApp(cfg.firebase);
    db = firebase.firestore();
    return true;
  } catch(e){
    console.error(e);
    toast('Firebase config looks invalid — check Settings.', true);
    return false;
  }
}

async function ensureAuth(){
  if (!cfg.firebase) return;
  return new Promise((resolve)=>{
    firebase.auth().onAuthStateChanged(user=>{
      if (user) resolve(user);
      else firebase.auth().signInAnonymously().catch(err=>{
        console.error(err); toast('Firebase auth failed: ' + err.message, true);
      });
    });
  });
}

/* ============ Boot ============ */
async function boot(){
  if (initFirebase()){
    await ensureAuth();
    await loadNotesFromFirestore();
  } else {
    // fallback: local-only mode
    notes = JSON.parse(localStorage.getItem('marginalia_notes_local') || '{}');
  }
  renderNoteList();
  bindUI();
}

async function loadNotesFromFirestore(){
  const snap = await db.collection('notes').orderBy('updatedAt','desc').get();
  notes = {};
  snap.forEach(doc=>{ notes[doc.id] = { id: doc.id, ...doc.data() }; });
}

function persistLocalFallback(){
  if (!db) localStorage.setItem('marginalia_notes_local', JSON.stringify(notes));
}

/* ============ Note CRUD ============ */
const TAB_COLORS = ['#E4B73B','#3C5A8A','#B85450','#5C7A5E','#8B9A82'];
function colorFor(id){
  let h = 0;
  for (const c of id) h = (h*31 + c.charCodeAt(0)) % 997;
  return TAB_COLORS[h % TAB_COLORS.length];
}

function renderNoteList(){
  const list = document.getElementById('note-list');
  list.innerHTML = '';
  const ids = Object.keys(notes).sort((a,b)=> (notes[b].updatedAt||0) - (notes[a].updatedAt||0));
  ids.forEach(id=>{
    const n = notes[id];
    const el = document.createElement('div');
    el.className = 'note-tab' + (id === currentNoteId ? ' active' : '');
    el.style.setProperty('--tab-color', colorFor(id));
    el.innerHTML = `<span class="tab-name">${escapeHtml(n.title || 'Untitled')}</span><button class="tab-del" title="Delete">✕</button>`;
    el.querySelector('.tab-name').onclick = ()=> openNote(id);
    el.querySelector('.tab-del').onclick = (e)=>{ e.stopPropagation(); deleteNote(id); };
    list.appendChild(el);
  });
}

function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

async function createNote(){
  const id = 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2,7);
  const note = { id, title:'Untitled lecture', source:'', summary:'', quiz:null, createdAt: Date.now(), updatedAt: Date.now() };
  notes[id] = note;
  if (db){
    await db.collection('notes').doc(id).set({title:note.title, source:'', summary:'', quiz:null, createdAt: Date.now(), updatedAt: Date.now()});
  }
  persistLocalFallback();
  renderNoteList();
  openNote(id);
}

async function saveCurrentNote(){
  if (!currentNoteId) return;
  const n = notes[currentNoteId];
  n.title = document.getElementById('note-title').value || 'Untitled lecture';
  n.source = document.getElementById('source-text').value;
  n.updatedAt = Date.now();
  if (db){
    await db.collection('notes').doc(currentNoteId).set(n, {merge:true});
  }
  persistLocalFallback();
  renderNoteList();
  toast('Note saved.');
}

async function deleteNote(id){
  if (!confirm('Delete this note? This cannot be undone.')) return;
  delete notes[id];
  if (db) await db.collection('notes').doc(id).delete();
  persistLocalFallback();
  if (currentNoteId === id){
    currentNoteId = null;
    document.getElementById('workspace').classList.add('hidden');
    document.getElementById('empty-state').classList.remove('hidden');
  }
  renderNoteList();
}

function openNote(id){
  currentNoteId = id;
  const n = notes[id];
  document.getElementById('empty-state').classList.add('hidden');
  document.getElementById('workspace').classList.remove('hidden');
  document.getElementById('note-title').value = n.title || '';
  document.getElementById('source-text').value = n.source || '';
  switchTab('source');
  renderSummaryPane(n);
  renderQuizPane(n);
  renderNoteList();
}

/* ============ Tabs ============ */
function switchTab(name){
  document.querySelectorAll('.page-tab').forEach(b=> b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-pane').forEach(p=> p.classList.toggle('active', p.id === 'tab-' + name));
}

/* ============ File parsing ============ */
async function parseFile(file){
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'txt'){
    return await file.text();
  }
  if (ext === 'pdf'){
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({data: buf}).promise;
    let text = '';
    for (let i=1; i<=pdf.numPages; i++){
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(it=>it.str).join(' ') + '\n\n';
    }
    return text;
  }
  if (ext === 'docx'){
    const buf = await file.arrayBuffer();
    const result = await mammoth.extractRawText({arrayBuffer: buf});
    return result.value;
  }
  throw new Error('Unsupported file type: ' + ext);
}

/* ============ AI calls ============ */
function apiBase(){
  return (cfg.apiBase || '').replace(/\/$/, '');
}

async function callAI(action, body){
  const base = apiBase();
  if (!base) throw new Error('Set your API base URL in Settings first.');
  const res = await fetch(base + '/api/generate', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({action, ...body})
  });
  if (!res.ok){
    const t = await res.text();
    throw new Error('API error (' + res.status + '): ' + t.slice(0,200));
  }
  return res.json();
}

async function generateSummary(){
  const n = notes[currentNoteId];
  const source = document.getElementById('source-text').value.trim();
  if (!source){ toast('Add some notes first.', true); return; }
  n.source = source;
  switchTab('summary');
  document.getElementById('summary-empty').classList.add('hidden');
  document.getElementById('summary-content').classList.add('hidden');
  document.getElementById('summary-actions').classList.add('hidden');
  document.getElementById('summary-loading').classList.remove('hidden');
  try {
    const { text } = await callAI('summary', { text: source, title: n.title });
    n.summary = text;
    n.updatedAt = Date.now();
    if (db) await db.collection('notes').doc(currentNoteId).set(n, {merge:true});
    persistLocalFallback();
    renderSummaryPane(n);
    toast('Summary ready.');
  } catch(e){
    console.error(e);
    toast(e.message, true);
    document.getElementById('summary-loading').classList.add('hidden');
    document.getElementById('summary-empty').classList.remove('hidden');
  }
}

function renderSummaryPane(n){
  document.getElementById('summary-loading').classList.add('hidden');
  if (n.summary){
    document.getElementById('summary-empty').classList.add('hidden');
    const c = document.getElementById('summary-content');
    c.innerHTML = marked.parse(n.summary);
    c.classList.remove('hidden');
    document.getElementById('summary-actions').classList.remove('hidden');
  } else {
    document.getElementById('summary-empty').classList.remove('hidden');
    document.getElementById('summary-content').classList.add('hidden');
    document.getElementById('summary-actions').classList.add('hidden');
  }
}

async function generateQuiz(count){
  const n = notes[currentNoteId];
  if (!n.summary){ toast('Generate a summary first.', true); return; }
  document.getElementById('quiz-setup').classList.add('hidden');
  document.getElementById('quiz-empty').classList.add('hidden');
  document.getElementById('quiz-content').classList.add('hidden');
  document.getElementById('quiz-result').classList.add('hidden');
  document.getElementById('quiz-loading').classList.remove('hidden');
  try {
    const { questions } = await callAI('quiz', { text: n.summary, sourceText: n.source, count });
    n.quiz = questions;
    n.updatedAt = Date.now();
    if (db) await db.collection('notes').doc(currentNoteId).set(n, {merge:true});
    persistLocalFallback();
    renderQuizPane(n, true);
    toast('Quiz ready — good luck.');
  } catch(e){
    console.error(e);
    toast(e.message, true);
    document.getElementById('quiz-loading').classList.add('hidden');
    document.getElementById('quiz-setup').classList.remove('hidden');
  }
}

function renderQuizPane(n, freshStart){
  document.getElementById('quiz-loading').classList.add('hidden');
  document.getElementById('quiz-result').classList.add('hidden');
  if (!n.summary){
    document.getElementById('quiz-empty').classList.remove('hidden');
    document.getElementById('quiz-setup').classList.add('hidden');
    document.getElementById('quiz-content').classList.add('hidden');
    return;
  }
  document.getElementById('quiz-empty').classList.add('hidden');
  if (!n.quiz){
    document.getElementById('quiz-setup').classList.remove('hidden');
    document.getElementById('quiz-content').classList.add('hidden');
    return;
  }
  document.getElementById('quiz-setup').classList.add('hidden');
  if (freshStart) quizAnswers = {};
  currentQuiz = n.quiz;
  const wrap = document.getElementById('quiz-content');
  wrap.classList.remove('hidden');
  wrap.innerHTML = '';
  currentQuiz.forEach((q, idx)=>{
    const qEl = document.createElement('div');
    qEl.className = 'quiz-q';
    qEl.dataset.idx = idx;
    qEl.innerHTML = `
      <div class="quiz-q-num">QUESTION ${idx+1} OF ${currentQuiz.length}</div>
      <div class="quiz-q-text">${escapeHtml(q.question)}</div>
      <div class="quiz-opts"></div>
      <div class="quiz-explain">${escapeHtml(q.explanation || '')}</div>
    `;
    const optsWrap = qEl.querySelector('.quiz-opts');
    q.options.forEach((opt, oidx)=>{
      const optEl = document.createElement('label');
      optEl.className = 'quiz-opt';
      optEl.innerHTML = `<input type="radio" name="q${idx}" value="${oidx}"> <span>${escapeHtml(opt)}</span>`;
      optEl.querySelector('input').onchange = ()=> selectAnswer(idx, oidx);
      optsWrap.appendChild(optEl);
    });
    wrap.appendChild(qEl);
  });
  const submitBtn = document.createElement('button');
  submitBtn.className = 'btn btn-primary';
  submitBtn.style.width = 'auto';
  submitBtn.style.marginTop = '10px';
  submitBtn.textContent = 'Submit quiz';
  submitBtn.onclick = submitQuiz;
  wrap.appendChild(submitBtn);
}

function selectAnswer(qIdx, optIdx){
  quizAnswers[qIdx] = optIdx;
  const qEl = document.querySelector(`.quiz-q[data-idx="${qIdx}"]`);
  qEl.querySelectorAll('.quiz-opt').forEach((el,i)=> el.classList.toggle('selected', i===optIdx));
}

function submitQuiz(){
  let correct = 0;
  currentQuiz.forEach((q, idx)=>{
    const qEl = document.querySelector(`.quiz-q[data-idx="${idx}"]`);
    qEl.classList.add('answered');
    const chosen = quizAnswers[idx];
    qEl.querySelectorAll('.quiz-opt').forEach((el, oidx)=>{
      el.style.pointerEvents = 'none';
      if (oidx === q.correctIndex) el.classList.add('correct');
      else if (oidx === chosen) el.classList.add('incorrect');
    });
    if (chosen === q.correctIndex) correct++;
  });
  const pct = Math.round((correct/currentQuiz.length)*100);
  const resEl = document.getElementById('quiz-result');
  resEl.classList.remove('hidden');
  resEl.innerHTML = `
    <div class="stamp ${pct>=70?'good':''}">${pct}% — ${correct}/${currentQuiz.length}</div>
    <p style="color:var(--text-soft)">${pct>=70 ? "Solid work. That's ready to walk into an exam with." : "Worth another pass through the summary before the real thing."}</p>
    <button class="btn btn-ghost" id="retake-btn" style="width:auto;margin-top:10px;">Retake quiz</button>
  `;
  document.getElementById('retake-btn').onclick = ()=>{ quizAnswers = {}; renderQuizPane(notes[currentNoteId], true); };
  resEl.scrollIntoView({behavior:'smooth'});
}

/* ============ Word doc export ============ */
function markdownToDocxChildren(md){
  const { Paragraph, TextRun, HeadingLevel } = docx;
  const lines = md.split('\n');
  const children = [];
  function inlineRuns(text){
    const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    return parts.map(p=>{
      if (p.startsWith('**') && p.endsWith('**')){
        return new TextRun({ text: p.slice(2,-2), bold:true });
      }
      return new TextRun(p);
    });
  }
  for (let raw of lines){
    const line = raw.trim();
    if (!line){ children.push(new Paragraph('')); continue; }
    if (line.startsWith('### ')) children.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3 }));
    else if (line.startsWith('## ')) children.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 }));
    else if (line.startsWith('# ')) children.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 }));
    else if (/^[-*]\s+/.test(line)) children.push(new Paragraph({ children: inlineRuns(line.replace(/^[-*]\s+/,'')), bullet:{level:0} }));
    else if (/^\d+\.\s+/.test(line)) children.push(new Paragraph({ children: inlineRuns(line.replace(/^\d+\.\s+/,'')), numbering:{reference:'num', level:0} }));
    else children.push(new Paragraph({ children: inlineRuns(line) }));
  }
  return children;
}

async function downloadDocx(){
  const n = notes[currentNoteId];
  if (!n.summary){ toast('Generate a summary first.', true); return; }
  const { Document, Packer, Paragraph, HeadingLevel } = docx;
  const doc = new Document({
    sections: [{
      children: [
        new Paragraph({ text: n.title || 'Lecture Notes', heading: HeadingLevel.TITLE }),
        new Paragraph({ text: 'Key points & summary', heading: HeadingLevel.HEADING_2 }),
        ...markdownToDocxChildren(n.summary)
      ]
    }]
  });
  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = (n.title || 'lecture-notes').replace(/[^\w\- ]/g,'') + '.docx';
  a.click();
  URL.revokeObjectURL(url);
}

/* ============ UI bindings ============ */
function bindUI(){
  document.getElementById('new-note-btn').onclick = createNote;
  document.getElementById('empty-new-btn').onclick = createNote;

  document.querySelectorAll('.page-tab').forEach(b=>{
    b.onclick = ()=> switchTab(b.dataset.tab);
  });

  document.getElementById('save-note-btn').onclick = saveCurrentNote;
  document.getElementById('summarize-btn').onclick = async ()=>{ await saveCurrentNote(); await generateSummary(); };
  document.getElementById('regen-summary-btn').onclick = generateSummary;
  document.getElementById('make-quiz-btn').onclick = ()=>{
    document.getElementById('quiz-setup').classList.remove('hidden');
    switchTab('quiz');
  };
  document.getElementById('start-quiz-gen-btn').onclick = ()=> generateQuiz(parseInt(document.getElementById('quiz-count').value,10));
  document.getElementById('quiz-count').oninput = (e)=> document.getElementById('quiz-count-val').textContent = e.target.value;
  document.getElementById('download-doc-btn').onclick = downloadDocx;

  // file upload
  const fileInput = document.getElementById('file-input');
  document.getElementById('browse-btn').onclick = ()=> fileInput.click();
  fileInput.onchange = async (e)=>{
    const f = e.target.files[0];
    if (!f) return;
    try {
      const text = await parseFile(f);
      const ta = document.getElementById('source-text');
      ta.value = (ta.value ? ta.value + '\n\n' : '') + text;
      toast('File added to notes.');
    } catch(err){ toast(err.message, true); }
  };
  const dz = document.getElementById('dropzone');
  ['dragenter','dragover'].forEach(ev=> dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.add('drag'); }));
  ['dragleave','drop'].forEach(ev=> dz.addEventListener(ev, e=>{ e.preventDefault(); dz.classList.remove('drag'); }));
  dz.addEventListener('drop', async e=>{
    const f = e.dataTransfer.files[0];
    if (!f) return;
    try {
      const text = await parseFile(f);
      const ta = document.getElementById('source-text');
      ta.value = (ta.value ? ta.value + '\n\n' : '') + text;
      toast('File added to notes.');
    } catch(err){ toast(err.message, true); }
  });

  // settings modal
  document.getElementById('settings-btn').onclick = openSettings;
  document.getElementById('settings-close-btn').onclick = ()=> document.getElementById('settings-modal').classList.add('hidden');
  document.getElementById('settings-save-btn').onclick = saveSettings;
}

function openSettings(){
  document.getElementById('cfg-passcode').value = cfg.passcode || '';
  document.getElementById('cfg-firebase').value = cfg.firebase ? JSON.stringify(cfg.firebase, null, 2) : '';
  document.getElementById('cfg-apibase').value = cfg.apiBase || '';
  document.getElementById('settings-modal').classList.remove('hidden');
}

function saveSettings(){
  const passcode = document.getElementById('cfg-passcode').value.trim();
  const fbRaw = document.getElementById('cfg-firebase').value.trim();
  const apiBaseVal = document.getElementById('cfg-apibase').value.trim();
  let fb = cfg.firebase;
  if (fbRaw){
    try { fb = JSON.parse(fbRaw); }
    catch(e){ toast('Firebase config is not valid JSON.', true); return; }
  }
  cfg = { passcode: passcode || undefined, firebase: fb, apiBase: apiBaseVal };
  saveCfg(cfg);
  document.getElementById('settings-modal').classList.add('hidden');
  toast('Settings saved. Reloading…');
  setTimeout(()=> location.reload(), 700);
}

/* ============ Start ============ */
initGate();
