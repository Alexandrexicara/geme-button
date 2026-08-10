import { create } from 'zustand';

type GameStatus = 'START' | 'PLAYING' | 'GAMEOVER' | 'VICTORY';

export type TimeId = 'cruzeiro' | 'atletico';

interface GameState {
  score: number;
  gameState: GameStatus;
  meuTime: TimeId;
  placar: Record<TimeId, number>;

  addScore: (amount: number) => void;
  setGameState: (state: GameStatus) => void;
  setMeuTime: (t: TimeId) => void;
  addGol: (time: TimeId) => void;
  reset: () => void;
}

export const useGameStore = create<GameState>((set) => ({
  score: 0,
  gameState: 'START',
  meuTime: 'cruzeiro',
  placar: { cruzeiro: 0, atletico: 0 },

  addScore: (amount) => set((state) => ({ score: state.score + amount })),
  setGameState: (s) => set({ gameState: s }),
  setMeuTime: (t) => set({ meuTime: t }),
  addGol: (time) =>
    set((state) => ({
      placar: { ...state.placar, [time]: state.placar[time] + 1 },
    })),
  reset: () =>
    set({ score: 0, gameState: 'START', placar: { cruzeiro: 0, atletico: 0 } }),
}));
