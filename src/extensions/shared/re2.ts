// A small linear-time regular expression matcher for the RE2 syntax that
// Chrome's declarativeNetRequest uses (regexFilter, and urlFilter after
// translation). JavaScript's RegExp backtracks: a pattern such as
// `([^/]+)+/` (a real Tampermonkey rule) takes exponential time on a URL
// without the trailing '/', and the host evaluates rules in Obsidian's UI
// thread, so any page could freeze Obsidian by navigating to such a URL.
//
// This is a Pike VM (Thompson NFA simulation with submatch tracking): time is
// O(pattern × input) for every pattern. Like RE2 it has no backreferences or
// lookaround (patterns using them are rejected, as Chrome rejects the rule),
// and submatches follow leftmost-first (Perl/JavaScript) priority.

type CharTest = (c: string) => boolean;

type Node =
  | { t: 'char'; test: CharTest; lit?: string }
  | { t: 'assert'; kind: 'start' | 'end' | 'word' | 'notword' }
  | { t: 'group'; index: number | null; node: Node }
  | { t: 'cat'; nodes: Node[] }
  | { t: 'alt'; nodes: Node[] }
  | { t: 'repeat'; node: Node; min: number; max: number; greedy: boolean };

type Inst =
  | { op: 'char'; test: CharTest }
  | { op: 'split'; x: number; y: number }
  | { op: 'jmp'; x: number }
  | { op: 'save'; slot: number }
  | { op: 'assert'; kind: 'start' | 'end' | 'word' | 'notword' }
  | { op: 'match' };

export interface Re2 {
  readonly source: string;
  test(input: string): boolean;
  /** Like RegExp.exec: [whole match, ...groups] (undefined for unset groups), or null. */
  exec(input: string): Array<string | undefined> | null;
}

const MAX_REPEAT = 1000;
const MAX_PROGRAM = 20000;

class SyntaxError2 extends Error {}

