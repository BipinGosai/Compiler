# Non-Recursive Predictive Parser (LL(1))

A browser-based, table-driven LL(1) parser visualizer. Enter a context-free grammar and a string, and the app computes the `FIRST` / `FOLLOW` sets, builds the LL(1) parsing table, then steps through the parse — live stack, input tape, and a full step trace, with auto-play.

## Features

- **Grammar input** — one production per line (`LHS -> symbols`), `|` for alternatives, `eps` / `ε` for epsilon. The first LHS becomes the start symbol.
- **FIRST / FOLLOW sets** — computed automatically and shown in a table.
- **LL(1) parsing table** `M[A, a]` — with conflict detection (highlighted in red when the grammar isn't LL(1)).
- **Non-recursive predictive parser** — stack + input pointer, with a step-by-step trace you can scrub through (`←` / `→`).
- **Auto-play** — step through the parse automatically at Slow / Normal / Fast speed, and pause anytime.
- **Accept / Reject verdicts** — clear feedback whether the string is derivable from the start symbol.

## How to use

1. Edit the **Grammar** textarea (the default example is pre-filled).
2. Type the **string to parse** in the input box (single-char terminals can be entered without spaces, e.g. `abbcc`).
3. Click **Parse**.
4. Review the `FIRST`/`FOLLOW` sets and parse table, then step through the parse visualizer or hit **Play**.

### Grammar syntax

```
S -> A B C
A -> a b A'
A' -> A | eps     # alternative or epsilon
B -> b
```

- Productions are one per line; blank lines and lines starting with `#` are ignored.
- The `->` (or `→`) separates the LHS from the RHS.
- Alternatives on a single RHS are separated by `|`.
- Symbols are separated by spaces.
- Use `eps`, `epsilon`, or `ε` for the empty string.

> Tip: for single-character terminals you can write the input string without spaces. For multi-character symbols, separate them with spaces.

## Live demo

Import the repo below at [vercel.com/new](https://vercel.com/new) to get a live URL.

## Getting started locally

No build step or dependencies — just open the page.

```bash
# clone
git clone https://github.com/BipinGosai/Compiler.git
cd Compiler

# serve it (any static server works), e.g.:
python -m http.server 8000
# then open http://localhost:8000
```

## Project structure

```
.
├── index.html   # page layout & markup
├── style.css    # all styling
├── script.js    # grammar parsing, FIRST/FOLLOW, table build, parser, UI
└── README.md
```

## Deploying to Vercel

This is a fully static site, so deployment is one click (or one command):

- Push the repo to GitHub, then import the repo at [vercel.com/new](https://vercel.com/new) — the framework preset **Other** (`Vite`/static).
- Or with the CLI:

```bash
npm i -g vercel
vercel        # in the project folder; confirm "Static" build output
vercel --prod
```

## License

MIT.