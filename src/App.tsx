import { useEffect, useState } from 'react';
import { socket } from './socket';
import type { View, Source, Card, Move } from '../shared/src/engine';
import './App.css';

function label(c: Card | null): string {
  if (c === null) return '';
  return c === 0 ? 'S' : String(c);
}

function CardBox({ c, onClick, sel, empty }: { c: Card | null; onClick?: () => void; sel?: boolean; empty?: boolean }) {
  return (
    <div
      className={`card${c === 0 ? ' wild' : ''}${sel ? ' sel' : ''}${empty ? ' empty' : ''}`}
      onClick={onClick}
    >
      {label(c)}
    </div>
  );
}

export default function App() {
  const [name, setName] = useState(() => sessionStorage.getItem('name') ?? '');
  const [joined, setJoined] = useState(() => sessionStorage.getItem('seat') !== null);
  const [v, setV] = useState<View | null>(null);
  const [sel, setSel] = useState<Source | null>(null);
  const [msg, setMsg] = useState('서버 연결 중...');

  useEffect(() => {
    // 끊겼다 다시 붙으면(서버 재시작·와이파이·콜드스타트) 저장해 둔 좌석으로 자동 복구
    const rejoin = () => {
      const s = sessionStorage.getItem('seat');
      if (s !== null) socket.emit('join', { name: sessionStorage.getItem('name') ?? '', seat: Number(s) });
      else setMsg('');
    };
    socket.on('connect', rejoin);
    if (socket.connected) rejoin();
    socket.on('state', (view: View) => { setV(view); setSel(null); setMsg(''); });
    socket.on('waiting', () => setMsg('상대를 기다리는 중...'));
    socket.on('illegal', (m: string) => setMsg('낼 수 없어요: ' + m));
    socket.on('disconnect', () => setMsg('서버 연결 끊김 — 다시 연결 중...'));
    return () => {
      socket.off('connect', rejoin); socket.off('state'); socket.off('waiting');
      socket.off('illegal'); socket.off('disconnect');
    };
  }, []);

  const join = (seat: number) => {
    sessionStorage.setItem('name', name);
    sessionStorage.setItem('seat', String(seat));
    socket.emit('join', { name, seat });
    setJoined(true);
  };
  const myTurn = !!v && v.turn === v.seat && !v.winner;

  const play = (building: number) => {
    if (!sel) { setMsg('먼저 낼 카드를 고르세요.'); return; }
    socket.emit('move', { type: 'play', source: sel, building } satisfies Move);
  };
  const discard = (pile: number) => {
    if (!sel || sel.from !== 'hand') { setMsg('버릴 손패 카드를 고르세요.'); return; }
    socket.emit('move', { type: 'discard', hand: sel.index, pile } satisfies Move);
  };

  if (!joined) {
    return (
      <div className="join">
        <h1>Skip-Bo</h1>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="이름" />
        <div className="seatpick">
          <button onClick={() => join(0)} disabled={!name}>A로 입장</button>
          <button onClick={() => join(1)} disabled={!name}>B로 입장</button>
        </div>
        {msg && <p className="hint">{msg}</p>}
      </div>
    );
  }
  if (!v) return <div className="wait">{msg}</div>;

  return (
    <div className="board">
      {v.winner && (
        <div className="banner">
          {v.winner === socket.id ? '🎉 승리!' : '아쉽게 졌어요'}
          <button onClick={() => socket.emit('restart')}>다시</button>
        </div>
      )}
      <div className="status">{myTurn ? '🟢 내 차례' : '⚪ 상대 차례'} · 더미 {v.drawCount}장{msg && ' · ' + msg}</div>

      <section className="opp">
        <div className="who">{v.opp.name}</div>
        <div className="row">
          <div className="pilegroup"><small>스톡 {v.opp.stock.count}</small><CardBox c={v.opp.stock.top} empty={v.opp.stock.top === null} /></div>
          <div className="pilegroup"><small>손패 {v.opp.handCount}</small><CardBox c={null} empty /></div>
          <div className="discards">
            {v.opp.discard.map((d, i) => (
              <div className="pilegroup" key={i}><small>버림{i + 1}</small><CardBox c={d.length ? d[d.length - 1] : null} empty={!d.length} /></div>
            ))}
          </div>
        </div>
      </section>

      <section className="building">
        {v.building.map((b, i) => (
          <div className="pilegroup" key={i}>
            <small>빌딩{i + 1} · 다음 {b.length + 1 > 12 ? '-' : b.length + 1}</small>
            <CardBox c={b.length ? b[b.length - 1] : null} empty={!b.length} onClick={() => myTurn && play(i)} />
          </div>
        ))}
      </section>

      <section className={`me${myTurn ? ' active' : ''}`}>
        <div className="who">{v.me.name} (나)</div>
        <div className="row">
          <div className="pilegroup"><small>스톡 {v.me.stock.count}</small>
            <CardBox c={v.me.stock.top} empty={v.me.stock.top === null} sel={sel?.from === 'stock'} onClick={() => myTurn && setSel({ from: 'stock' })} />
          </div>
          <div className="discards">
            {v.me.discard.map((d, i) => (
              <div className="pilegroup" key={i}><small>버림{i + 1}</small>
                <CardBox
                  c={d.length ? d[d.length - 1] : null}
                  empty={!d.length}
                  sel={sel?.from === 'discard' && sel.pile === i}
                  onClick={() => {
                    if (!myTurn) return;
                    if (sel?.from === 'hand') discard(i);
                    else if (d.length) setSel({ from: 'discard', pile: i });
                  }}
                />
              </div>
            ))}
          </div>
        </div>
        <div className="hand">
          {v.me.hand.map((c, i) => (
            <CardBox key={i} c={c} sel={sel?.from === 'hand' && sel.index === i} onClick={() => myTurn && setSel({ from: 'hand', index: i })} />
          ))}
        </div>
        <div className="hint">카드 선택 → 빌딩에 내기 · 손패 선택 → 버림더미 클릭해 턴 종료</div>
      </section>
    </div>
  );
}