const isWord = (c: string | undefined) => !!c && /[A-Za-z0-9_]/.test(c);
const DIGIT: CharTest = c => c >= '0' && c <= '9';
const WORD: CharTest = c => isWord(c);
const SPACE: CharTest = c => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
const not = (f: CharTest): CharTest => c => !f(c);
const POSIX: Record<string, CharTest> = {
  alpha: c => /[A-Za-z]/.test(c), digit: DIGIT, alnum: c => /[A-Za-z0-9]/.test(c), upper: c => /[A-Z]/.test(c),
  lower: c => /[a-z]/.test(c), space: SPACE, xdigit: c => /[0-9A-Fa-f]/.test(c), word: WORD,
  punct: c => /[!-/:-@[-`{-~]/.test(c), blank: c => c === ' ' || c === '\t', cntrl: c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
  print: c => c.charCodeAt(0) >= 32 && c.charCodeAt(0) < 127, graph: c => c.charCodeAt(0) > 32 && c.charCodeAt(0) < 127, ascii: c => c.charCodeAt(0) < 128
};
const CONTROL: Record<string, string> = { n: '\n', t: '\t', r: '\r', f: '\f', v: '\v', a: String.fromCharCode(7) };

/** Case folding for one character test (input is folded per character). */
function folded(test: CharTest, caseInsensitive: boolean): CharTest {
  if (!caseInsensitive) return test;
  return c => test(c) || test(c.toLowerCase()) || test(c.toUpperCase());
}

class Parser {
  private pos = 0;
  groups = 0;
  constructor(private src: string, private ci: boolean) {}

  parse(): Node {
    const node = this.alternation();
    if (this.pos < this.src.length) throw new SyntaxError2('unexpected )');
    return node;
  }

  private peek(): string | undefined { return this.src[this.pos]; }

  private alternation(): Node {
    const branches = [this.concatenation()];
    while (this.peek() === '|') { this.pos++; branches.push(this.concatenation()); }
    return branches.length === 1 ? branches[0] : { t: 'alt', nodes: branches };
  }

  private concatenation(): Node {
    const nodes: Node[] = [];
    while (this.pos < this.src.length && this.peek() !== '|' && this.peek() !== ')') {
      const atom = this.atom();
      if (atom) nodes.push(this.quantified(atom));
    }
    return nodes.length === 1 ? nodes[0] : { t: 'cat', nodes };
  }

  private quantified(atom: Node): Node {
    let node = atom;
    for (;;) {
      const c = this.peek();
      let min: number, max: number;
      if (c === '*') { min = 0; max = Infinity; this.pos++; }
      else if (c === '+') { min = 1; max = Infinity; this.pos++; }
      else if (c === '?') { min = 0; max = 1; this.pos++; }
      else if (c === '{') {
        const m = /^\{(\d+)(,(\d*))?\}/.exec(this.src.slice(this.pos));
        if (!m) return node; // RE2 treats a malformed brace as a literal
        min = Number(m[1]); max = m[2] === undefined ? min : m[3] === '' ? Infinity : Number(m[3]);
        if (min > MAX_REPEAT || (max !== Infinity && (max > MAX_REPEAT || max < min))) throw new SyntaxError2('bad repetition');
        this.pos += m[0].length;
      } else return node;
      if (node.t === 'assert') throw new SyntaxError2('nothing to repeat');
      let greedy = true;
      if (this.peek() === '?') { greedy = false; this.pos++; }
      if (node.t === 'repeat') throw new SyntaxError2('bad repetition operator'); // RE2 rejects a**
      node = { t: 'repeat', node, min, max, greedy };
    }
  }

  private atom(): Node | null {
    const c = this.src[this.pos++];
    switch (c) {
      case '(': return this.group();
      case '[': return { t: 'char', test: folded(this.charClass(), this.ci) };
      case '.': return { t: 'char', test: ch => ch !== '\n' };
      case '^': return { t: 'assert', kind: 'start' };
      case '$': return { t: 'assert', kind: 'end' };
      case '\\': return this.escape();
      case '*': case '+': case '?': throw new SyntaxError2('missing argument to repetition operator');
      default: return this.literal(c);
    }
  }

  private literal(c: string): Node {
    const lit = c.toLowerCase();
    if (!this.ci) return { t: 'char', test: ch => ch === c, lit };
    return { t: 'char', test: ch => ch.toLowerCase() === lit, lit };
  }

  private group(): Node | null {
    let index: number | null = null;
    if (this.src.startsWith('?:', this.pos)) this.pos += 2;
    else if (this.src.startsWith('?P<', this.pos) || (this.src.startsWith('?<', this.pos) && !/^\?<[=!]/.test(this.src.slice(this.pos)))) {
      const close = this.src.indexOf('>', this.pos);
      if (close < 0) throw new SyntaxError2('bad named group');
      this.pos = close + 1;
      index = ++this.groups;
    } else if (this.peek() === '?') {
      // Flags: only case-insensitivity, as (?i) or (?i:...).
      const m = /^\?(i)(\)|:)/.exec(this.src.slice(this.pos));
      if (!m) throw new SyntaxError2('unsupported group (lookaround or flags)');
      this.pos += m[0].length;
      if (m[2] === ')') { this.ci = true; return null; }
      const outer = this.ci;
      this.ci = true;
      const node = this.alternation();
      this.ci = outer;
      if (this.src[this.pos++] !== ')') throw new SyntaxError2('missing )');
      return { t: 'group', index: null, node };
    } else index = ++this.groups;
    const node = this.alternation();
    if (this.src[this.pos++] !== ')') throw new SyntaxError2('missing )');
    return { t: 'group', index, node };
  }

  /** An escape outside a class: assertion, class shorthand or literal. */
  private escape(): Node {
    const c = this.src[this.pos++];
    if (c === undefined) throw new SyntaxError2('trailing backslash');
    if (c === 'b') return { t: 'assert', kind: 'word' };
    if (c === 'B') return { t: 'assert', kind: 'notword' };
    if (c === 'A') return { t: 'assert', kind: 'start' };
    if (c === 'z') return { t: 'assert', kind: 'end' };
    if ('dDwWsS'.includes(c)) return { t: 'char', test: folded(this.classEscape(c), this.ci) };
    return this.literal(this.escapedChar(c));
  }

  /** Escapes valid both inside and outside classes. */
  private classEscape(c: string): CharTest {
    switch (c) {
      case 'd': return DIGIT;
      case 'D': return not(DIGIT);
      case 'w': return WORD;
      case 'W': return not(WORD);
      case 's': return SPACE;
      case 'S': return not(SPACE);
    }
    const ch = this.escapedChar(c);
    return x => x === ch;
  }

  private escapedChar(c: string): string {
    if (CONTROL[c]) return CONTROL[c];
    if (c === 'x') {
      const m = /^(?:\{([0-9A-Fa-f]{1,6})\}|([0-9A-Fa-f]{2}))/.exec(this.src.slice(this.pos));
      if (!m) throw new SyntaxError2('bad \\x escape');
      this.pos += m[0].length;
      return String.fromCodePoint(parseInt(m[1] ?? m[2], 16));
    }
    if (c === '0') return String.fromCharCode(0);
    // Digits would be backreferences, letters unknown classes: RE2 rejects both.
    if (/[0-9A-Za-z]/.test(c)) throw new SyntaxError2('invalid escape \\' + c);
    return c;
  }

  private charClass(): CharTest {
    let negated = false;
    if (this.peek() === '^') { negated = true; this.pos++; }
    const tests: CharTest[] = [];
    let first = true;
    for (;;) {
      const c = this.src[this.pos++];
      if (c === undefined) throw new SyntaxError2('missing ]');
      if (c === ']' && !first) break;
      first = false;
      if (c === '[' && this.peek() === ':') {
        const m = /^:(\^?)([a-z]+):\]/.exec(this.src.slice(this.pos));
        if (m && POSIX[m[2]]) {
          this.pos += m[0].length;
          tests.push(m[1] ? not(POSIX[m[2]]) : POSIX[m[2]]);
          continue;
        }
      }
      let low: string;
      if (c === '\\') {
        const e = this.src[this.pos++];
        if (e === undefined) throw new SyntaxError2('trailing backslash');
        if ('dDwWsS'.includes(e)) { tests.push(this.classEscape(e)); continue; }
        low = this.escapedChar(e);
      } else low = c;
      // A range low-high, unless '-' is last in the class.
      if (this.peek() === '-' && this.src[this.pos + 1] !== undefined && this.src[this.pos + 1] !== ']') {
        this.pos++;
        let high = this.src[this.pos++];
        if (high === '\\') high = this.escapedChar(this.src[this.pos++]);
        if (high < low) throw new SyntaxError2('bad character class range');
        tests.push(x => x >= low && x <= high);
      } else tests.push(x => x === low);
    }
    const any: CharTest = x => tests.some(t => t(x));
    return negated ? not(any) : any;
  }
}

function compileProgram(node: Node): Inst[] {
  const prog: Inst[] = [];
  const emit = (inst: Inst) => {
    if (prog.length >= MAX_PROGRAM) throw new SyntaxError2('pattern too large');
    prog.push(inst);
    return prog.length - 1;
  };
  type Split = Extract<Inst, { op: 'split' }>;
  type Jump = Extract<Inst, { op: 'jmp' }>;
  /** Emits a split/jump whose targets are filled in once known. */
  const emitSplit = (): [number, Split] => { const inst: Split = { op: 'split', x: 0, y: 0 }; return [emit(inst), inst]; };
  const emitJump = (x = 0): Jump => { const inst: Jump = { op: 'jmp', x }; emit(inst); return inst; };
  const gen = (n: Node): void => {
    switch (n.t) {
      case 'char': emit({ op: 'char', test: n.test }); return;
      case 'assert': emit({ op: 'assert', kind: n.kind }); return;
      case 'group':
        if (n.index === null) { gen(n.node); return; }
        emit({ op: 'save', slot: n.index * 2 });
        gen(n.node);
        emit({ op: 'save', slot: n.index * 2 + 1 });
        return;
      case 'cat': for (const x of n.nodes) gen(x); return;
      case 'alt': {
        const jumps: Jump[] = [];
        for (let i = 0; i < n.nodes.length; i++) {
          if (i < n.nodes.length - 1) {
            const [, split] = emitSplit();
            split.x = prog.length;
            gen(n.nodes[i]);
            jumps.push(emitJump());
            split.y = prog.length;
          } else gen(n.nodes[i]);
        }
        for (const jump of jumps) jump.x = prog.length;
        return;
      }
      case 'repeat': {
        for (let i = 0; i < n.min; i++) gen(n.node);
        if (n.max === Infinity) {
          // L: split body, out; body; jmp L
          const [at, split] = emitSplit();
          gen(n.node);
          emitJump(at);
          const out = prog.length;
          split.x = n.greedy ? at + 1 : out;
          split.y = n.greedy ? out : at + 1;
        } else {
          const splits: Array<[number, Split]> = [];
          for (let i = n.min; i < n.max; i++) {
            splits.push(emitSplit());
            gen(n.node);
          }
          const out = prog.length;
          for (const [at, split] of splits) {
            split.x = n.greedy ? at + 1 : out;
            split.y = n.greedy ? out : at + 1;
          }
        }
        return;
      }
    }
  };
  emit({ op: 'save', slot: 0 });
  gen(node);
  emit({ op: 'save', slot: 1 });
  emit({ op: 'match' });
  return prog;
}

/**
 * The longest literal text every match must contain (lower-cased), so most
 * patterns are rejected with one substring search before running the VM.
 */
function requiredLiteral(node: Node): string {
  let best = '';
  let run = '';
  const end = () => { if (run.length > best.length) best = run; run = ''; };
  const walk = (n: Node) => {
    if (n.t === 'char' && n.lit !== undefined) run += n.lit;
    else if (n.t === 'cat') n.nodes.forEach(walk);
    else if (n.t === 'group') walk(n.node);
    else if (n.t === 'assert') { /* zero-width: the run continues */ }
    else {
      end();
      if (n.t === 'repeat' && n.min > 0) {
        const inner = requiredLiteral(n.node);
        if (inner.length > best.length) best = inner;
      }
    }
  };
  walk(node);
  end();
  return best;
}

let lastInput = '', lastLower = '';
const lowerOf = (input: string) => input === lastInput ? lastLower : (lastLower = (lastInput = input).toLowerCase());

/** Does the program only match at position 0 (starts with ^ before any branch)? */
function anchoredAtStart(prog: Inst[]): boolean {
  for (const inst of prog) {
    if (inst.op === 'save') continue;
    return inst.op === 'assert' && inst.kind === 'start';
  }
  return false;
}

function run(prog: Inst[], slots: number, anchored: boolean, input: string): number[] | null {
  const n = prog.length;
  let clist: Array<{ pc: number; caps: number[] }> = [];
  let nlist: Array<{ pc: number; caps: number[] }> = [];
  const mark = new Int32Array(n).fill(-1);
  let generation = 0;
  let matched: number[] | null = null;

  // Follows non-consuming instructions in priority order (iteratively).
  const add = (list: Array<{ pc: number; caps: number[] }>, pc0: number, caps0: number[], pos: number) => {
    const stack: Array<[number, number[]]> = [[pc0, caps0]];
    while (stack.length) {
      const [pc, caps] = stack.pop()!;
      if (mark[pc] === generation) continue;
      mark[pc] = generation;
      const inst = prog[pc];
      switch (inst.op) {
        case 'jmp': stack.push([inst.x, caps]); break;
        case 'split': stack.push([inst.y, caps], [inst.x, caps]); break;
        case 'save': { const next = caps.slice(); next[inst.slot] = pos; stack.push([pc + 1, next]); break; }
        case 'assert': {
          const before = input[pos - 1], after = input[pos];
          const ok = inst.kind === 'start' ? pos === 0
            : inst.kind === 'end' ? pos === input.length
            : (isWord(before) !== isWord(after)) === (inst.kind === 'word');
          if (ok) stack.push([pc + 1, caps]);
          break;
        }
        default: list.push({ pc, caps });
      }
    }
  };

  const empty = new Array<number>(slots).fill(-1);
  generation++;
  add(clist, 0, empty, 0);
  for (let pos = 0; ; pos++) {
    if (!clist.length && (matched || anchored)) break;
    generation++;
    const ch = input[pos];
    for (const thread of clist) {
      const inst = prog[thread.pc];
      if (inst.op === 'match') {
        matched = thread.caps;
        break; // lower-priority threads lose (leftmost-first)
      }
      if (inst.op === 'char' && ch !== undefined && inst.test(ch)) add(nlist, thread.pc + 1, thread.caps, pos + 1);
    }
    if (pos >= input.length) break;
    // Unanchored search: a new attempt starting here, lowest priority.
    if (!matched && !anchored) add(nlist, 0, empty, pos + 1);
    [clist, nlist] = [nlist, clist];
    nlist.length = 0;
  }
  return matched;
}

const cache = new Map<string, Re2 | null>();

/** Compiles an RE2-syntax pattern; null when RE2 would reject it (or it is too large). */
export function compileRe2(source: string, caseInsensitive = false): Re2 | null {
  const key = (caseInsensitive ? 'i:' : 's:') + source;
  if (cache.has(key)) return cache.get(key)!;
  let result: Re2 | null = null;
  try {
    const parser = new Parser(source, caseInsensitive);
    const ast = parser.parse();
    const prog = compileProgram(ast);
    const literal = requiredLiteral(ast);
    const possible = (input: string) => !literal || lowerOf(input).includes(literal);
    const slots = (parser.groups + 1) * 2;
    const anchored = anchoredAtStart(prog);
    result = {
      source,
      test: input => possible(input) && run(prog, slots, anchored, input) !== null,
      exec(input) {
        const caps = possible(input) ? run(prog, slots, anchored, input) : null;
        if (!caps) return null;
        const out: Array<string | undefined> = [];
        for (let i = 0; i < slots; i += 2) out.push(caps[i] >= 0 && caps[i + 1] >= 0 ? input.slice(caps[i], caps[i + 1]) : undefined);
        return out;
      }
    };
  } catch { result = null; }
  if (cache.size > 4000) cache.clear();
  cache.set(key, result);
  return result;
}
