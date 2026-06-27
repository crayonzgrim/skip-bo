import { io } from 'socket.io-client';

// 로컬은 localhost, 배포는 Vercel 환경변수 VITE_SERVER(=Render 서버 URL) 사용
export const socket = io(import.meta.env.VITE_SERVER ?? 'http://localhost:3001');
