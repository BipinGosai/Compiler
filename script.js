const EPS = 'ε';

/* ============================================================
   GRAMMAR TEXT PARSER
   ============================================================ */
function parseGrammarText(text){
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  if(lines.length === 0) throw new Error('No productions found — write at least one line like "S -> a B".');

  const productions = {};
  const order = [];
  const isEpsToken = (s) => /^(eps|epsilon|ε)$/i.test(s);

  for(const line of lines){
    const arrowIdx = line.search(/->|→/);
    if(arrowIdx === -1) throw new Error(`Missing "->" in line: "${line}"`);
    const arrowLen = line.slice(arrowIdx).startsWith('->') ? 2 : 1;
    const lhs = line.slice(0, arrowIdx).trim();
    const rhsPart = line.slice(arrowIdx + arrowLen).trim();
    if(!lhs) throw new Error(`Missing left-hand side in line: "${line}"`);
    if(!rhsPart) throw new Error(`Missing right-hand side in line: "${line}"`);

    if(!productions[lhs]){ productions[lhs] = []; order.push(lhs); }
    const alts = rhsPart.split('|').map(a => a.trim());
    for(const alt of alts){
      const symbols = (alt === '' || isEpsToken(alt))
        ? [EPS]
        : alt.split(/\s+/).filter(Boolean).map(s => isEpsToken(s) ? EPS : s);
      productions[lhs].push(symbols);
    }
  }

  const nonterminals = order;
  const start = order[0];

  const terminals = [];
  const seen = new Set();
  for(const nt of nonterminals){
    for(const prod of productions[nt]){
      for(const sym of prod){
        if(sym === EPS) continue;
        if(nonterminals.includes(sym)) continue;
        if(!seen.has(sym)){ seen.add(sym); terminals.push(sym); }
      }
    }
  }

  return { productions, nonterminals, start, terminals };
}

/* ============================================================
   GRAMMAR TRANSFORMATION
   Raw/ambiguous grammar → LL(1)-ready, with a human-readable
   log of every rewrite (displayed in the UI).
   ============================================================ */
function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function fmtAlt(prod){
  return (prod.length === 1 && prod[0] === EPS) ? EPS : prod.join(' ');
}
function fmtProds(nt, prods){
  return `${nt} → ${prods.map(fmtAlt).join('  |  ')}`;
}
function dedupeProds(prods){
  const seen = new Set(), out = [];
  for(const p of prods){
    const key = p.join('\u0000');
    if(!seen.has(key)){ seen.add(key); out.push(p); }
  }
  return out;
}
function freshName(base, taken){
  let name = base, primes = 0;
  while(taken.has(name)){ primes++; name = base + "'".repeat(primes); }
  return name;
}
function rebuildGrammar(productions, nonterminals, start){
  const terminals = [];
  const seen = new Set();
  for(const nt of nonterminals){
    for(const prod of productions[nt] || []){
      for(const sym of prod){
        if(sym === EPS || nonterminals.includes(sym) || seen.has(sym)) continue;
        seen.add(sym); terminals.push(sym);
      }
    }
  }
  return { productions, nonterminals: nonterminals.slice(), start, terminals };
}
function grammarToString(grammar){
  return grammar.nonterminals
    .map(nt => `${nt} -> ${grammar.productions[nt].map(fmtAlt).join(' | ')}`)
    .join('\n');
}

