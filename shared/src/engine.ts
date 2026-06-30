// Pure Skip-Bo game engine. No I/O. Authoritative on the server.
// Card encoding: 1..12 = number cards, 0 = Skip-Bo wild (kept as plain numbers → JSON-trivial state).

export const SKIPBO = 0;
export const STOCK_SIZE = 30; // ponytail: 2-player long game; drop to 20/10 for shorter matches
export const HAND_SIZE = 5;
export const N_BUILD = 4;
export const N_DISCARD = 4;

export type Card = number; // 0 = wild, 1..12

export interface Player {
  id: string;
  name: string;
  stock: Card[];     // face-down; top = last element (face-up to everyone)
  hand: Card[];      // hidden from opponent
  discard: Card[][]; // N_DISCARD piles, top = last
}

export interface Game {
  players: Player[]; // exactly 2
  building: Card[][]; // N_BUILD piles; a pile's value = its length; complete at 12 then cleared
  drawPile: Card[];
  completed: Card[];  // cards from completed building piles; reshuffled into drawPile when it runs dry
  turn: number;       // 0 or 1
  discardedThisTurn: boolean; // 턴 종료 가능 조건: 손패가 0이 아니면 1장 이상 버려야 함
  winner: string | null; // player id
}

export type Source =
  | { from: 'hand'; index: number }
  | { from: 'stock' }
  | { from: 'discard'; pile: number };

export type Move =
  | { type: 'play'; source: Source; building: number }
  | { type: 'discard'; hand: number; pile: number }
  | { type: 'endTurn' };

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function buildDeck(): Card[] {
  const d: Card[] = [];
  for (let n = 1; n <= 12; n++) for (let k = 0; k < 12; k++) d.push(n); // 144 number cards
  for (let k = 0; k < 18; k++) d.push(SKIPBO); // 18 wilds → 162 total
  return shuffle(d);
}

export function newGame(p0: { id: string; name: string }, p1: { id: string; name: string }): Game {
  const deck = buildDeck();
  const mk = (p: { id: string; name: string }): Player => ({
    id: p.id,
    name: p.name,
    stock: deck.splice(0, STOCK_SIZE),
    hand: [],
    discard: [[], [], [], []],
  });
  const g: Game = {
    players: [mk(p0), mk(p1)],
    building: [[], [], [], []],
    drawPile: deck,
    completed: [],
    turn: 0,
    discardedThisTurn: false,
    winner: null,
  };
  refill(g, 0); // current player draws up to 5
  return g;
}

function draw(g: Game): Card | undefined {
  if (g.drawPile.length === 0) {
    if (g.completed.length === 0) return undefined;
    g.drawPile = shuffle(g.completed);
    g.completed = [];
  }
  return g.drawPile.pop();
}

function refill(g: Game, seat: number): void {
  const h = g.players[seat].hand;
  while (h.length < HAND_SIZE) {
    const c = draw(g);
    if (c === undefined) break;
    h.push(c);
  }
}

export function buildingNeed(pile: Card[]): number {
  return pile.length + 1; // 1..12
}

export function canPlay(card: Card, pile: Card[]): boolean {
  const need = buildingNeed(pile);
  if (need > 12) return false;
  return card === SKIPBO || card === need;
}

function takeSource(p: Player, s: Source): Card | undefined {
  if (s.from === 'hand') return p.hand[s.index];
  if (s.from === 'stock') return p.stock[p.stock.length - 1];
  return p.discard[s.pile][p.discard[s.pile].length - 1];
}

function removeSource(p: Player, s: Source): void {
  if (s.from === 'hand') p.hand.splice(s.index, 1);
  else if (s.from === 'stock') p.stock.pop();
  else p.discard[s.pile].pop();
}

