// ai.js – Caro AI engine (5 difficulty levels)

const WIN_LENGTH = 5;

const SCORE = {
  FIVE: 10_000_000,
  OPEN_FOUR: 100_000,
  HALF_FOUR: 10_000,
  OPEN_THREE: 5_000,
  HALF_THREE: 500,
  OPEN_TWO: 100,
  HALF_TWO: 10,
};

// Score a consecutive run of `count` pieces with `openEnds` open ends (0, 1, or 2).
function seqScore(count, openEnds) {
  if (count >= 5) return SCORE.FIVE;
  if (openEnds === 0) return 0;
  switch (count) {
    case 4: return openEnds === 2 ? SCORE.OPEN_FOUR : SCORE.HALF_FOUR;
    case 3: return openEnds === 2 ? SCORE.OPEN_THREE : SCORE.HALF_THREE;
    case 2: return openEnds === 2 ? SCORE.OPEN_TWO : SCORE.HALF_TWO;
    default: return 0;
  }
}

// Score all sequences of `symbol` across every row, column, and diagonal.
function evalBoardFor(board, boardSize, symbol) {
  let total = 0;

  const scoreLine = (getCell) => {
    let i = 0;
    while (i < boardSize) {
      if (getCell(i) !== symbol) { i++; continue; }
      let j = i;
      while (j < boardSize && getCell(j) === symbol) j++;
      const count = j - i;
      const bwd = i > 0 && getCell(i - 1) === '';
      const fwd = j < boardSize && getCell(j) === '';
      total += seqScore(count, (bwd ? 1 : 0) + (fwd ? 1 : 0));
      i = j;
    }
  };

  // Rows
  for (let r = 0; r < boardSize; r++) {
    scoreLine((c) => board[r * boardSize + c]);
  }
  // Columns
  for (let c = 0; c < boardSize; c++) {
    scoreLine((r) => board[r * boardSize + c]);
  }
  // Diagonals (top-left → bottom-right)
  for (let start = -(boardSize - WIN_LENGTH); start <= boardSize - WIN_LENGTH; start++) {
    scoreLine((k) => {
      const r = k, c = k - start;
      return r >= 0 && r < boardSize && c >= 0 && c < boardSize ? board[r * boardSize + c] : undefined;
    });
  }
  // Anti-diagonals (top-right → bottom-left)
  for (let s = WIN_LENGTH - 1; s < 2 * boardSize - WIN_LENGTH; s++) {
    scoreLine((k) => {
      const r = k, c = s - k;
      return r >= 0 && r < boardSize && c >= 0 && c < boardSize ? board[r * boardSize + c] : undefined;
    });
  }

  return total;
}

// Net board evaluation from AI's perspective (positive = AI winning).
function evaluateBoard(board, boardSize, aiSym, playerSym) {
  return evalBoardFor(board, boardSize, aiSym) - evalBoardFor(board, boardSize, playerSym) * 1.05;
}

// Quick per-cell score used for move ordering (cheap directional scan).
function quickMoveScore(board, boardSize, idx, aiSym, playerSym) {
  const row = Math.floor(idx / boardSize);
  const col = idx % boardSize;
  let score = 0;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];

  for (const [dr, dc] of dirs) {
    for (const [sym, weight] of [[aiSym, 1.0], [playerSym, 0.95]]) {
      board[idx] = sym;
      let cnt = 1, openEnds = 0;
      let r = row + dr, c = col + dc;
      while (r >= 0 && r < boardSize && c >= 0 && c < boardSize && board[r * boardSize + c] === sym) {
        cnt++; r += dr; c += dc;
      }
      if (r >= 0 && r < boardSize && c >= 0 && c < boardSize && board[r * boardSize + c] === '') openEnds++;
      r = row - dr; c = col - dc;
      while (r >= 0 && r < boardSize && c >= 0 && c < boardSize && board[r * boardSize + c] === sym) {
        cnt++; r -= dr; c -= dc;
      }
      if (r >= 0 && r < boardSize && c >= 0 && c < boardSize && board[r * boardSize + c] === '') openEnds++;
      score += seqScore(cnt, openEnds) * weight;
      board[idx] = '';
    }
  }
  return score;
}