function transformGrammar(grammar){
  const log = [];
  const productions = {};
  grammar.nonterminals.forEach(nt => productions[nt] = grammar.productions[nt].map(p => [...p]));
  const nonterminals = [...grammar.nonterminals];
  const start = grammar.start;
  const taken = new Set(nonterminals);
  const addNT = (after, name) => {
    const idx = nonterminals.indexOf(after);
    nonterminals.splice(idx + 1, 0, name);
    taken.add(name);
  };

  /* ---- Step 1: immediate left-recursion elimination ---- */
  log.push({ step:'note',
    text:'Step 1 — eliminate immediate left recursion: every A → Aα₁ | … | Aαₖ | β₁ | … | βₘ  becomes  A → βA′ , A′ → αA′ | ε' });

  let removed = 0;
  for(const A of [...nonterminals]){
    const prods = productions[A] || [];
    const alphas = prods.filter(p => p[0] === A);
    const betas  = prods.filter(p => p[0] !== A);
    if(alphas.length === 0) continue;
    if(betas.length === 0){
      log.push({ step:'warn',
        text:`${A}: every alternative starts with ${A}, so there is no non-recursive base case. Left as-is (this nonterminal can never terminate).` });
      continue;
    }
    const Ap = freshName(A, taken);
    const newA = betas.map(beta =>
      (beta.length === 1 && beta[0] === EPS) ? [Ap] : [...beta, Ap]);
    const primeProds = [];
    for(const alpha of alphas){
      const rest = alpha.slice(1);
      if(rest.length === 0) continue;
      if(rest.length === 1 && rest[0] === EPS) continue;
      primeProds.push([...rest, Ap]);
    }
    primeProds.push([EPS]);
    productions[A]  = dedupeProds(newA);
    productions[Ap] = dedupeProds(primeProds);
    addNT(A, Ap);
    removed++;
    log.push({ step:'left-recursion',
      text:`${A} had ${alphas.length} recursive alternative(s). Rewritten as:`,
      detail:`${fmtProds(A, prods)}   ⇒   ${fmtProds(A, productions[A])}   and   ${fmtProds(Ap, productions[Ap])}` });
  }
  if(removed === 0) log.push({ step:'note', text:'No immediate left recursion found — nothing to eliminate.' });

  /* ---- Step 2: left factoring (applied repeatedly) ---- */
  log.push({ step:'note',
    text:'Step 2 — left-factor common prefixes: every A → αβ₁ | αβ₂ | …  becomes  A → αA′ , A′ → β₁ | β₂ | …  (repeat until none remain)' });

  const commonPrefixLen = (a, b) => {
    let k = 0;
    while(k < a.length && k < b.length && a[k] !== EPS && b[k] !== EPS && a[k] === b[k]) k++;
    return k;
  };

  let factored = 0, guard = 0;
  while(guard++ < 100){
    let changedPass = false;
    for(const A of [...nonterminals]){
      const prods = productions[A] || [];
      let bestLen = 0, bestPrefix = null;
      for(let i = 0; i < prods.length; i++){
        for(let j = i + 1; j < prods.length; j++){
          const len = commonPrefixLen(prods[i], prods[j]);
          if(len > bestLen){ bestLen = len; bestPrefix = prods[i].slice(0, len); }
        }
      }
      if(!bestPrefix) continue;
      const matching = prods.filter(p => commonPrefixLen(p, bestPrefix) === bestPrefix.length);
      const rest     = prods.filter(p => commonPrefixLen(p, bestPrefix) !== bestPrefix.length);
      const Ap = freshName(A, taken);
      const primeProds = matching.map(p => {
        const rem = p.slice(bestPrefix.length);
        return rem.length ? rem : [EPS];
      });
      productions[A]  = dedupeProds([...rest, [...bestPrefix, Ap]]);
      productions[Ap] = dedupeProds(primeProds);
      addNT(A, Ap);
      factored++;
      changedPass = true;
      log.push({ step:'factoring',
        text:`${A} had ${matching.length} alternative(s) sharing the common prefix “${fmtAlt(bestPrefix)}”. Rewritten as:`,
        detail:`${fmtProds(A, prods)}   ⇒   ${fmtProds(A, productions[A])}   and   ${fmtProds(Ap, productions[Ap])}` });
    }
    if(!changedPass) break;
  }
  if(factored === 0) log.push({ step:'note', text:'No common prefixes found — nothing to factor.' });

  return { grammar: rebuildGrammar(productions, nonterminals, start), log };
}

function analyzeGrammar(grammar){
  const { FIRST, firstOfSeq } = computeFirstSets(grammar);
  const FOLLOW = computeFollowSets(grammar, FIRST, firstOfSeq);
  const { table, conflicts } = buildParseTable(grammar, FIRST, FOLLOW, firstOfSeq);
  return { FIRST, FOLLOW, table, conflicts };
}

/* ============================================================
   FIRST / FOLLOW / TABLE (generic, parameterized by grammar)
   ============================================================ */
function isNT(grammar, s){ return grammar.nonterminals.includes(s); }
function isTerminalSym(grammar, s){ return s !== EPS && !isNT(grammar, s); }

