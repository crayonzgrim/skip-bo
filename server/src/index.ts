import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { newGame, apply, view, type Game, type Move } from '../../shared/src/engine';

const app = express();
const http = createServer(app);
// 배포 시 Render 환경변수 CLIENT_ORIGIN 에 Vercel 도메인 지정. 없으면 로컬 개발용으로 전체 허용.
const io = new Server(http, { cors: { origin: process.env.CLIENT_ORIGIN ?? '*' } });

app.get('/', (_req, res) => { res.send('skip-bo server up'); });

// ponytail: single global game in memory — only ever 2 players. No rooms, no DB.
let game: Game | null = null;
const seats: (string | null)[] = [null, null]; // socket.id per seat
const names: string[] = ['P1', 'P2'];

const seatOf = (id: string) => seats.indexOf(id);

function broadcast() {
  if (!game) return;
  for (let s = 0; s < 2; s++) {
    const sid = seats[s];
    if (sid) io.to(sid).emit('state', view(game, s));
  }
}

// 좀비 좌석 청소: 실제로 연결이 끊긴(소켓 레지스트리에 없는) 좌석을 비운다.
// Render는 인스턴스가 계속 살아있어 메모리 좌석이 안 지워지므로, disconnect를 놓친 좌석을 여기서 회수.
function sweep() {
  for (let s = 0; s < 2; s++) {
    if (seats[s] && !io.sockets.sockets.has(seats[s]!)) seats[s] = null;
  }
}

// 둘 다 앉으면 '새' 게임 시작 (재시작 버튼/초기 입장용)
function startGame() {
  sweep();
  if (seats[0] && seats[1]) {
    game = newGame({ id: seats[0]!, name: names[0] }, { id: seats[1]!, name: names[1] });
    broadcast();
  }
}

// 좌석 점유 상태를 모두에게 알림 → 입장 화면의 'in use' 표시에 사용
function pushSeats() {
  sweep();
  io.emit('seats', { a: !!seats[0], b: !!seats[1], playing: !!game });
}

io.on('connection', (socket) => {
  pushSeats();

  // seat 0 = A, seat 1 = B. 그 좌석에 마지막으로 들어온 사람이 차지(last-writer-wins).
  // 재접속 시 옛 소켓의 disconnect 처리가 늦어도 그냥 새 소켓이 좌석을 되찾으므로 끊겨도 안전.
  socket.on('join', ({ name, seat }: { name: string; seat: number }) => {
    if (seat !== 0 && seat !== 1) return;
    seats[seat] = socket.id;
    names[seat] = name || (seat === 0 ? 'A' : 'B');

    if (game) {
      // 재접속: 좌석 복구. socket.id가 바뀌었으니 게임 내 id도 갱신(승자 비교용).
      game.players[seat].id = socket.id;
      game.players[seat].name = names[seat];
      io.to(socket.id).emit('state', view(game, seat));
    } else if (seats[0] && seats[1]) {
      startGame();
    } else {
      socket.emit('waiting');
    }
    pushSeats();
  });

  socket.on('move', (m: Move) => {
    const seat = seatOf(socket.id);
    if (seat === -1 || !game) return;
    try { apply(game, seat, m); broadcast(); }
    catch (e) { socket.emit('illegal', (e as Error).message); }
  });

  socket.on('restart', () => { startGame(); pushSeats(); });

  // 방 초기화: A·B 좌석과 게임을 강제로 비운다(좌석 꼬임 비상 탈출).
  socket.on('clearSeats', () => {
    seats[0] = null; seats[1] = null; game = null;
    io.emit('reset'); // 보드에 있던 사람도 입장 화면으로
    pushSeats();
  });

  socket.on('disconnect', () => {
    const seat = seatOf(socket.id);
    if (seat !== -1) seats[seat] = null; // game은 유지 → 같은 좌석으로 재접속 시 복구
    pushSeats();
  });
});

const PORT = process.env.PORT || 3001;
http.listen(PORT, () => { console.log(`skip-bo server on :${PORT}`); });