// Check if placing `symbol` at `index` creates a win.
function isWinAtIndex(board, index, symbol, boardSize) {
  const row = Math.floor(index / boardSize);
  const col = index % boardSize;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    let cnt = 1;
    for (let d = 1; d < WIN_LENGTH; d++) {
      const r = row + dr * d, c = col + dc * d;
      if (r < 0 || r >= boardSize || c < 0 || c >= boardSize || board[r * boardSize + c] !== symbol) break;
      cnt++;
    }
    for (let d = 1; d < WIN_LENGTH; d++) {
      const r = row - dr * d, c = col - dc * d;
      if (r < 0 || r >= boardSize || c < 0 || c >= boardSize || board[r * boardSize + c] !== symbol) break;
      cnt++;
    }
    if (cnt >= WIN_LENGTH) return true;
  }
  return false;
}

// Return empty cells within `range` steps of any existing piece.
function getCandidates(board, boardSize, range) {
  const seen = new Uint8Array(board.length);
  const result = [];
  for (let i = 0; i < board.length; i++) {
    if (board[i] === '') continue;
    const row = Math.floor(i / boardSize), col = i % boardSize;
    for (let dr = -range; dr <= range; dr++) {
      for (let dc = -range; dc <= range; dc++) {
        const r = row + dr, c = col + dc;
        if (r < 0 || r >= boardSize || c < 0 || c >= boardSize) continue;
        const idx = r * boardSize + c;
        if (board[idx] === '' && !seen[idx]) { seen[idx] = 1; result.push(idx); }
      }
    }
  }
  if (result.length === 0) {
    // Empty board — play near center
    const center = Math.floor(boardSize / 2) * boardSize + Math.floor(boardSize / 2);
    result.push(board[center] === '' ? center : board.findIndex((v) => v === ''));
  }
  return result;
}