function computeFirstSets(grammar){
  const FIRST = {};
  grammar.nonterminals.forEach(nt => FIRST[nt] = new Set());

  function firstOfSeq(seq){
    const result = new Set();
    let allEps = true;
    for(const sym of seq){
      if(sym === EPS) continue;
      if(isTerminalSym(grammar, sym)){ result.add(sym); allEps = false; break; }
      const f = FIRST[sym] || new Set();
      f.forEach(x => { if(x !== EPS) result.add(x); });
      if(!f.has(EPS)){ allEps = false; break; }
    }
    if(allEps) result.add(EPS);
    return result;
  }

  let changed = true;
  while(changed){
    changed = false;
    for(const nt of grammar.nonterminals){
      for(const prod of grammar.productions[nt]){
        const f = firstOfSeq(prod);
        f.forEach(sym => { if(!FIRST[nt].has(sym)){ FIRST[nt].add(sym); changed = true; } });
      }
    }
  }
  return { FIRST, firstOfSeq };
}

function computeFollowSets(grammar, FIRST, firstOfSeq){
  const FOLLOW = {};
  grammar.nonterminals.forEach(nt => FOLLOW[nt] = new Set());
  FOLLOW[grammar.start].add('$');

  let changed = true;
  while(changed){
    changed = false;
    for(const A of grammar.nonterminals){
      for(const prod of grammar.productions[A]){
        for(let i = 0; i < prod.length; i++){
          const B = prod[i];
          if(!isNT(grammar, B)) continue;
          const beta = prod.slice(i + 1);
          const firstBeta = firstOfSeq(beta);
          firstBeta.forEach(sym => { if(sym !== EPS && !FOLLOW[B].has(sym)){ FOLLOW[B].add(sym); changed = true; } });
          if(firstBeta.has(EPS)){
            FOLLOW[A].forEach(sym => { if(!FOLLOW[B].has(sym)){ FOLLOW[B].add(sym); changed = true; } });
          }
        }
      }
    }
  }
  return FOLLOW;
}

function buildParseTable(grammar, FIRST, FOLLOW, firstOfSeq){
  const table = {};
  const conflicts = [];
  grammar.nonterminals.forEach(nt => table[nt] = {});

  function place(A, t, prod){
    if(!table[A][t]){ table[A][t] = { prods:[prod] }; }
    else { table[A][t].prods.push(prod); }
  }

  for(const A of grammar.nonterminals){
    for(const prod of grammar.productions[A]){
      const f = firstOfSeq(prod);
      f.forEach(t => { if(t !== EPS) place(A, t, prod); });
      if(f.has(EPS)){
        FOLLOW[A].forEach(t => place(A, t, prod));
      }
    }
  }

  for(const A of grammar.nonterminals){
    for(const t of Object.keys(table[A])){
      if(table[A][t].prods.length > 1){
        conflicts.push({ nt: A, terminal: t, prods: table[A][t].prods.map(p => p.join(' ')) });
      }
    }
  }

  return { table, conflicts };
}

/* ============================================================
   NON-RECURSIVE PREDICTIVE PARSER
   ============================================================ */
function tokenizeInput(str, terminals){
  const allSingleChar = terminals.length > 0 && terminals.every(t => t.length === 1);
  if(allSingleChar) return str.replace(/\s+/g, '').split('').filter(Boolean);
  return str.trim().split(/\s+/).filter(Boolean);
}

function parseString(grammar, table, inputTokens){
  const tokens = inputTokens.concat(['$']);
  const stack = ['$', grammar.start];
  const steps = [];
  let ip = 0, verdict = null, guard = 0;

  const snapshot = (action) => steps.push({ stack: [...stack], remaining: tokens.slice(ip).join(' '), action });

  while(guard++ < 2000){
    const top = stack[stack.length - 1];
    const cur = tokens[ip];

    if(top === '$' && cur === '$'){ snapshot('Stack and input both exhausted → ACCEPT'); verdict = 'accept'; break; }

    if(!isNT(grammar, top)){
      if(top === cur){ snapshot(`Match "${top}"`); stack.pop(); ip++; }
      else { snapshot(`Expected "${top}" but found "${cur === '$' ? 'end of input' : cur}" → REJECT`); verdict = 'reject'; break; }
    } else {
      const cell = table[top][cur];
      if(!cell){ snapshot(`No rule for M[${top}, ${cur}] → REJECT`); verdict = 'reject'; break; }
      const prod = cell.prods[0];
      snapshot(`${top} → ${prod.join(' ')}`);
      stack.pop();
      if(!(prod.length === 1 && prod[0] === EPS)) for(let i = prod.length - 1; i >= 0; i--) stack.push(prod[i]);
    }
  }
  if(verdict === null){ verdict = 'reject'; steps.push({ stack:[...stack], remaining: tokens.slice(ip).join(' '), action:'Step limit reached → REJECT (possible non-terminating grammar)' }); }
  return { steps, verdict, tokens };
}

