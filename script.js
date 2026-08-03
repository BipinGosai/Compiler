// EPS is the epsilon (empty string) symbol used throughout the grammar, FIRST/FOLLOW sets and the parse stack.
const EPS = 'ε';

/* ============================================================
   GRAMMAR TEXT PARSER
   ============================================================ */
// parseGrammarText: converts the grammar the user typed (e.g. "S -> a B | ε") into a structured object.
function parseGrammarText(text){
  // Split the input into lines, trim whitespace, and drop blank lines or lines starting with '#' (comments).
  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  // If nothing is left after filtering, the user forgot to write a grammar — raise a clear error.
  if(lines.length === 0) throw new Error('No productions found — write at least one line like "S -> a B".');

  // productions maps each non-terminal name to an array of productions (each production is an array of symbols).
  const productions = {};
  // order keeps the non-terminals in the order they first appeared, so the first one is the start symbol.
  const order = [];
  // isEpsToken recognizes any of the accepted spellings of epsilon ("eps", "epsilon", "ε") case-insensitively.
  const isEpsToken = (s) => /^(eps|epsilon|ε)$/i.test(s);

  // Process each grammar line one at a time.
  for(const line of lines){
    // Find the position of the arrow ("->" or "→") that separates the left side from the right side.
    const arrowIdx = line.search(/->|→/);
    // No arrow found → the line can't be a production, so tell the user which line is wrong.
    if(arrowIdx === -1) throw new Error(`Missing "->" in line: "${line}"`);
    // The arrow is 2 characters wide when it's "->" and 1 character wide when it's "→".
    const arrowLen = line.slice(arrowIdx).startsWith('->') ? 2 : 1;
    // Left-hand side: everything before the arrow (the non-terminal being defined).
    const lhs = line.slice(0, arrowIdx).trim();
    // Right-hand side: everything after the arrow (the alternatives, separated by "|").
    const rhsPart = line.slice(arrowIdx + arrowLen).trim();
    // Guard against an empty left side (e.g. "-> a b").
    if(!lhs) throw new Error(`Missing left-hand side in line: "${line}"`);
    // Guard against an empty right side (e.g. "S ->").
    if(!rhsPart) throw new Error(`Missing right-hand side in line: "${line}"`);

    // First time we see this non-terminal: create its production list and record its position in `order`.
    if(!productions[lhs]){ productions[lhs] = []; order.push(lhs); }
    // Split the right side on "|" to get the individual alternatives, trimming each one.
    const alts = rhsPart.split('|').map(a => a.trim());
    // Convert every alternative into an array of symbols.
    for(const alt of alts){
      // An empty alternative ("S -> | a b") or an explicit epsilon means the epsilon production.
      const symbols = (alt === '' || isEpsToken(alt))
        ? [EPS]
        // Otherwise split on whitespace into separate symbols, dropping empties, and normalize "eps" spellings to EPS.
        : alt.split(/\s+/).filter(Boolean).map(s => isEpsToken(s) ? EPS : s);
      // Append this production (array of symbols) to this non-terminal's list.
      productions[lhs].push(symbols);
    }
  }

  // The ordered list of non-terminals (deduplicated by construction in `order`).
  const nonterminals = order;
  // The start symbol is simply the first non-terminal the user wrote.
  const start = order[0];

  // Collect all terminals (lowercase symbols / literals) in first-seen order.
  const terminals = [];
  const seen = new Set(); // Set to avoid listing the same terminal twice.
  // Loop over every non-terminal...
  for(const nt of nonterminals){
    // ...every production of that non-terminal...
    for(const prod of productions[nt]){
      // ...every symbol inside that production...
      for(const sym of prod){
        // Epsilon is not a real terminal — skip it.
        if(sym === EPS) continue;
        // Non-terminals are not terminals — skip them.
        if(nonterminals.includes(sym)) continue;
        // First time seeing this symbol → it's a new terminal, add it to the list.
        if(!seen.has(sym)){ seen.add(sym); terminals.push(sym); }
      }
    }
  }

  // Return the fully structured grammar the rest of the app works with.
  return { productions, nonterminals, start, terminals };
}

/* ============================================================
   GRAMMAR TRANSFORMATION
   Raw/ambiguous grammar → LL(1)-ready, with a human-readable
   log of every rewrite (displayed in the UI).
   ============================================================ */
