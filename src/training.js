// training.js - Save and load Caro game training data from Firebase

import { ref, push, query, limitToLast, get, runTransaction } from 'firebase/database';
import { database } from './firebase';

const GAMES_PATH = 'training/games';
const MAX_LOAD = 500;

/**
 * Record a completed game to Firebase for training purposes.
 *
 * @param {object}   params
 * @param {number}   params.boardSize - board side length
 * @param {number[]} params.moves     - ordered array of cell indices (X first, then O, alternating)
 * @param {string}   params.winner    - "X", "O", or "draw"
 * @param {string}   params.mode      - "ai", "groq", "local", or "online"
 */
export async function recordGame({ boardSize, moves, winner, mode }) {
  if (!moves || moves.length === 0) return;
  try {
    await push(ref(database, GAMES_PATH), {
      boardSize,
      moves,
      winner,
      mode,
      playedAt: Date.now(),
    });
  } catch (_) {
    // Best-effort - never block the UI
  }
}

/**
 * Load training statistics from Firebase.
 * Returns { gameCount, xWins, oWins, draws }.
 */
export async function loadTrainingStats() {
  try {
    const snap = await get(query(ref(database, GAMES_PATH), limitToLast(MAX_LOAD)));
    if (!snap.exists()) return { gameCount: 0, xWins: 0, oWins: 0, draws: 0 };
    let xWins = 0, oWins = 0, draws = 0;
    snap.forEach((child) => {
      const v = child.val();
      if (v.winner === 'X') xWins++;
      else if (v.winner === 'O') oWins++;
      else draws++;
    });
    return { gameCount: xWins + oWins + draws, xWins, oWins, draws };
  } catch (_) {
    return { gameCount: 0, xWins: 0, oWins: 0, draws: 0 };
  }
}

/**
 * Build a cell-index bias map from recent training games for a given boardSize.
 * Cells that appeared in winning move sequences score higher.
 *
 * @param {number} boardSize
 * @returns {Promise<Map<number, number>>} map of cellIndex -> bias score
 */
export async function getMoveBias(boardSize) {
  try {
    const snap = await get(query(ref(database, GAMES_PATH), limitToLast(MAX_LOAD)));
    if (!snap.exists()) return new Map();

    const bias = new Map();
    snap.forEach((child) => {
      const g = child.val();
      if (g.boardSize !== boardSize || g.winner === 'draw' || !Array.isArray(g.moves)) return;

      // X plays at even indices (0,2,4...), O at odd indices (1,3,5...)
      const winnerStart = g.winner === 'X' ? 0 : 1;
      const winnerMoves = g.moves.filter((_, i) => i % 2 === winnerStart);

      // Later moves in the winning sequence get higher weight (closer to win)
      const total = winnerMoves.length;
      winnerMoves.forEach((cellIdx, i) => {
        if (typeof cellIdx !== 'number' || cellIdx < 0 || cellIdx >= boardSize * boardSize) return;
        const weight = (i + 1) / total;
        bias.set(cellIdx, (bias.get(cellIdx) || 0) + weight);
      });
    });

    return bias;
  } catch (_) {
    return new Map();
  }
}