/* ============================================================
   APP STATE + WIRING
   ============================================================ */
let currentGrammar = null, currentTable = null;
let session = null, cursor = -1, playTimer = null;

const els = {
  grammarInput: document.getElementById('grammarInput'),
  strInput: document.getElementById('strInput'),
  parseBtn: document.getElementById('parseBtn'),
  statusBanner: document.getElementById('statusBanner'),
  transformCard: document.getElementById('transformCard'),
  analysisPanel: document.getElementById('analysisPanel'),
  resultPanel: document.getElementById('resultPanel'),
  stepBtn: document.getElementById('stepBtn'),
  prevBtn: document.getElementById('prevBtn'),
  playBtn: document.getElementById('playBtn'),
  resetBtn: document.getElementById('resetBtn'),
  speedSelect: document.getElementById('speedSelect'),
  speedBtns: () => [...document.querySelectorAll('.seg-select .active')],
  headChip: document.getElementById('headChip'),
  stackCol: document.getElementById('stackCol'),
  tape: document.getElementById('tape'),
  actionReadout: document.getElementById('actionReadout'),
  verdict: document.getElementById('verdict'),
  traceBody: document.querySelector('#traceTable tbody'),
};

function blockClass(sym){
  if(sym === '$') return 'end';
  if(currentGrammar && isNT(currentGrammar, sym)) return 'nt';
  return 'term';
}
function renderStack(stackArr){
  const kids = [...els.stackCol.children];
  stackArr.forEach((sym, i) => {
    let div = kids[i];
    if(!div || div._key !== sym){
      div = document.createElement('div');
      els.stackCol.appendChild(div);
    }
    div._key = sym;
    div.className = 'stack-block ' + blockClass(sym);
    div.innerHTML = `<span class="sidx">${i}</span><span class="ssym">${sym}</span>`;
  });
  while(els.stackCol.children.length > stackArr.length) els.stackCol.removeChild(els.stackCol.lastChild);
}
function renderTape(tokens, ip){
  const kids = [...els.tape.children];
  tokens.forEach((t, i) => {
    let span = kids[i];
    if(!span || span._key !== t){
      span = document.createElement('span');
      els.tape.appendChild(span);
    }
    span._key = t;
    span.className = 'sym ' + (i < ip ? 'consumed' : (i === ip ? 'current' : ''));
    span.textContent = t;
  });
  while(els.tape.children.length > tokens.length) els.tape.removeChild(els.tape.lastChild);
}
function renderAction(step, idx){
  const html = step.action.includes('→')
    ? step.action.replace('→', '<span class="act-arrow">→</span>')
    : `<span class="act-match">${step.action}</span>`;
  els.actionReadout.innerHTML = `<span class="step-badge">step ${idx+1}</span>${html}`;
}
function renderTraceRow(step, idx, verdictAtEnd, total){
  const tr = document.createElement('tr');
  const isLast = idx === total - 1;
  if(isLast && verdictAtEnd === 'accept') tr.classList.add('accept-row');
  else if(isLast && verdictAtEnd === 'reject') tr.classList.add('reject-row');
  tr.innerHTML = `<td>${idx+1}</td><td>${step.stack.join(' ')}</td><td>${step.remaining || 'ε'}</td><td>${step.action}</td>`;
  els.traceBody.appendChild(tr);
}