// escapeHtml: neutralizes HTML characters in user text so it can be shown safely inside the DOM.
function escapeHtml(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
// fmtAlt: pretty-prints a single production; a lone epsilon is shown as "ε", otherwise symbols are joined with spaces.
function fmtAlt(prod){
  return (prod.length === 1 && prod[0] === EPS) ? EPS : prod.join(' ');
}
// fmtProds: pretty-prints all alternatives of a non-terminal as "NT → alt1 | alt2 | ...".
function fmtProds(nt, prods){
  return `${nt} → ${prods.map(fmtAlt).join('  |  ')}`;
}
// dedupeProds: removes duplicate productions (identical symbol sequences) while preserving order.
function dedupeProds(prods){
  const seen = new Set(), out = []; // seen: fingerprints of productions already kept; out: the cleaned list.
  for(const p of prods){
    const key = p.join('\u0000'); // Join with a null char so ["a","bc"] ≠ ["ab","c"] (no accidental collisions).
    if(!seen.has(key)){ seen.add(key); out.push(p); } // Keep the production only if we haven't seen this exact sequence.
  }
  return out;
}
// freshName: generates a unique name (e.g. "S'", "S''") not already taken by another non-terminal.
function freshName(base, taken){
  let name = base, primes = 0; // Start with the base name; add primes until the name is free.
  while(taken.has(name)){ primes++; name = base + "'".repeat(primes); } // Keep adding apostrophes until unused.
  return name;
}
// rebuildGrammar: re-derives the terminal list from the (possibly rewritten) productions.
function rebuildGrammar(productions, nonterminals, start){
  const terminals = []; // Output list of terminals, in first-seen order.
  const seen = new Set(); // Remembers terminals we've already recorded.
  for(const nt of nonterminals){ // For each non-terminal...
    for(const prod of productions[nt] || []){ // ...each production (defaulting to [] for safety)...
      for(const sym of prod){ // ...each symbol in the production...
        // Skip epsilon, non-terminals and already-seen terminals.
        if(sym === EPS || nonterminals.includes(sym) || seen.has(sym)) continue;
        seen.add(sym); terminals.push(sym); // Record this as a new terminal.
      }
    }
  }
  // Return a fresh grammar object with the same productions but a recomputed terminal list.
  return { productions, nonterminals: nonterminals.slice(), start, terminals };
}
// grammarToString: renders a grammar back to plain "NT -> a b | c" text, one line per non-terminal.
function grammarToString(grammar){
  return grammar.nonterminals
    .map(nt => `${nt} -> ${grammar.productions[nt].map(fmtAlt).join(' | ')}`) // One formatted line per non-terminal.
    .join('\n'); // Join the lines with newlines.
}

// transformGrammar: the heart of the auto-transformation — removes left recursion, then left-factors,
// and logs every rewrite so the user can see exactly what happened and why.
function transformGrammar(grammar){
  const log = []; // Accumulates human-readable entries explaining each transformation step.
  const productions = {}; // Working copy of the productions, so we never mutate the caller's grammar.
  grammar.nonterminals.forEach(nt => productions[nt] = grammar.productions[nt].map(p => [...p])); // Deep-copy each production (array of arrays).
  const nonterminals = [...grammar.nonterminals]; // Working copy of the non-terminal list (new ones get inserted here).
  const start = grammar.start; // The start symbol never changes during transformation.
  const taken = new Set(nonterminals); // Names already in use, so freshly generated non-terminals get unique names.
  const addNT = (after, name) => { // Helper: insert a new non-terminal right after another one in the list.
    const idx = nonterminals.indexOf(after); // Find where `after` sits in the list.
    nonterminals.splice(idx + 1, 0, name); // Insert `name` at the next position.
    taken.add(name); // Reserve the name so it isn't reused.
  };

  /* ---- Step 1: immediate left-recursion elimination ---- */
  // Explain Step 1 to the user: A → Aα₁ | … | Aαₖ | β₁ | … | βₘ becomes A → βA′ , A′ → αA′ | ε.
  log.push({ step:'note',
    text:'Step 1 — eliminate immediate left recursion: every A → Aα₁ | … | Aαₖ | β₁ | … | βₘ  becomes  A → βA′ , A′ → αA′ | ε' });

  let removed = 0; // Counts how many non-terminals were rewritten (used to decide the "nothing to do" note).
  for(const A of [...nonterminals]){ // Iterate over a snapshot of the list, because new non-terminals appear mid-loop.
    const prods = productions[A] || []; // This non-terminal's current productions.
    const alphas = prods.filter(p => p[0] === A); // "Recursive" alternatives that begin with A itself.
    const betas  = prods.filter(p => p[0] !== A); // "Base" alternatives that begin with something else.
    if(alphas.length === 0) continue; // No recursion here — nothing to eliminate for A.
    if(betas.length === 0){ // Every alternative starts with A: there is no base case, the grammar can't terminate.
      log.push({ step:'warn',
        text:`${A}: every alternative starts with ${A}, so there is no non-recursive base case. Left as-is (this nonterminal can never terminate).` });
      continue; // Leave A untouched and move on — there is nothing safe to rewrite.
    }
    const Ap = freshName(A, taken); // Invent a new non-terminal name, e.g. A' or A''.
    const newA = betas.map(beta => // Rewrite each base alternative to end with the new non-terminal:
      (beta.length === 1 && beta[0] === EPS) ? [Ap] : [...beta, Ap]); // ε becomes just A'; otherwise "β A'".
    const primeProds = []; // Productions for the new non-terminal A' (the "tail" of the recursion).
    for(const alpha of alphas){ // For every recursive alternative A → A α:
      const rest = alpha.slice(1); // Drop the leading A, keeping only the α part.
      if(rest.length === 0) continue; // A → A with nothing after it contributes no useful tail — skip.
      if(rest.length === 1 && rest[0] === EPS) continue; // A → A ε is empty — skip.
      primeProds.push([...rest, Ap]); // A' → α A' (right recursion).
    }
    primeProds.push([EPS]); // A' → ε, the base case that ends the recursion.
    productions[A]  = dedupeProds(newA); // Store the rewritten productions for A.
    productions[Ap] = dedupeProds(primeProds); // Store the productions for the new A'.
    addNT(A, Ap); // Register A' right after A in the non-terminal ordering (nice for display).
    removed++; // Count this rewrite.
    log.push({ step:'left-recursion', // Log the rewrite for the UI, before and after.
      text:`${A} had ${alphas.length} recursive alternative(s). Rewritten as:`,
      detail:`${fmtProds(A, prods)}   ⇒   ${fmtProds(A, productions[A])}   and   ${fmtProds(Ap, productions[Ap])}` });
  }
  if(removed === 0) log.push({ step:'note', text:'No immediate left recursion found — nothing to eliminate.' }); // Nothing happened → tell the user.

  /* ---- Step 2: left factoring (applied repeatedly) ---- */
  // Explain Step 2 to the user: A → αβ₁ | αβ₂ becomes A → αA′ , A′ → β₁ | β₂, repeated until no prefixes remain.
  log.push({ step:'note',
    text:'Step 2 — left-factor common prefixes: every A → αβ₁ | αβ₂ | …  becomes  A → αA′ , A′ → β₁ | β₂ | …  (repeat until none remain)' });

  // commonPrefixLen: length of the longest shared prefix of two productions (stops at epsilon or a mismatch).
  const commonPrefixLen = (a, b) => {
    let k = 0; // Position counter, i.e. how many leading symbols match so far.
    while(k < a.length && k < b.length && a[k] !== EPS && b[k] !== EPS && a[k] === b[k]) k++; // Advance while symbols are equal and neither is ε.
    return k; // k is the shared prefix length.
  };

  let factored = 0, guard = 0; // factored: how many factorings happened; guard: safety valve for the while loop.
  while(guard++ < 100){ // Keep repeating until a full pass changes nothing (or 100 passes, whichever first).
    let changedPass = false; // Tracks whether this pass did any factoring at all.
    for(const A of [...nonterminals]){ // For each non-terminal (snapshot, since new ones get added).
      const prods = productions[A] || []; // Its current productions.
      let bestLen = 0, bestPrefix = null; // Best (longest) common prefix found so far, and its symbol list.
      for(let i = 0; i < prods.length; i++){ // Compare every pair of alternatives:
        for(let j = i + 1; j < prods.length; j++){ // j starts after i so each pair is only checked once.
          const len = commonPrefixLen(prods[i], prods[j]); // How much of these two share?
          if(len > bestLen){ bestLen = len; bestPrefix = prods[i].slice(0, len); } // Keep the longest prefix found.
        }
      }
      if(!bestPrefix) continue; // No two alternatives share a prefix → nothing to factor for A.
      const matching = prods.filter(p => commonPrefixLen(p, bestPrefix) === bestPrefix.length); // Alternatives that start with the common prefix.
      const rest     = prods.filter(p => commonPrefixLen(p, bestPrefix) !== bestPrefix.length); // Alternatives that don't.
      const Ap = freshName(A, taken); // Invent a new non-terminal for the factored-out tails.
      const primeProds = matching.map(p => { // For each matching alternative, the part after the prefix becomes A' → ...
        const rem = p.slice(bestPrefix.length); // Everything after the shared prefix.
        return rem.length ? rem : [EPS]; // If nothing remains, the tail is just ε.
      });
      productions[A]  = dedupeProds([...rest, [...bestPrefix, Ap]]); // A → (unmatched alternatives) | prefix A'.
      productions[Ap] = dedupeProds(primeProds); // A' → tail₁ | tail₂ | ...
      addNT(A, Ap); // Register the new A' in the non-terminal ordering.
      factored++; // Count this factoring.
      changedPass = true; // Mark the pass as productive so the loop runs again.
      log.push({ step:'factoring', // Log the rewrite for the UI.
        text:`${A} had ${matching.length} alternative(s) sharing the common prefix “${fmtAlt(bestPrefix)}”. Rewritten as:`,
        detail:`${fmtProds(A, prods)}   ⇒   ${fmtProds(A, productions[A])}   and   ${fmtProds(Ap, productions[Ap])}` });
    }
    if(!changedPass) break; // No factoring happened in this full pass → we're done.
  }
  if(factored === 0) log.push({ step:'note', text:'No common prefixes found — nothing to factor.' }); // Nothing happened → tell the user.

  // Recompute terminals from the rewritten grammar and return it along with the transformation log.
  return { grammar: rebuildGrammar(productions, nonterminals, start), log };
}

/* A suggested "manually redesigned" grammar: inlines nonterminals that are
   referenced bare and have a single production, e.g.
     A' -> A | ε   with   A -> a b A'   becomes   A' -> a b A' | ε
   This is a conservative simplification that never changes the language and
   usually reads as a cleaner LL(1) design (the "semantic simplification" step
   a human would do by hand). Fallback: the input grammar unchanged. */
function suggestManualGrammar(grammar){
  try{ // The whole routine is best-effort; any failure just returns the input grammar unchanged.
    const prods = {}; // Working copy of the productions.
    grammar.nonterminals.forEach(nt => prods[nt] = grammar.productions[nt].map(p => [...p])); // Deep-copy each production.
    const nts = [...grammar.nonterminals]; // Working copy of the non-terminal list.
    const isNT = s => nts.includes(s); // Quick membership test for "is this symbol a non-terminal?".

    /* ---- Pass 1: inline single-use non-terminals ---- */
    let changed = true, guard = 0; // Loop control: keep going until a pass makes no changes.
    while(changed && guard++ < 50){ // Max 50 passes as a safety net.
      changed = false; // Reset the change flag for this pass.
      for(const Y of nts){ // Consider each non-terminal Y (except the start symbol, handled next line).
        if(Y === grammar.start) continue; // Never touch the start symbol.
        const pY = prods[Y] || []; // Y's productions.
        if(!pY.some(p => p.length === 1 && p[0] === EPS)) continue; // Y must have an ε production to match the A' -> A | ε shape.
        const rest = pY.filter(p => !(p.length === 1 && p[0] === EPS)); // The non-ε alternatives of Y.
        if(rest.length !== 1 || rest[0].length !== 1) continue; // Y must have exactly one other alternative, and it must be a single symbol.
        const A = rest[0][0]; // That single symbol is the non-terminal to inline.
        if(!isNT(A)) continue; // Only inline real non-terminals.
        const pA = prods[A] || []; // A's productions.
        if(pA.length !== 1) continue; // Inlining is only safe when A has exactly one production.
        const gamma = pA[0]; // That single production.
        if(gamma.length === 1 && gamma[0] === EPS) continue; // Don't inline a pure-ε non-terminal.
        if(gamma[0] === Y) continue; // Avoid creating a cycle (Y inlining A, whose production starts with Y).
        prods[Y] = dedupeProds([[...gamma], [EPS]]); // Replace "Y -> A | ε" with "Y -> γ | ε" where γ is A's body.
        changed = true; // Mark the pass as productive.
      }
    }

    /* ---- Tail absorption: a right-recursive "tail" nonterminal that the
       following context re-generates can be dropped.  If Y -> T Y | ε, Y is
       used only as the trailing symbol of X -> βY, the only use of X is
       followed immediately by T (… X T …), and T is a one-terminal semigroup
       (T -> t U | t  with  U -> t U | ε), then the T* produced by Y is
       re-produced by the T that follows X, so X -> βY becomes X -> β and Y
       disappears.  Language-preserving because L(T) = t+ is a semigroup:
       T*·T* collapses into T's own t+.  Example:  B -> b B', B' -> C B' | ε
       with  S -> … B C …  and  C -> c C' | c  simplifies to  B -> b — the
       trailing c's merge into C's c+. */
    // isTailSemigroup: checks whether non-terminal T generates t+ (one or more of a single terminal).
    const isTailSemigroup = T => {
      const pT = prods[T] || []; // T's productions.
      if(pT.length === 0) return false; // No productions → not a semigroup.
      let t = null; // The single terminal that must appear in every production; null until first seen.
      for(const p of pT){ // Examine every production of T:
        if(p.length === 1){ // Case "t" (a single symbol):
          const s = p[0]; // That symbol.
          if(s === EPS || isNT(s)) return false; // ε or a non-terminal is not allowed in a semigroup.
          if(t === null) t = s; else if(s !== t) return false; // Remember the terminal; if a different one appears, it's not a semigroup.
        } else if(p.length === 2 && p[0] !== EPS){ // Case "t W" (terminal followed by a helper):
          const s = p[0], W = p[1]; // The terminal and the helper non-terminal.
          if(isNT(s)) return false; // First symbol must be a terminal.
          if(t === null) t = s; else if(s !== t) return false; // All productions must use the same terminal.
          if(!isNT(W)) return false; // Second symbol must be a non-terminal.
          const pW = prods[W] || []; // The helper's productions.
          if(pW.length !== 2) return false; // Helper must have exactly two productions (base + recursive).
          if(!pW.every(q => // Both must be "W -> ε" or "W -> t W":
            (q.length === 1 && q[0] === EPS) || // Case W -> ε.
            (q.length === 2 && q[0] === t && q[1] === W))) return false; // Case W -> t W with the same terminal t.
        } else {
          return false; // Any other production shape disqualifies T.
        }
      }
      return t !== null; // A single recurring terminal was found → T is a t+ semigroup.
    };

    /* ---- Pass 2: apply tail absorption ---- */
    changed = true; guard = 0; // Reuse the same loop-control pattern for a new set of passes.
    while(changed && guard++ < 50){ // Keep going until a pass makes no change.
      changed = false; // Reset the flag for this pass.
      for(const Y of nts){ // Consider each non-terminal Y (the potential tail to absorb):
        if(Y === grammar.start) continue; // Never absorb the start symbol.
        const pY = prods[Y] || []; // Y's productions.
        if(pY.length !== 2) continue; // Y must have exactly two productions (the T Y | ε shape).
        const hasEps = pY.some(p => p.length === 1 && p[0] === EPS); // One must be ε.
        const tails = pY.filter(p => p.length === 2 && p[1] === Y); // The other must be "T Y" (right-recursive).
        if(!hasEps || tails.length !== 1) continue; // Both conditions must hold: an ε production and exactly one recursive tail.
        const T = tails[0][0]; // The first symbol of the recursive tail is the "generator" non-terminal T.
        if(!isNT(T) || T === Y) continue; // T must be a real non-terminal, distinct from Y.
        // Find every place Y is used across the grammar.
        const uses = []; // Collects { L, p, i }: non-terminal L, its production p, and position i of Y inside it.
        for(const L of nts){ // Scan every non-terminal L:
          if(L === Y) continue; // Ignore Y's own productions.
          for(const p of prods[L] || []){ // ...every production of L:
            for(let i = 0; i < p.length; i++) if(p[i] === Y) uses.push({ L, p, i }); // Record each occurrence of Y.
          }
        }
        if(uses.length !== 1) continue; // Y must be used in exactly one place for absorption to be safe.
        const u = uses[0]; // That single use.
        if(u.i !== u.p.length - 1) continue; // Y must be the LAST symbol of that production (X -> βY).
        const X = u.L; // The non-terminal X that ends with Y.
        const beta = u.p.slice(0, u.i); // The part of X's production before Y (the β in X -> βY).
        if(beta.length === 0 || beta.includes(X)) continue; // β must be non-empty and must not create a cycle with X.
        // Find every use of X itself, because X must be followed by T everywhere it appears.
        const xUses = []; // Collects uses of X the same way we collected uses of Y.
        for(const L of nts){
          if(L === X) continue; // Ignore X's own productions.
          for(const p of prods[L] || []){
            for(let i = 0; i < p.length; i++) if(p[i] === X) xUses.push({ L, p, i }); // Record each occurrence of X.
          }
        }
        if(xUses.length !== 1) continue; // X must be used in exactly one place.
        const xu = xUses[0]; // That single use.
        if(xu.p[xu.i + 1] !== T) continue; // X must be immediately followed by T (the generator) — that's the key context that re-produces the tail.
        if(!isTailSemigroup(T)) continue; // T must generate t+ (a semigroup), otherwise the merge changes the language.
        // All conditions met: replace "X -> βY" with "X -> β" and delete Y entirely.
        prods[X] = dedupeProds(prods[X].map(p => (p === u.p ? beta : p))); // Swap the βY production for β in X.
        delete prods[Y]; // Remove Y from the grammar.
        changed = true; // Mark the pass as productive.
      }
    }

    // Reachability cleanup: some non-terminals may have become unreachable after deletion — remove them.
    const reach = new Set([grammar.start]); // Start from the start symbol.
    const stack = [grammar.start]; // Worklist for the traversal.
    while(stack.length){ // DFS: while there are non-terminals left to explore:
      const nt = stack.pop(); // Take one off the stack.
      for(const prod of prods[nt] || []){ // Look at each of its productions:
        for(const sym of prod){ // ...each symbol:
          if(isNT(sym) && !reach.has(sym)){ reach.add(sym); stack.push(sym); } // Newly found non-terminal → mark it and explore it later.
        }
      }
    }
    const finalNTs = nts.filter(nt => reach.has(nt)); // Keep only the non-terminals that are still reachable.
    return rebuildGrammar(prods, finalNTs, grammar.start); // Return the cleaned-up grammar with recomputed terminals.
  }catch(err){
    return grammar; // Any unexpected problem → fall back to the input grammar untouched.
  }
}

// analyzeGrammar: one-stop computation of FIRST, FOLLOW and the LL(1) parse table for a grammar.
function analyzeGrammar(grammar){
  const { FIRST, firstOfSeq } = computeFirstSets(grammar); // Step 1: FIRST sets (and a helper for sequences).
  const FOLLOW = computeFollowSets(grammar, FIRST, firstOfSeq); // Step 2: FOLLOW sets, built on top of FIRST.
  const { table, conflicts } = buildParseTable(grammar, FIRST, FOLLOW, firstOfSeq); // Step 3: the predictive table + any conflicts.
  return { FIRST, FOLLOW, table, conflicts }; // Bundle everything the UI needs.
}

/* ============================================================
   FIRST / FOLLOW / TABLE (generic, parameterized by grammar)
   ============================================================ */
// isNT: is the symbol a non-terminal in this grammar?
function isNT(grammar, s){ return grammar.nonterminals.includes(s); }
// isTerminalSym: is the symbol a terminal (not epsilon, not a non-terminal)?
function isTerminalSym(grammar, s){ return s !== EPS && !isNT(grammar, s); }

// computeFirstSets: computes FIRST(nt) for every non-terminal using fixpoint iteration.
function computeFirstSets(grammar){
  const FIRST = {}; // Maps each non-terminal to a Set of symbols in its FIRST set.
  grammar.nonterminals.forEach(nt => FIRST[nt] = new Set()); // Start every FIRST set empty.

  // firstOfSeq: computes FIRST for a sequence of symbols (used both for productions and inside FOLLOW).
  function firstOfSeq(seq){
    const result = new Set(); // The accumulated FIRST set for the sequence.
    let allEps = true; // Assumes the whole sequence can derive ε until proven otherwise.
    for(const sym of seq){ // Walk the sequence left to right:
      if(sym === EPS) continue; // ε contributes nothing and doesn't stop us.
      if(isTerminalSym(grammar, sym)){ result.add(sym); allEps = false; break; } // Terminal → it's in FIRST; sequence can't be all-ε; stop.
      const f = FIRST[sym] || new Set(); // Non-terminal → its FIRST set.
      f.forEach(x => { if(x !== EPS) result.add(x); }); // Add everything of it except ε.
      if(!f.has(EPS)){ allEps = false; break; } // If this non-terminal can't be ε, stop here.
    }
    if(allEps) result.add(EPS); // Reached the end and everything could be ε → ε is in FIRST of the sequence.
    return result;
  }

  let changed = true; // Fixpoint loop control.
  while(changed){ // Keep adding symbols until a full pass changes nothing:
    changed = false; // Reset for this pass.
    for(const nt of grammar.nonterminals){ // For each non-terminal:
      for(const prod of grammar.productions[nt]){ // For each of its productions:
        const f = firstOfSeq(prod); // FIRST of that production's symbol sequence.
        f.forEach(sym => { if(!FIRST[nt].has(sym)){ FIRST[nt].add(sym); changed = true; } }); // Add any new symbol and flag the change.
      }
    }
  }
  return { FIRST, firstOfSeq }; // Return the sets plus the sequence helper (FOLLOW needs it too).
}

// computeFollowSets: computes FOLLOW(nt) for every non-terminal, again by fixpoint iteration.
function computeFollowSets(grammar, FIRST, firstOfSeq){
  const FOLLOW = {}; // Maps each non-terminal to a Set of symbols that may follow it.
  grammar.nonterminals.forEach(nt => FOLLOW[nt] = new Set()); // Start every FOLLOW set empty.
  FOLLOW[grammar.start].add('$'); // $ (end of input) is always in FOLLOW of the start symbol.

  let changed = true; // Fixpoint loop control.
  while(changed){ // Keep adding symbols until stable:
    changed = false; // Reset for this pass.
    for(const A of grammar.nonterminals){ // For each non-terminal A:
      for(const prod of grammar.productions[A]){ // For each of its productions:
        for(let i = 0; i < prod.length; i++){ // For each symbol position in that production:
          const B = prod[i]; // The symbol at this position.
          if(!isNT(grammar, B)) continue; // Only non-terminals get FOLLOW entries — skip terminals and ε.
          const beta = prod.slice(i + 1); // Everything after B in this production.
          const firstBeta = firstOfSeq(beta); // FIRST of that remainder.
          firstBeta.forEach(sym => { if(sym !== EPS && !FOLLOW[B].has(sym)){ FOLLOW[B].add(sym); changed = true; } }); // Rule 1: FIRST(β) ⊆ FOLLOW(B).
          if(firstBeta.has(EPS)){ // β can be empty (i.e. B is at the end, or β → ε):
            FOLLOW[A].forEach(sym => { if(!FOLLOW[B].has(sym)){ FOLLOW[B].add(sym); changed = true; } }); // Rule 2: FOLLOW(A) ⊆ FOLLOW(B).
          }
        }
      }
    }
  }
  return FOLLOW; // Return the completed FOLLOW sets.
}

// buildParseTable: constructs the LL(1) predictive parsing table M[nonterminal, terminal] → production(s).
function buildParseTable(grammar, FIRST, FOLLOW, firstOfSeq){
  const table = {}; // M[A][t] = { prods: [...] } — the parse table, keyed by non-terminal then terminal.
  const conflicts = []; // Records every table cell that ended up with more than one production (LL(1) conflict).
  grammar.nonterminals.forEach(nt => table[nt] = {}); // Give every non-terminal its own row.

  function place(A, t, prod){ // Helper: put production `prod` into cell M[A][t].
    if(!table[A][t]){ table[A][t] = { prods:[prod] }; } // Empty cell → create it with this one production.
    else { table[A][t].prods.push(prod); } // Occupied cell → append (this later becomes a conflict).
  }

  // Fill the table: for every production, decide which columns it belongs to.
  for(const A of grammar.nonterminals){ // For each non-terminal A:
    for(const prod of grammar.productions[A]){ // For each of its productions:
      const f = firstOfSeq(prod); // FIRST of the production.
      f.forEach(t => { if(t !== EPS) place(A, t, prod); }); // Every terminal in FIRST(prod) gets this production (the standard rule).
      if(f.has(EPS)){ // If the production derives ε:
        FOLLOW[A].forEach(t => place(A, t, prod)); // Then it also goes into every cell under FOLLOW(A).
      }
    }
  }

  // Conflict detection: any cell holding two or more productions is an LL(1) conflict.
  for(const A of grammar.nonterminals){ // Check every non-terminal's row:
    for(const t of Object.keys(table[A])){ // ...every filled column:
      if(table[A][t].prods.length > 1){ // More than one production in the cell?
        conflicts.push({ nt: A, terminal: t, prods: table[A][t].prods.map(p => p.join(' ')) }); // Record the conflict for the UI.
      }
    }
  }

  return { table, conflicts }; // Return the table and any conflicts found.
}

/* ============================================================
   NON-RECURSIVE PREDICTIVE PARSER
   ============================================================ */
// tokenizeInput: turns the input string into a list of tokens using the grammar's terminals.
function tokenizeInput(str, terminals){
  const allSingleChar = terminals.length > 0 && terminals.every(t => t.length === 1); // True when every terminal is exactly one character.
  if(allSingleChar) return str.replace(/\s+/g, '').split('').filter(Boolean); // Single-char terminals → strip spaces and split every character.
  return str.trim().split(/\s+/).filter(Boolean); // Otherwise split the trimmed input on whitespace into tokens.
}

// parseString: runs the non-recursive predictive parser (stack + input) and records every step.
function parseString(grammar, table, inputTokens){
  const tokens = inputTokens.concat(['$']); // Append the end-of-input marker.
  const stack = ['$', grammar.start]; // The parse stack, starting with $ under the start symbol.
  const steps = []; // One snapshot per step, for the animated trace table.
  let ip = 0, verdict = null, guard = 0; // ip: input pointer; verdict: accept/reject; guard: infinite-loop safety valve.

  const snapshot = (action) => steps.push({ stack: [...stack], remaining: tokens.slice(ip).join(' '), action }); // Record the current state for the UI.

  while(guard++ < 2000){ // Main parse loop, capped at 2000 steps for safety:
    const top = stack[stack.length - 1]; // Top of the stack.
    const cur = tokens[ip]; // Current input token.

    if(top === '$' && cur === '$'){ snapshot('Stack and input both exhausted → ACCEPT'); verdict = 'accept'; break; } // Both exhausted → the string is accepted.

    if(!isNT(grammar, top)){ // The stack top is a terminal (or $):
      if(top === cur){ snapshot(`Match "${top}"`); stack.pop(); ip++; } // It matches the input → consume both (pop the stack, advance the input).
      else { snapshot(`Expected "${top}" but found "${cur === '$' ? 'end of input' : cur}" → REJECT`); verdict = 'reject'; break; } // Mismatch → reject.
    } else { // The stack top is a non-terminal → consult the parse table:
      const cell = table[top][cur]; // Look up M[top, current input].
      if(!cell){ snapshot(`No rule for M[${top}, ${cur}] → REJECT`); verdict = 'reject'; break; } // No rule for this combination → reject.
      const prod = cell.prods[0]; // Pick the first listed production (on conflict cells, the UI notes results aren't guaranteed).
      snapshot(`${top} → ${prod.join(' ')}`); // Record the expansion step.
      stack.pop(); // Remove the non-terminal from the stack.
      if(!(prod.length === 1 && prod[0] === EPS)) for(let i = prod.length - 1; i >= 0; i--) stack.push(prod[i]); // Push the production's symbols in reverse (ε means nothing to push).
    }
  }
  if(verdict === null){ verdict = 'reject'; steps.push({ stack:[...stack], remaining: tokens.slice(ip).join(' '), action:'Step limit reached → REJECT (possible non-terminating grammar)' }); } // Loop cap hit → reject as non-terminating.
  return { steps, verdict, tokens }; // Return the full trace, the verdict and the token list.
}

/* ============================================================
   APP STATE + WIRING
   ============================================================ */
let currentGrammar = null, currentTable = null; // The grammar + table currently being used (set after each analysis).
let session = null, cursor = -1, playTimer = null; // session: current parse trace; cursor: current step index; playTimer: auto-play interval id.

// els: a central map of all DOM elements the script touches, so they're referenced once and reused everywhere.
const els = {
  grammarInput: document.getElementById('grammarInput'), // The grammar textarea (user types productions here).
  strInput: document.getElementById('strInput'), // The input string field (the string to test).
  parseBtn: document.getElementById('parseBtn'), // The "Parse" button.
  statusBanner: document.getElementById('statusBanner'), // The banner that shows errors / OK messages.
  transformCard: document.getElementById('transformCard'), // The card explaining the auto-transformation steps.
  analysisPanel: document.getElementById('analysisPanel'), // The FIRST/FOLLOW + parse table panel.
  resultPanel: document.getElementById('resultPanel'), // The animated parse visualization panel.
  stepBtn: document.getElementById('stepBtn'), // "Next step" button.
  prevBtn: document.getElementById('prevBtn'), // "Previous step" button.
  playBtn: document.getElementById('playBtn'), // "Play" (auto-advance) button.
  resetBtn: document.getElementById('resetBtn'), // "Reset" button.
  speedSelect: document.getElementById('speedSelect'), // The speed selector dropdown (play speed).
  speedBtns: () => [...document.querySelectorAll('.seg-select .active')], // (Helper) currently active speed button(s) — unused by the main flow.
  headChip: document.getElementById('headChip'), // The chip in the result header (shows "step n / m" or "accepted"/"rejected").
  stackCol: document.getElementById('stackCol'), // The vertical stack visualization column.
  tape: document.getElementById('tape'), // The input tape (horizontal strip of tokens).
  actionReadout: document.getElementById('actionReadout'), // The line describing the current action (match / expand / accept / reject).
  verdict: document.getElementById('verdict'), // The final verdict banner text.
  traceBody: document.querySelector('#traceTable tbody'), // The body of the full trace table.
};

// blockClass: decides the CSS class of a stack block based on the symbol type.
function blockClass(sym){
  if(sym === '$') return 'end'; // $ gets the "end" style.
  if(currentGrammar && isNT(currentGrammar, sym)) return 'nt'; // Non-terminals get the "nt" style.
  return 'term'; // Everything else (terminals) gets the "term" style.
}
// renderStack: draws the current stack as colored blocks, reusing DOM nodes to avoid flicker.
function renderStack(stackArr){
  const kids = [...els.stackCol.children]; // Existing blocks (to reuse or remove).
  stackArr.forEach((sym, i) => { // For each symbol in the stack:
    let div = kids[i]; // Grab the block at this position, if any.
    if(!div || div._key !== sym){ // No block there, or it holds a different symbol:
      div = document.createElement('div'); // Create a fresh block.
      els.stackCol.appendChild(div); // Append it to the column.
    }
    div._key = sym; // Remember which symbol this block displays (for reuse detection).
    div.className = 'stack-block ' + blockClass(sym); // Apply the type-based style.
    div.innerHTML = `<span class="sidx">${i}</span><span class="ssym">${sym}</span>`; // Show the index and the symbol.
  });
  while(els.stackCol.children.length > stackArr.length) els.stackCol.removeChild(els.stackCol.lastChild); // Remove any leftover blocks beyond the stack size.
}
// renderTape: draws the input tape, highlighting the current token and shading consumed ones.
function renderTape(tokens, ip){
  const kids = [...els.tape.children]; // Existing tape cells (to reuse or remove).
  tokens.forEach((t, i) => { // For each token:
    let span = kids[i]; // Grab the cell at this position, if any.
    if(!span || span._key !== t){ // No cell there, or it shows a different token:
      span = document.createElement('span'); // Create a fresh cell.
      els.tape.appendChild(span); // Append it to the tape.
    }
    span._key = t; // Remember the token for reuse detection.
    span.className = 'sym ' + (i < ip ? 'consumed' : (i === ip ? 'current' : '')); // Past → "consumed", at pointer → "current", ahead → plain.
    span.textContent = t; // Show the token.
  });
  while(els.tape.children.length > tokens.length) els.tape.removeChild(els.tape.lastChild); // Remove leftover cells beyond the token count.
}
// renderAction: renders the action readout line, decorating expansion arrows and matches differently.
function renderAction(step, idx){
  const html = step.action.includes('→') // Is this an expansion action (contains "→")?
    ? step.action.replace('→', '<span class="act-arrow">→</span>') // Yes → style the arrow.
    : `<span class="act-match">${step.action}</span>`; // No (match / accept / reject) → style as a match action.
  els.actionReadout.innerHTML = `<span class="step-badge">step ${idx+1}</span>${html}`; // Prepend the step badge and insert the action text.
}
// renderTraceRow: appends one row to the full trace table, coloring the final row by verdict.
function renderTraceRow(step, idx, verdictAtEnd, total){
  const tr = document.createElement('tr'); // The new table row.
  const isLast = idx === total - 1; // Is this the final step of the trace?
  if(isLast && verdictAtEnd === 'accept') tr.classList.add('accept-row'); // Last row + accepted → green highlight.
  else if(isLast && verdictAtEnd === 'reject') tr.classList.add('reject-row'); // Last row + rejected → red highlight.
  tr.innerHTML = `<td>${idx+1}</td><td>${step.stack.join(' ')}</td><td>${step.remaining || 'ε'}</td><td>${step.action}</td>`; // Columns: step #, stack, remaining input, action.
  els.traceBody.appendChild(tr); // Add the row to the table body.
}

/* ---------- FIRST/FOLLOW + parse table display ---------- */
// firstFollowTableHtml: builds the HTML for the FIRST/FOLLOW table.
function firstFollowTableHtml(grammar, FIRST, FOLLOW){
  let html = '<table><thead><tr><th>Non-terminal</th><th>FIRST</th><th>FOLLOW</th></tr></thead><tbody>'; // Header row.
  grammar.nonterminals.forEach(nt => { // One row per non-terminal:
    html += `<tr><td>${nt}</td><td class="set-cell">{ ${[...FIRST[nt]].join(', ')} }</td><td class="set-cell">{ ${[...FOLLOW[nt]].join(', ')} }</td></tr>`; // Name + FIRST set + FOLLOW set.
  });
  return html + '</tbody></table>'; // Close the table.
}
// parseTableHtml: builds the HTML for the LL(1) parse table, highlighting conflict cells.
function parseTableHtml(grammar, table, conflicts){
  const cols = [...grammar.terminals, '$']; // Columns: every terminal plus the end marker.
  const conflictSet = new Set(conflicts.map(c => c.nt + '|' + c.terminal)); // Which cells have conflicts (as "NT|terminal" keys).
  let html = `<table><thead><tr><th>NT</th>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>`; // Header row with all columns.
  grammar.nonterminals.forEach(nt => { // One row per non-terminal:
    let row = `<tr><td>${nt}</td>`; // Start the row with the non-terminal name.
    cols.forEach(t => { // For each terminal column:
      const cell = table[nt][t]; // The table cell M[nt, t].
      if(cell){ // The cell has a production:
        const text = cell.prods.map(p => `${nt}→${p.join(' ')}`).join(' / '); // Format all productions, joined by " / ".
        row += `<td class="${conflictSet.has(nt + '|' + t) ? 'conflict-cell' : 'rule-cell'}">${text}</td>`; // Highlight it red if it's a conflict, blue otherwise.
      } else {
        row += `<td class="empty-cell">—</td>`; // Empty cell → an em dash.
      }
    });
    html += row + '</tr>'; // Close the row.
  });
  return html + '</tbody></table>'; // Close the table.
}
// renderFirstFollowSets: injects the FIRST/FOLLOW table into the page.
function renderFirstFollowSets(grammar, FIRST, FOLLOW){
  document.querySelector('#firstFollowTable').innerHTML = firstFollowTableHtml(grammar, FIRST, FOLLOW); // Replace the container's content with the generated table.
}
// renderParseTableDisplay: injects the parse table into the page.
function renderParseTableDisplay(grammar, table, conflicts){
  document.querySelector('#parseTableDisplay').innerHTML = parseTableHtml(grammar, table, conflicts); // Replace the container's content with the generated table.
}
// renderAnalysis: convenience wrapper that renders both tables for a grammar + its analysis.
function renderAnalysis(grammar, analysis){
  renderFirstFollowSets(grammar, analysis.FIRST, analysis.FOLLOW); // Draw the FIRST/FOLLOW table.
  renderParseTableDisplay(grammar, analysis.table, analysis.conflicts); // Draw the parse table.
}

// showStep: displays step `idx` of the current parse session (stack, tape, action, trace highlight, verdict).
function showStep(idx){
  if(!session) return; // Nothing to show if no parse session exists.
  cursor = Math.max(0, Math.min(idx, session.steps.length - 1)); // Clamp idx to a valid step range.
  const step = session.steps[cursor]; // The snapshot for this step.
  renderStack(step.stack); // Draw the stack as it was at this step.
  renderAction(step, cursor); // Draw the action line for this step.

  const remainingTokenCount = step.remaining === '' ? 0 : step.remaining.split(' ').filter(Boolean).length; // How many input tokens remain in the snapshot.
  const ip = session.tokens.length - remainingTokenCount; // Reconstruct the input pointer from the remaining count.
  renderTape(session.tokens, ip); // Draw the tape with the pointer at the right position.

  [...els.traceBody.children].forEach((tr,i) => tr.classList.toggle('current-row', i === cursor)); // Highlight the current row in the trace table.

  const atEnd = cursor === session.steps.length - 1; // Is this the final step?
  if(atEnd){ // Final step → show the verdict:
    els.verdict.className = 'verdict ' + (session.verdict === 'accept' ? 'accept' : 'reject'); // Style the verdict banner by outcome.
    els.verdict.textContent = session.verdict === 'accept' // Fill in the verdict text:
      ? `✓ ACCEPTED — "${els.strInput.value}" is derivable from ${currentGrammar.start}` // Accepted message.
      : `✕ REJECTED — "${els.strInput.value}" is not derivable from ${currentGrammar.start}`; // Rejected message.
    els.headChip.className = 'head-chip ' + (session.verdict === 'accept' ? 'accept' : 'reject'); // Style the header chip by outcome.
    els.headChip.textContent = session.verdict === 'accept' ? 'accepted' : 'rejected'; // Chip text: "accepted" or "rejected".
    stopPlay(); // Stop any auto-play since the trace is finished.
  } else { // Mid-trace → show progress:
    els.verdict.className = 'verdict'; // Neutral (unstyled) verdict banner.
    els.headChip.className = 'head-chip'; // Neutral chip.
    els.headChip.textContent = `step ${cursor + 1} / ${session.steps.length}`; // Chip shows "step k / n".
  }
  els.stepBtn.disabled = atEnd; // "Next" is disabled on the final step.
  els.prevBtn.disabled = cursor <= 0; // "Previous" is disabled on the first step.
  els.playBtn.disabled = atEnd; // "Play" is disabled on the final step.
}
// stopPlay: cancels the auto-play interval and clears its UI state.
function stopPlay(){ if(playTimer){ clearInterval(playTimer); playTimer = null; els.playBtn.classList.remove('playing'); } } // Clear the timer, null it out, and drop the "playing" styling.
// currentSpeed: reads the currently selected play speed (in milliseconds per step) from the segmented control.
function currentSpeed(){
  const active = els.speedSelect.querySelector('.active'); // The currently highlighted speed button.
  return active ? parseInt(active.dataset.speed, 10) : 1500; // Return its data-speed value, defaulting to 1500ms.
}
// startPlay: begins auto-advancing through the parse steps on a timer.
function startPlay(){
  if(!session || cursor >= session.steps.length - 1) return; // Can't play if there's no session or we're already at the end.
  els.playBtn.classList.add('playing'); // Mark the button as playing (CSS state).
  const delay = currentSpeed(); // How long to wait between steps.
  playTimer = setInterval(() => { // Fire one step every `delay` ms:
    if(!session || cursor >= session.steps.length - 1){ stopPlay(); return; } // Stop if the session ended or we reached the last step.
    showStep(cursor + 1); // Advance to the next step.
  }, delay);
}

// showBanner: displays a status banner (kind: 'ok' | 'warn' | 'error') with the given HTML.
function showBanner(kind, html){
  els.statusBanner.className = 'status-banner ' + kind; // Apply the style for this message kind.
  els.statusBanner.innerHTML = html; // Insert the message content.
}
// hideBanner: clears the status banner back to its neutral, empty state.
function hideBanner(){ els.statusBanner.className = 'status-banner'; els.statusBanner.innerHTML=''; }

/* ---------- Grammar transformation display ---------- */
// conflictsDetail: one-line summary of all parse-table conflicts, e.g. M[S, a] = { S → a A | S → a B }.
function conflictsDetail(conflicts){
  return conflicts.map(c => `M[${c.nt}, ${c.terminal}] = { ${c.prods.map(p => `${c.nt} → ${p}`).join('  |  ')} }`).join('; '); // Format each conflict and join them with "; ".
}
// renderTransformLog: draws the transformation log entries into the UI.
function renderTransformLog(log){
  const container = document.getElementById('transformLog'); // The log container element.
  container.innerHTML = ''; // Clear any previous log.
  log.forEach(entry => { // One entry per transformation step:
    const div = document.createElement('div'); // Create the entry wrapper.
    div.className = 'tl-entry tl-' + entry.step; // Style it by step type (left-recursion/factoring/warn/note).
    const tag = entry.step === 'left-recursion' ? 'left recursion' // Human label for the tag:
      : entry.step === 'factoring' ? 'left factoring'
      : entry.step === 'warn' ? 'warning' : 'note';
    let html = `<span class="tl-tag">${tag}</span><div class="tl-body">`; // The tag chip + body wrapper.
    html += `<div class="tl-text">${escapeHtml(entry.text)}</div>`; // The main explanation text (HTML-escaped for safety).
    if(entry.detail) html += `<div class="tl-detail">${escapeHtml(entry.detail)}</div>`; // Optional before → after detail line.
    html += '</div>'; // Close the body wrapper.
    div.innerHTML = html; // Insert the entry's content.
    container.appendChild(div); // Append the entry to the log.
  });
}
// renderComparisonLeft: fills the "auto-transformed grammar" side of the comparison panel.
function renderComparisonLeft(autoGrammar, analysis){
  document.getElementById('autoCompareGrammar').textContent = grammarToString(autoGrammar); // Show the transformed grammar as text.
  const detail = document.getElementById('autoCompareDetail'); // The collapsible detail section (sets + table).
  if(analysis.conflicts.length){ // Grammar still has conflicts:
    document.getElementById('autoCompareSets').innerHTML = firstFollowTableHtml(autoGrammar, analysis.FIRST, analysis.FOLLOW); // Show its FIRST/FOLLOW sets.
    document.getElementById('autoCompareTable').innerHTML = parseTableHtml(autoGrammar, analysis.table, analysis.conflicts); // Show its (conflicted) parse table.
    detail.hidden = false; // Reveal the detail section.
  } else { // Grammar is clean:
    detail.hidden = true; // Hide the sets/table (not needed when it's already LL(1)).
  }
  const badge = document.getElementById('autoCompareStatus'); // The LL(1) status pill.
  badge.textContent = analysis.conflicts.length ? 'still ambiguous' : 'LL(1) ✓'; // Text depends on whether conflicts remain.
  badge.className = 'status-pill ' + (analysis.conflicts.length ? 'bad' : 'good'); // Red for ambiguous, green for LL(1).
}
// showComparison: sets up the manual-redesign comparison box and pre-fills the suggested grammar.
function showComparison(autoGrammar, analysis){
  const box = document.getElementById('residualBox'); // The comparison/residual-ambiguity box.
  box.hidden = false; // Show the box.
  document.getElementById('residualBanner').hidden = analysis.conflicts.length === 0; // Warn about residual ambiguity only if conflicts remain.
  renderComparisonLeft(autoGrammar, analysis); // Fill the auto side of the comparison.
  const ta = document.getElementById('manualGrammarInput'); // The textarea where the user can edit the manual grammar.
  if(!ta.dataset.touched) ta.value = grammarToString(suggestManualGrammar(autoGrammar)); // Pre-fill with the suggested grammar unless the user already edited it.
  document.getElementById('manualResults').hidden = true; // Hide previous manual-analysis results.
  const status = document.getElementById('manualStatus'); // The status pill for the manual side.
  status.textContent = 'suggestion — apply to verify'; // Label the pre-filled grammar as a suggestion.
  status.className = 'status-pill neutral'; // Neutral (grey) styling.
}

// runParse: the main "Parse" button handler — the whole pipeline in one place.
function runParse(){
  stopPlay(); // Stop any running animation.
  els.resultPanel.style.display = 'none'; // Hide stale results.
  els.analysisPanel.style.display = 'none'; // Hide stale analysis.
  els.transformCard.style.display = 'none'; // Hide stale transformation card.
  hideBanner(); // Clear any previous banner.

  let rawGrammar; // Will hold the parsed user grammar.
  try{
    rawGrammar = parseGrammarText(els.grammarInput.value); // Step 1: parse the user's grammar text.
  } catch(err){ // Parsing failed:
    showBanner('error', `<span>⚠</span><span><b>Couldn't read grammar:</b> ${escapeHtml(err.message)}</span>`); // Show the parse error and stop.
    return;
  }

  const { grammar: autoGrammar, log } = transformGrammar(rawGrammar); // Step 2: eliminate left recursion + left-factor, with a log.
  const analysis = analyzeGrammar(autoGrammar); // Step 3: FIRST/FOLLOW/table for the transformed grammar.

  currentGrammar = autoGrammar; // Remember the active grammar for rendering.
  currentTable = analysis.table; // Remember the active table for parsing.

  renderTransformLog(log); // Step 4: show the transformation log.
  renderAnalysis(autoGrammar, analysis); // Step 5: show FIRST/FOLLOW and the parse table.
  els.transformCard.style.display = 'block'; // Reveal the transformation card.
  els.analysisPanel.style.display = 'block'; // Reveal the analysis panel.
  showComparison(autoGrammar, analysis); // Step 6: show the manual-redesign comparison with a suggested grammar.

  if(analysis.conflicts.length){ // LL(1) conflicts remain after auto-transformation:
    showBanner('error', // Explain that the grammar needs a manual redesign:
      `<span>⚠</span><span><b>Residual ambiguity — requires manual grammar redesign.</b> ` +
      `After auto-transformation the grammar still has ${analysis.conflicts.length} table conflict(s) ` +
      `that mechanical left-recursion removal / left factoring cannot resolve (the alternatives genuinely overlap ` +
      `in what they generate). Paste a redesigned equivalent grammar in the panel below and click “Apply”. ` +
      `The parse below currently uses the first-listed rule at each conflict, so results aren't guaranteed correct yet. ` +
      `${conflictsDetail(analysis.conflicts)}` + // List the specific conflicted cells.
      `</span>`);
  } else { // Grammar is clean:
    showBanner('ok', `<span>✓</span><span><b>LL(1) — no table conflicts.</b> The auto-transformed grammar is ready to parse.</span>`); // Success message.
  }

  runParseSession(autoGrammar, analysis.table); // Step 7: parse the input string and visualize it.
}

// runParseSession: validates the input string, runs the parser, and renders the trace visualization.
function runParseSession(grammar, table){
  const tokens = tokenizeInput(els.strInput.value, grammar.terminals); // Turn the input string into tokens using this grammar's terminals.
  const unknown = tokens.filter(t => !grammar.terminals.includes(t)); // Any token that isn't a valid terminal?
  if(unknown.length){ // There are unrecognized symbols:
    showBanner('error', `<span>⚠</span><span><b>Unrecognized symbol(s):</b> ${[...new Set(unknown)].join(', ')}. Valid terminals for this grammar: ${grammar.terminals.join(', ')}.</span>`); // List them and the valid ones, then stop.
    return;
  }
  if(tokens.length === 0){ // Nothing to parse:
    showBanner('warn', `<span>i</span><span>Enter a string to parse.</span>`); // Ask the user to type something.
    return;
  }

  session = parseString(grammar, table, tokens); // Run the predictive parser, capturing every step.
  cursor = -1; // Reset the step cursor (showStep will move it to 0).
  els.traceBody.innerHTML = ''; // Clear the previous trace table.
  session.steps.forEach((s, i) => renderTraceRow(s, i, session.verdict, session.steps.length)); // Fill the full trace table.

  els.resultPanel.style.display = 'block'; // Reveal the results panel.
  showStep(0); // Show the very first step.
  els.analysisPanel.scrollIntoView({behavior:'smooth', block:'start'}); // Smooth-scroll the analysis into view.
}

// applyManualGrammar: handles the "Apply" button for the user's redesigned (manual) grammar.
function applyManualGrammar(){
  const ta = document.getElementById('manualGrammarInput'); // The textarea holding the manual grammar.
  let manual; // Will hold the parsed manual grammar.
  try{
    manual = parseGrammarText(ta.value); // Parse the user's grammar text.
  } catch(err){ // Parsing failed:
    showBanner('error', `<span>⚠</span><span><b>Couldn't read the manual grammar:</b> ${escapeHtml(err.message)}</span>`); // Show the error and stop.
    return;
  }
  const analysis = analyzeGrammar(manual); // FIRST/FOLLOW/table for the manual grammar.

  currentGrammar = manual; // Switch the active grammar to the manual one.
  currentTable = analysis.table; // Switch the active table accordingly.

  document.getElementById('manualResults').hidden = false; // Show the manual-results section.
  document.getElementById('manualCompareGrammar').textContent = grammarToString(manual); // Display the manual grammar as text.
  document.getElementById('manualCompareSets').innerHTML = firstFollowTableHtml(manual, analysis.FIRST, analysis.FOLLOW); // Display its FIRST/FOLLOW sets.
  document.getElementById('manualCompareTable').innerHTML = parseTableHtml(manual, analysis.table, analysis.conflicts); // Display its parse table.

  const status = document.getElementById('manualStatus'); // The status pill for the manual grammar.
  if(analysis.conflicts.length){ // Manual grammar also has conflicts:
    status.textContent = 'still ambiguous'; // Bad label.
    status.className = 'status-pill bad'; // Red pill.
    showBanner('error', `<span>⚠</span><span><b>Manual grammar still isn't LL(1)</b> — ${analysis.conflicts.length} conflict(s): ${conflictsDetail(analysis.conflicts)}</span>`); // Explain what's wrong.
  } else { // Manual grammar is LL(1):
    status.textContent = 'LL(1) ✓'; // Good label.
    status.className = 'status-pill good'; // Green pill.
    showBanner('ok', `<span>✓</span><span><b>Manual grammar is LL(1).</b> The FIRST/FOLLOW sets, table and parse below now use your redesigned grammar.</span>`); // Success message.
  }

  renderAnalysis(manual, analysis); // Re-render the FIRST/FOLLOW + parse table panels with the manual grammar.
  runParseSession(manual, analysis.table); // Re-run the parse with the manual grammar.
}

// resetAll: clears all parse visualization state (but keeps the analysis panels describing the grammar).
function resetAll(){
  stopPlay(); // Stop any running animation.
  session = null; cursor = -1; // Drop the parse session and reset the cursor.
  els.resultPanel.style.display = 'none'; // Hide the results panel.
  hideBanner(); // Clear the banner.
  els.traceBody.innerHTML = ''; // Clear the trace table.
  els.stackCol.innerHTML = ''; // Clear the stack visualization.
  els.tape.innerHTML = ''; // Clear the tape.
  els.actionReadout.innerHTML = ''; // Clear the action readout.
  els.verdict.className = 'verdict'; // Reset the verdict styling.
  // analysisPanel (FIRST/FOLLOW/table) is left visible — it describes the
  // grammar, not the in-progress parse, so there's no need to clear it.
}

// Wire up the "Parse" button to run the whole pipeline.
els.parseBtn.addEventListener('click', runParse);
// Pressing Enter in the input-string field also triggers a parse.
els.strInput.addEventListener('keydown', e => { if(e.key === 'Enter') runParse(); });
// Wire up the "Apply" button for the manual grammar.
document.getElementById('applyManualBtn').addEventListener('click', applyManualGrammar);
// Mark the manual grammar textarea as user-touched so the suggestion is never overwritten.
document.getElementById('manualGrammarInput').addEventListener('input', e => { e.target.dataset.touched = '1'; });
// "Previous" button → step back through the trace.
els.prevBtn.addEventListener('click', () => { if(session) showStep(cursor - 1); });
// "Next" button → step forward through the trace.
els.stepBtn.addEventListener('click', () => { if(session) showStep(cursor + 1); });
// "Play" button → toggles auto-advance (start if stopped, stop if running).
els.playBtn.addEventListener('click', () => { playTimer ? stopPlay() : startPlay(); });
// Speed selector → highlight the clicked button, update the speed, and restart play at the new speed.
els.speedSelect.addEventListener('click', e => {
  const btn = e.target.closest('button'); // The speed button that was clicked (or null if the click was elsewhere).
  if(!btn) return; // Ignore clicks outside a button.
  els.speedSelect.querySelectorAll('button').forEach(b => b.classList.remove('active')); // De-highlight all speed buttons.
  btn.classList.add('active'); // Highlight the clicked one.
  if(playTimer){ stopPlay(); startPlay(); } // If playing, restart with the new speed.
});
// "Reset" button → clears the visualization state.
els.resetBtn.addEventListener('click', resetAll);

// Global keyboard shortcuts: Left/Right arrows step through the trace.
document.addEventListener('keydown', e => {
  if(e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; // Only react to the two arrow keys.
  const tag = (e.target.tagName || '').toLowerCase(); // What element has focus?
  if(tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable) return; // Don't hijack keys while typing in a field.
  if(e.key === 'ArrowRight') els.stepBtn.click(); // Right arrow → next step.
  else els.prevBtn.click(); // Left arrow → previous step.
});
