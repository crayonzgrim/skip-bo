import { useEffect, useState } from 'react';
import { socket } from './socket';
import type { View, Source, Card, Move } from '../shared/src/engine';
import './App.css';

// 와일드(Skip-Bo)는 고양이 사진 + 위에 SKIP-BO, 그 외엔 숫자(가운데 큰 숫자 + 양 모서리 작은 숫자)
function cardFace(c: Card | null) {
  if (c === 0) {
    return (
      <span className="wildface">
        <span className="wildname">SKIP-BO</span>
        <img src="/skipbo.png" alt="Skip-Bo" draggable={false} />
      </span>
    );
  }
  if (c === null) return '';
  return (
    <>
      <span className="corner tl">{c}</span>
      <span className="big">{c}</span>
      <span className="corner br">{c}</span>
    </>
  );
}

// 값 구간별 색: 1–4 파랑 / 5–8 초록 / 9–12 빨강
const numColor = (c: Card | null) =>
  typeof c === 'number' && c >= 1 ? (c <= 4 ? ' blue' : c <= 8 ? ' green' : ' red') : '';

const srcKey = (s: Source) => (s.from === 'hand' ? `h${s.index}` : s.from === 'discard' ? `d${s.pile}` : 's');

type Drop = { kind: 'building' | 'discard'; index: number };

function CardBox({
  c, empty, drop, onDragStart, dim,
}: {
  c: Card | null;
  empty?: boolean;
  drop?: Drop;
  onDragStart?: (e: React.PointerEvent) => void;
  dim?: boolean;
}) {
  return (
    <div
      className={`card${c === 0 ? ' wild' : ''}${empty ? '' : numColor(c)}${empty ? ' empty' : ''}${onDragStart ? ' draggable' : ''}${dim ? ' dim' : ''}`}
      data-drop={drop?.kind}
      data-index={drop?.index}
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      onPointerDown={onDragStart}
    >
      {cardFace(c)}
    </div>
  );
}

// 디스카드 더미: 카드가 위로 조금씩 겹쳐 쌓여 묻힌 카드의 윗단(숫자)이 보인다.
// 무스크롤 유지를 위해 최근 4장만 표시(맨 위=마지막=조작 대상).
function DiscardPile({
  pile, drop, onDragStart, dim,
}: {
  pile: Card[];
  drop?: Drop;
  onDragStart?: (e: React.PointerEvent) => void;
  dim?: boolean;
}) {
  const shown = pile.slice(-4);
  const n = Math.max(shown.length, 1);
  return (
    <div className="discardpile" data-drop={drop?.kind} data-index={drop?.index} style={{ '--n': n } as React.CSSProperties}>
      {shown.length === 0 ? (
        <div className="stackcard" style={{ '--i': 0 } as React.CSSProperties}><CardBox c={null} empty /></div>
      ) : (
        shown.map((c, idx) => {
          const isTop = idx === shown.length - 1;
          return (
            <div className="stackcard" style={{ '--i': idx } as React.CSSProperties} key={idx}>
              <CardBox c={c} onDragStart={isTop ? onDragStart : undefined} dim={isTop ? dim : undefined} />
            </div>
          );
        })
      )}
    </div>
  );
}