/* ---------- FIRST/FOLLOW + parse table display ---------- */
function firstFollowTableHtml(grammar, FIRST, FOLLOW){
  let html = '<table><thead><tr><th>Non-terminal</th><th>FIRST</th><th>FOLLOW</th></tr></thead><tbody>';
  grammar.nonterminals.forEach(nt => {
    html += `<tr><td>${nt}</td><td class="set-cell">{ ${[...FIRST[nt]].join(', ')} }</td><td class="set-cell">{ ${[...FOLLOW[nt]].join(', ')} }</td></tr>`;
  });
  return html + '</tbody></table>';
}
function parseTableHtml(grammar, table, conflicts){
  const cols = [...grammar.terminals, '$'];
  const conflictSet = new Set(conflicts.map(c => c.nt + '|' + c.terminal));
  let html = `<table><thead><tr><th>NT</th>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>`;
  grammar.nonterminals.forEach(nt => {
    let row = `<tr><td>${nt}</td>`;
    cols.forEach(t => {
      const cell = table[nt][t];
      if(cell){
        const text = cell.prods.map(p => `${nt}→${p.join(' ')}`).join(' / ');
        row += `<td class="${conflictSet.has(nt + '|' + t) ? 'conflict-cell' : 'rule-cell'}">${text}</td>`;
      } else {
        row += `<td class="empty-cell">—</td>`;
      }
    });
    html += row + '</tr>';
  });
  return html + '</tbody></table>';
}
function renderFirstFollowSets(grammar, FIRST, FOLLOW){
  document.querySelector('#firstFollowTable').innerHTML = firstFollowTableHtml(grammar, FIRST, FOLLOW);
}
function renderParseTableDisplay(grammar, table, conflicts){
  document.querySelector('#parseTableDisplay').innerHTML = parseTableHtml(grammar, table, conflicts);
}
function renderAnalysis(grammar, analysis){
  renderFirstFollowSets(grammar, analysis.FIRST, analysis.FOLLOW);
  renderParseTableDisplay(grammar, analysis.table, analysis.conflicts);
}

function showStep(idx){
  if(!session) return;
  cursor = Math.max(0, Math.min(idx, session.steps.length - 1));
  const step = session.steps[cursor];
  renderStack(step.stack);
  renderAction(step, cursor);

  const remainingTokenCount = step.remaining === '' ? 0 : step.remaining.split(' ').filter(Boolean).length;
  const ip = session.tokens.length - remainingTokenCount;
  renderTape(session.tokens, ip);

  [...els.traceBody.children].forEach((tr,i) => tr.classList.toggle('current-row', i === cursor));

  const atEnd = cursor === session.steps.length - 1;
  if(atEnd){
    els.verdict.className = 'verdict ' + (session.verdict === 'accept' ? 'accept' : 'reject');
    els.verdict.textContent = session.verdict === 'accept'
      ? `✓ ACCEPTED — "${els.strInput.value}" is derivable from ${currentGrammar.start}`
      : `✕ REJECTED — "${els.strInput.value}" is not derivable from ${currentGrammar.start}`;
    els.headChip.className = 'head-chip ' + (session.verdict === 'accept' ? 'accept' : 'reject');
    els.headChip.textContent = session.verdict === 'accept' ? 'accepted' : 'rejected';
    stopPlay();
  } else {
    els.verdict.className = 'verdict';
    els.headChip.className = 'head-chip';
    els.headChip.textContent = `step ${cursor + 1} / ${session.steps.length}`;
  }
  els.stepBtn.disabled = atEnd;
  els.prevBtn.disabled = cursor <= 0;
  els.playBtn.disabled = atEnd;
}
function stopPlay(){ if(playTimer){ clearInterval(playTimer); playTimer = null; els.playBtn.classList.remove('playing'); } }
function currentSpeed(){
  const active = els.speedSelect.querySelector('.active');
  return active ? parseInt(active.dataset.speed, 10) : 1500;
}
function startPlay(){
  if(!session || cursor >= session.steps.length - 1) return;
  els.playBtn.classList.add('playing');
  const delay = currentSpeed();
  playTimer = setInterval(() => {
    if(!session || cursor >= session.steps.length - 1){ stopPlay(); return; }
    showStep(cursor + 1);
  }, delay);
}

function showBanner(kind, html){
  els.statusBanner.className = 'status-banner ' + kind;
  els.statusBanner.innerHTML = html;
}
function hideBanner(){ els.statusBanner.className = 'status-banner'; els.statusBanner.innerHTML=''; }