// Sort candidates by quick score (best first) and truncate.
function topCandidates(board, boardSize, candidates, aiSym, playerSym, limit) {
  return candidates
    .map((idx) => ({ idx, score: quickMoveScore(board, boardSize, idx, aiSym, playerSym) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.idx);
}

// Alpha-beta minimax. `lastIdx` is the index of the most recent move (for win check).
function minimax(board, boardSize, depth, alpha, beta, isMaximizing, aiSym, playerSym, lastIdx) {
  if (lastIdx !== null) {
    const sym = isMaximizing ? playerSym : aiSym; // last move was by the other side
    if (isWinAtIndex(board, lastIdx, sym, boardSize)) {
      return isMaximizing ? -(SCORE.FIVE + depth) : (SCORE.FIVE + depth);
    }
  }

  if (depth === 0) return evaluateBoard(board, boardSize, aiSym, playerSym);

  const range = depth >= 3 ? 1 : 2;
  const limit = depth >= 3 ? 10 : 18;
  const allCands = getCandidates(board, boardSize, range);
  const cands = topCandidates(board, boardSize, allCands, aiSym, playerSym, limit);

  const sym = isMaximizing ? aiSym : playerSym;

  if (isMaximizing) {
    let best = -Infinity;
    for (const idx of cands) {
      board[idx] = sym;
      const score = minimax(board, boardSize, depth - 1, alpha, beta, false, aiSym, playerSym, idx);
      board[idx] = '';
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const idx of cands) {
      board[idx] = sym;
      const score = minimax(board, boardSize, depth - 1, alpha, beta, true, aiSym, playerSym, idx);
      board[idx] = '';
      if (score < best) best = score;
      if (score < beta) beta = score;
      if (beta <= alpha) break;
    }
    return best;
  }
}

// --- Public move-selection functions ---

function randomMove(board) {
  const empty = board.reduce((acc, v, i) => { if (v === '') acc.push(i); return acc; }, []);
  return empty.length ? empty[Math.floor(Math.random() * empty.length)] : -1;
}

// Level 2: only wins immediately or blocks, otherwise random candidate.
function level2Move(board, boardSize, aiSym, playerSym) {
  const work = [...board];
  const cands = getCandidates(work, boardSize, 2);
  for (const idx of cands) {
    work[idx] = aiSym;
    if (isWinAtIndex(work, idx, aiSym, boardSize)) { work[idx] = ''; return idx; }
    work[idx] = '';
  }
  for (const idx of cands) {
    work[idx] = playerSym;
    if (isWinAtIndex(work, idx, playerSym, boardSize)) { work[idx] = ''; return idx; }
    work[idx] = '';
  }
  return cands[Math.floor(Math.random() * cands.length)];
}

// Level 3: greedy – picks the candidate with the best immediate board eval.
function level3Move(board, boardSize, aiSym, playerSym) {
  const work = [...board];
  const cands = getCandidates(work, boardSize, 2);
  for (const idx of cands) {
    work[idx] = aiSym;
    if (isWinAtIndex(work, idx, aiSym, boardSize)) { work[idx] = ''; return idx; }
    work[idx] = '';
  }
  for (const idx of cands) {
    work[idx] = playerSym;
    if (isWinAtIndex(work, idx, playerSym, boardSize)) { work[idx] = ''; return idx; }
    work[idx] = '';
  }
  let best = -Infinity, bestIdx = cands[0];
  for (const idx of cands) {
    work[idx] = aiSym;
    const s = evaluateBoard(work, boardSize, aiSym, playerSym);
    work[idx] = '';
    if (s > best) { best = s; bestIdx = idx; }
  }
  return bestIdx;
}

// Levels 4 & 5: minimax at given depth.
function minimaxMove(board, boardSize, aiSym, playerSym, depth) {
  const work = [...board];
  const allCands = getCandidates(work, boardSize, 2);

  // Immediate checks first (free optimisation)
  for (const idx of allCands) {
    work[idx] = aiSym;
    if (isWinAtIndex(work, idx, aiSym, boardSize)) { work[idx] = ''; return idx; }
    work[idx] = '';
  }
  for (const idx of allCands) {
    work[idx] = playerSym;
    if (isWinAtIndex(work, idx, playerSym, boardSize)) { work[idx] = ''; return idx; }
    work[idx] = '';
  }

  const limit = depth >= 4 ? 12 : 20;
  const cands = topCandidates(work, boardSize, allCands, aiSym, playerSym, limit);

  let best = -Infinity, bestIdx = cands[0];
  for (const idx of cands) {
    work[idx] = aiSym;
    const score = minimax(work, boardSize, depth - 1, -Infinity, Infinity, false, aiSym, playerSym, idx);
    work[idx] = '';
    if (score > best) { best = score; bestIdx = idx; }
  }
  return bestIdx;
}

/**
 * Return the index of the AI's chosen move.
 *
 * @param {string[]} board      - 1-D board array ("", "X", or "O")
 * @param {number}   boardSize  - side length
 * @param {string}   aiSym      - AI's symbol ("X" or "O")
 * @param {string}   playerSym  - human's symbol
 * @param {number}   difficulty - 1 (easiest) … 5 (hardest)
 * @returns {number} index of the chosen cell
 */
export function getAIMove(board, boardSize, aiSym, playerSym, difficulty) {
  switch (difficulty) {
    case 1: return randomMove(board);
    case 2: return level2Move(board, boardSize, aiSym, playerSym);
    case 3: return level3Move(board, boardSize, aiSym, playerSym);
    case 4: return minimaxMove(board, boardSize, aiSym, playerSym, 2);
    case 5: return minimaxMove(board, boardSize, aiSym, playerSym, 4);
    default: return randomMove(board);
  }
}