export default function App() {
  const [name, setName] = useState(() => sessionStorage.getItem('name') ?? '');
  const [joined, setJoined] = useState(() => sessionStorage.getItem('seat') !== null);
  const [v, setV] = useState<View | null>(null);
  const [msg, setMsg] = useState('Connecting…');
  const [seats, setSeats] = useState<{ a: boolean; b: boolean; playing: boolean } | null>(null);
  // x/y = 떠다니는 유령 위치, ox/oy = 집어든 원래 위치. phase: 끄는 중 / 서버 응답 대기 / 원위치 복귀 애니메이션
  const [drag, setDrag] = useState<{
    source: Source; card: Card; x: number; y: number; ox: number; oy: number;
    phase: 'drag' | 'pending' | 'return';
  } | null>(null);

  useEffect(() => {
    // Reconnect (server restart / wifi blip / cold start) → rejoin the saved seat automatically.
    const rejoin = () => {
      const s = sessionStorage.getItem('seat');
      if (s !== null) socket.emit('join', { name: sessionStorage.getItem('name') ?? '', seat: Number(s) });
      else setMsg('');
    };
    socket.on('connect', rejoin);
    if (socket.connected) rejoin();
    // 서버가 수를 받아들이면(state) 대기 중 유령 제거, 거절하면(illegal) 원위치로 되돌림
    socket.on('state', (view: View) => { setV(view); setMsg(''); setDrag((d) => (d && d.phase === 'pending' ? null : d)); });
    socket.on('waiting', () => setMsg('Waiting for opponent…'));
    socket.on('illegal', (m: string) => {
      setMsg('Illegal: ' + m);
      setDrag((d) => (d && d.phase === 'pending' ? { ...d, x: d.ox, y: d.oy, phase: 'return' } : d));
    });
    socket.on('disconnect', () => setMsg('Disconnected — reconnecting…'));
    socket.on('seats', (info: { a: boolean; b: boolean; playing: boolean }) => setSeats(info));
    socket.on('reset', () => { sessionStorage.removeItem('seat'); setJoined(false); setV(null); setMsg(''); });
    return () => {
      socket.off('connect', rejoin); socket.off('state'); socket.off('waiting');
      socket.off('illegal'); socket.off('disconnect'); socket.off('seats'); socket.off('reset');
    };
  }, []);

  // 자가 복구: 입장했는데 아직 보드 상태를 못 받으면(좌석 ID 꼬임/브로드캐스트 누락) 2초마다 재입장
  useEffect(() => {
    if (!joined || v) return;
    const id = setInterval(() => {
      const s = sessionStorage.getItem('seat');
      if (s !== null) socket.emit('join', { name: sessionStorage.getItem('name') ?? '', seat: Number(s) });
    }, 2000);
    return () => clearInterval(id);
  }, [joined, v]);

  // Pointer drag works for both mouse and touch (HTML5 DnD doesn't fire on touchscreens).
  useEffect(() => {
    if (drag?.phase !== 'drag') return;
    const start = drag.source;
    const move = (e: PointerEvent) => setDrag((d) => (d && d.phase === 'drag' ? { ...d, x: e.clientX, y: e.clientY } : d));
    const up = (e: PointerEvent) => {
      const el = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest('[data-drop]') as HTMLElement | null;
      let emitted = false;
      if (el) {
        const idx = Number(el.dataset.index);
        if (el.dataset.drop === 'building') {
          socket.emit('move', { type: 'play', source: start, building: idx } satisfies Move);
          emitted = true;
        } else if (el.dataset.drop === 'discard') {
          if (start.from === 'hand') {
            socket.emit('move', { type: 'discard', hand: start.index, pile: idx } satisfies Move);
            emitted = true;
          } else {
            // 규칙: 스톡·버림 카드는 버릴 수 없다. 손패만 버림 가능.
            setMsg('Only hand cards can be discarded.');
          }
        }
      }
      // 유효한 곳에 놓음 → 서버 응답 대기(pending). 아니면 → 원위치로 복귀(return).
      setDrag((d) => (d ? (emitted ? { ...d, phase: 'pending' } : { ...d, x: d.ox, y: d.oy, phase: 'return' }) : d));
    };
    // 터치에서 OS가 제스처를 가로채면 pointerup 대신 pointercancel이 온다 → 원위치 복귀
    const cancel = () => setDrag((d) => (d ? { ...d, x: d.ox, y: d.oy, phase: 'return' } : d));
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [drag?.phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // 복귀 애니메이션(0.2s)이 끝나면 유령 제거
  useEffect(() => {
    if (drag?.phase !== 'return') return;
    const t = setTimeout(() => setDrag(null), 200);
    return () => clearTimeout(t);
  }, [drag?.phase]);

  // 워치독: 서버 응답(state/illegal)이 끝내 안 오면 4초 후 강제 복귀 → 유령이 공중에 영구히 멈추지 않게
  useEffect(() => {
    if (drag?.phase !== 'pending') return;
    const t = setTimeout(() => setDrag((d) => (d && d.phase === 'pending' ? { ...d, x: d.ox, y: d.oy, phase: 'return' } : d)), 4000);
    return () => clearTimeout(t);
  }, [drag?.phase]);

  const join = (seat: number) => {
    sessionStorage.setItem('name', name);
    sessionStorage.setItem('seat', String(seat));
    socket.emit('join', { name, seat });
    setJoined(true);
  };
  const myTurn = !!v && v.turn === v.seat && !v.winner;
  const oppTurn = !!v && v.turn !== v.seat && !v.winner;

  const dragHandler = (source: Source, card: Card | null) =>
    myTurn && card !== null
      ? (e: React.PointerEvent) => {
          e.preventDefault();
          const r = e.currentTarget.getBoundingClientRect();
          setDrag({ source, card, x: e.clientX, y: e.clientY, ox: r.left + r.width / 2, oy: r.top + r.height / 2, phase: 'drag' });
        }
      : undefined;
  const isDim = (source: Source) => !!drag && srcKey(drag.source) === srcKey(source);

  if (!joined) {
    return (
      <div className="join">
        <h1>Skip-Bo</h1>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
        <div className="seatpick">
          <button onClick={() => join(0)} disabled={!name}>Join as A{seats?.a ? ' · in use' : ''}</button>
          <button onClick={() => join(1)} disabled={!name}>Join as B{seats?.b ? ' · in use' : ''}</button>
        </div>
        {(seats?.a || seats?.b) && <p className="hint">"in use" is just a hint — you can still pick it to take over.</p>}
        {msg && <p className="hint">{msg}</p>}
        <button
          className="reset-room"
          onClick={() => { if (confirm('Reset the room? This frees both A and B and ends any game in progress.')) socket.emit('clearSeats'); }}
        >
          Reset room (free A & B)
        </button>
      </div>
    );
  }
  if (!v) return <div className="wait">{msg}</div>;

  return (
    <div className="board">
      {v.winner && (
        <div className="banner">
          {v.winner === socket.id ? '🎉 You win!' : 'You lost'}
          <button onClick={() => socket.emit('restart')}>Play again</button>
        </div>
      )}
      <div className="status">
        <span>{myTurn ? '🟢 Your turn' : "⚪ Opponent's turn"} · Deck {v.drawCount}{msg && ' · ' + msg}</span>
        <div className="status-actions">
          <button className="reset" onClick={() => { if (confirm('Restart from scratch? Cards will be reshuffled for both players.')) socket.emit('restart'); }}>Reset</button>
          <button className="reset" onClick={() => { if (confirm('처음 화면으로? 두 좌석(A·B)을 비우고 진행 중인 게임을 끝냅니다.')) socket.emit('clearSeats'); }}>처음으로</button>
        </div>
      </div>

      <section className={`opp${oppTurn ? ' active' : ''}`}>
        <div className="who">{v.opp.name}{oppTurn && <span className="turnbadge">● 현재 턴</span>}</div>
        <div className="row">
          <div className="discards">
            {v.opp.discard.map((d, i) => (
              <DiscardPile key={i} pile={d} />
            ))}
          </div>
          <div className="pilegroup"><small>Stock {v.opp.stock.count}</small><CardBox c={v.opp.stock.top} empty={v.opp.stock.top === null} /></div>
        </div>
      </section>

      <section className="building">
        {v.building.map((b, i) => (
          <div className="pilegroup" key={i}>
            <CardBox c={b.length ? b[b.length - 1] : null} empty={!b.length} drop={{ kind: 'building', index: i }} />
          </div>
        ))}
      </section>

      <section className={`me${myTurn ? ' active' : ''}`}>
        <div className="who">{v.me.name} (you){myTurn && <span className="turnbadge">● 현재 턴</span>}</div>
        <div className="row">
          <div className="discards">
            {v.me.discard.map((d, i) => (
              <DiscardPile
                key={i}
                pile={d}
                drop={{ kind: 'discard', index: i }}
                onDragStart={dragHandler({ from: 'discard', pile: i }, d.length ? d[d.length - 1] : null)}
                dim={isDim({ from: 'discard', pile: i })}
              />
            ))}
          </div>
          <div className="pilegroup"><small>Stock {v.me.stock.count}</small>
            <CardBox
              c={v.me.stock.top}
              empty={v.me.stock.top === null}
              onDragStart={dragHandler({ from: 'stock' }, v.me.stock.top)}
              dim={isDim({ from: 'stock' })}
            />
          </div>
        </div>
        <div className="hand">
          {v.me.hand.map((c, i) => (
            <CardBox
              key={i}
              c={c}
              onDragStart={dragHandler({ from: 'hand', index: i }, c)}
              dim={isDim({ from: 'hand', index: i })}
            />
          ))}
        </div>
      </section>

      {drag && (
        <div className={`card ghost${drag.card === 0 ? ' wild' : ''}${numColor(drag.card)}${drag.phase === 'return' ? ' returning' : ''}`} style={{ left: drag.x, top: drag.y }}>
          {cardFace(drag.card)}
        </div>
      )}
    </div>
  );
}