// Applies a move, mutating g. Throws Error on illegal move.
export function apply(g: Game, seat: number, m: Move): void {
  if (g.winner) throw new Error('game over');
  if (seat !== g.turn) throw new Error('not your turn');
  const p = g.players[seat];

  if (m.type === 'play') {
    if (m.building < 0 || m.building >= N_BUILD) throw new Error('bad building');
    const card = takeSource(p, m.source);
    if (card === undefined) throw new Error('empty source');
    const pile = g.building[m.building];
    if (!canPlay(card, pile)) throw new Error('illegal play');
    removeSource(p, m.source);
    pile.push(card);
    if (pile.length === 12) { g.completed.push(...pile); g.building[m.building] = []; }
    if (p.stock.length === 0) { g.winner = p.id; return; }
    if (p.hand.length === 0) refill(g, seat); // emptied hand → redraw and keep going
    return;
  }

  // discard → 손패 카드를 더미로 옮길 뿐, 턴은 끝나지 않는다(여러 장 가능)
  if (m.type === 'discard') {
    if (m.hand < 0 || m.hand >= p.hand.length) throw new Error('bad hand index');
    if (m.pile < 0 || m.pile >= N_DISCARD) throw new Error('bad discard pile');
    const [c] = p.hand.splice(m.hand, 1);
    p.discard[m.pile].push(c);
    g.discardedThisTurn = true;
    return;
  }

  // endTurn → 상대에게 넘김. 손패가 남아있으면 이번 턴에 1장 이상 버려야 함.
  if (p.hand.length > 0 && !g.discardedThisTurn) throw new Error('must discard before ending turn');
  g.turn = 1 - g.turn;
  g.discardedThisTurn = false;
  refill(g, g.turn); // 새 턴 플레이어 손패를 5장으로 채움
}

// ---- view: redacted per-seat state sent over the wire (hides opponent hand & buried stock) ----
export interface View {
  seat: number;
  turn: number;
  winner: string | null;
  discarded: boolean; // 현재 턴 플레이어가 이번 턴에 디스카드했는지 (턴 종료 버튼 활성화용)
  drawCount: number;
  building: Card[][];
  me: { name: string; stock: { top: Card | null; count: number }; hand: Card[]; discard: Card[][] };
  opp: { name: string; stock: { top: Card | null; count: number }; handCount: number; discard: Card[][] };
}

export function view(g: Game, seat: number): View {
  const me = g.players[seat], opp = g.players[1 - seat];
  const top = (s: Card[]) => (s.length ? s[s.length - 1] : null);
  return {
    seat, turn: g.turn, winner: g.winner, discarded: g.discardedThisTurn, drawCount: g.drawPile.length,
    building: g.building,
    me: { name: me.name, stock: { top: top(me.stock), count: me.stock.length }, hand: me.hand, discard: me.discard },
    opp: { name: opp.name, stock: { top: top(opp.stock), count: opp.stock.length }, handCount: opp.hand.length, discard: opp.discard },
  };
}

// ---- runnable self-check (npx tsx shared/src/demo.ts) ----
export function demo(): void {
  const g = newGame({ id: 'a', name: 'A' }, { id: 'b', name: 'B' });
  console.assert(g.players[0].stock.length === STOCK_SIZE, 'stock dealt');
  console.assert(g.players[0].hand.length === HAND_SIZE, 'hand filled');

  g.players[0].hand[0] = 1; // building[0] empty → needs 1
  apply(g, 0, { type: 'play', source: { from: 'hand', index: 0 }, building: 0 });
  console.assert(g.building[0].length === 1, 'played to building');

  let threw = false;
  try { apply(g, 1, { type: 'play', source: { from: 'hand', index: 0 }, building: 0 }); } catch { threw = true; }
  console.assert(threw, 'rejects off-turn');

  let blocked = false;
  try { apply(g, 0, { type: 'endTurn' }); } catch { blocked = true; }
  console.assert(blocked, 'cannot end turn before discarding');

  apply(g, 0, { type: 'discard', hand: 0, pile: 0 });
  console.assert(g.turn === 0, 'discard does NOT end turn');
  console.assert(g.discardedThisTurn, 'discard flagged');
  apply(g, 0, { type: 'discard', hand: 0, pile: 0 });
  console.assert(g.turn === 0, 'can discard multiple times');

  apply(g, 0, { type: 'endTurn' });
  console.assert(g.turn === 1, 'endTurn passes turn');
  console.assert(g.players[1].hand.length === HAND_SIZE, 'next player refilled to 5');

  g.turn = 1; g.players[1].stock = [1]; g.players[1].hand = [0, 0, 0, 0, 0]; g.building[1] = [];
  apply(g, 1, { type: 'play', source: { from: 'stock' }, building: 1 });
  console.assert(g.winner === 'b', 'win on emptying stock');

  console.log('engine demo ok');
}