/* ---------- Grammar transformation display ---------- */
function conflictsDetail(conflicts){
  return conflicts.map(c => `M[${c.nt}, ${c.terminal}] = { ${c.prods.map(p => `${c.nt} → ${p}`).join('  |  ')} }`).join('; ');
}
function renderTransformLog(log){
  const container = document.getElementById('transformLog');
  container.innerHTML = '';
  log.forEach(entry => {
    const div = document.createElement('div');
    div.className = 'tl-entry tl-' + entry.step;
    const tag = entry.step === 'left-recursion' ? 'left recursion'
      : entry.step === 'factoring' ? 'left factoring'
      : entry.step === 'warn' ? 'warning' : 'note';
    let html = `<span class="tl-tag">${tag}</span><div class="tl-body">`;
    html += `<div class="tl-text">${escapeHtml(entry.text)}</div>`;
    if(entry.detail) html += `<div class="tl-detail">${escapeHtml(entry.detail)}</div>`;
    html += '</div>';
    div.innerHTML = html;
    container.appendChild(div);
  });
}
function renderAutoGrammar(autoGrammar, hasConflicts){
  document.getElementById('autoGrammarView').textContent = grammarToString(autoGrammar);
  const pill = document.getElementById('autoStatus');
  if(hasConflicts){
    pill.textContent = 'ambiguous — residual conflict';
    pill.className = 'status-pill bad';
  } else {
    pill.textContent = 'LL(1) ✓';
    pill.className = 'status-pill good';
  }
}
function renderComparisonLeft(autoGrammar, analysis){
  document.getElementById('autoCompareGrammar').textContent = grammarToString(autoGrammar);
  document.getElementById('autoCompareSets').innerHTML = firstFollowTableHtml(autoGrammar, analysis.FIRST, analysis.FOLLOW);
  document.getElementById('autoCompareTable').innerHTML = parseTableHtml(autoGrammar, analysis.table, analysis.conflicts);
}
function showResidualPanel(autoGrammar, analysis){
  const box = document.getElementById('residualBox');
  box.hidden = false;
  renderComparisonLeft(autoGrammar, analysis);
  const ta = document.getElementById('manualGrammarInput');
  if(!ta.dataset.touched) ta.value = grammarToString(autoGrammar);
  document.getElementById('manualResults').hidden = true;
  const status = document.getElementById('manualStatus');
  status.textContent = 'not yet applied';
  status.className = 'status-pill neutral';
}
function hideResidualPanel(){
  document.getElementById('residualBox').hidden = true;
}

function runParse(){
  stopPlay();
  els.resultPanel.style.display = 'none';
  els.analysisPanel.style.display = 'none';
  els.transformCard.style.display = 'none';
  hideBanner();

  let rawGrammar;
  try{
    rawGrammar = parseGrammarText(els.grammarInput.value);
  } catch(err){
    showBanner('error', `<span>⚠</span><span><b>Couldn't read grammar:</b> ${escapeHtml(err.message)}</span>`);
    return;
  }

  const { grammar: autoGrammar, log } = transformGrammar(rawGrammar);
  const analysis = analyzeGrammar(autoGrammar);

  currentGrammar = autoGrammar;
  currentTable = analysis.table;

  renderTransformLog(log);
  renderAutoGrammar(autoGrammar, analysis.conflicts.length > 0);
  renderAnalysis(autoGrammar, analysis);
  els.transformCard.style.display = 'block';
  els.analysisPanel.style.display = 'block';

  if(analysis.conflicts.length){
    showResidualPanel(autoGrammar, analysis);
    showBanner('error',
      `<span>⚠</span><span><b>Residual ambiguity — requires manual grammar redesign.</b> ` +
      `After auto-transformation the grammar still has ${analysis.conflicts.length} table conflict(s) ` +
      `that mechanical left-recursion removal / left factoring cannot resolve (the alternatives genuinely overlap ` +
      `in what they generate). Paste a redesigned equivalent grammar in the panel below and click “Apply”. ` +
      `The parse below currently uses the first-listed rule at each conflict, so results aren't guaranteed correct yet. ` +
      `${conflictsDetail(analysis.conflicts)}` +
      `</span>`);
  } else {
    hideResidualPanel();
    showBanner('ok', `<span>✓</span><span><b>LL(1) — no table conflicts.</b> The auto-transformed grammar is ready to parse.</span>`);
  }

  runParseSession(autoGrammar, analysis.table);
}

function runParseSession(grammar, table){
  const tokens = tokenizeInput(els.strInput.value, grammar.terminals);
  const unknown = tokens.filter(t => !grammar.terminals.includes(t));
  if(unknown.length){
    showBanner('error', `<span>⚠</span><span><b>Unrecognized symbol(s):</b> ${[...new Set(unknown)].join(', ')}. Valid terminals for this grammar: ${grammar.terminals.join(', ')}.</span>`);
    return;
  }
  if(tokens.length === 0){
    showBanner('warn', `<span>i</span><span>Enter a string to parse.</span>`);
    return;
  }

  session = parseString(grammar, table, tokens);
  cursor = -1;
  els.traceBody.innerHTML = '';
  session.steps.forEach((s, i) => renderTraceRow(s, i, session.verdict, session.steps.length));

  els.resultPanel.style.display = 'block';
  showStep(0);
  els.analysisPanel.scrollIntoView({behavior:'smooth', block:'start'});
}

function applyManualGrammar(){
  const ta = document.getElementById('manualGrammarInput');
  let manual;
  try{
    manual = parseGrammarText(ta.value);
  } catch(err){
    showBanner('error', `<span>⚠</span><span><b>Couldn't read the manual grammar:</b> ${escapeHtml(err.message)}</span>`);
    return;
  }
  const analysis = analyzeGrammar(manual);

  currentGrammar = manual;
  currentTable = analysis.table;

  document.getElementById('manualResults').hidden = false;
  document.getElementById('manualCompareGrammar').textContent = grammarToString(manual);
  document.getElementById('manualCompareSets').innerHTML = firstFollowTableHtml(manual, analysis.FIRST, analysis.FOLLOW);
  document.getElementById('manualCompareTable').innerHTML = parseTableHtml(manual, analysis.table, analysis.conflicts);

  const status = document.getElementById('manualStatus');
  if(analysis.conflicts.length){
    status.textContent = 'still ambiguous';
    status.className = 'status-pill bad';
    showBanner('error', `<span>⚠</span><span><b>Manual grammar still isn't LL(1)</b> — ${analysis.conflicts.length} conflict(s): ${conflictsDetail(analysis.conflicts)}</span>`);
  } else {
    status.textContent = 'LL(1) ✓';
    status.className = 'status-pill good';
    showBanner('ok', `<span>✓</span><span><b>Manual grammar is LL(1).</b> The FIRST/FOLLOW sets, table and parse below now use your redesigned grammar.</span>`);
  }

  renderAnalysis(manual, analysis);
  runParseSession(manual, analysis.table);
}

function resetAll(){
  stopPlay();
  session = null; cursor = -1;
  els.resultPanel.style.display = 'none';
  hideBanner();
  els.traceBody.innerHTML = '';
  els.stackCol.innerHTML = '';
  els.tape.innerHTML = '';
  els.actionReadout.innerHTML = '';
  els.verdict.className = 'verdict';
  // analysisPanel (FIRST/FOLLOW/table) is left visible — it describes the
  // grammar, not the in-progress parse, so there's no need to clear it.
}

els.parseBtn.addEventListener('click', runParse);
els.strInput.addEventListener('keydown', e => { if(e.key === 'Enter') runParse(); });
document.getElementById('applyManualBtn').addEventListener('click', applyManualGrammar);
document.getElementById('manualGrammarInput').addEventListener('input', e => { e.target.dataset.touched = '1'; });
els.prevBtn.addEventListener('click', () => { if(session) showStep(cursor - 1); });
els.stepBtn.addEventListener('click', () => { if(session) showStep(cursor + 1); });
els.playBtn.addEventListener('click', () => { playTimer ? stopPlay() : startPlay(); });
els.speedSelect.addEventListener('click', e => {
  const btn = e.target.closest('button');
  if(!btn) return;
  els.speedSelect.querySelectorAll('button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if(playTimer){ stopPlay(); startPlay(); }
});
els.resetBtn.addEventListener('click', resetAll);

document.addEventListener('keydown', e => {
  if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  const tag = (e.target.tagName || '').toLowerCase();
  if(tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return;
  if(e.key === 'ArrowRight') els.stepBtn.click();
  else els.prevBtn.click();
});