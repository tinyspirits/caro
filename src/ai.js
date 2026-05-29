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
// When blockBothEnds is true, an exactly-WIN_LENGTH run with 0 open ends is not a win.
function seqScore(count, openEnds, blockBothEnds = false) {
  if (count >= WIN_LENGTH) {
    // Under blockBothEnds rule: exactly WIN_LENGTH-in-a-row that is blocked on both sides scores 0.
    // Overlines (count > WIN_LENGTH) are always wins regardless of blocking.
    if (blockBothEnds && count === WIN_LENGTH && openEnds === 0) return 0;
    return SCORE.FIVE;
  }
  if (openEnds === 0) return 0;
  switch (count) {
    case 4: return openEnds === 2 ? SCORE.OPEN_FOUR : SCORE.HALF_FOUR;
    case 3: return openEnds === 2 ? SCORE.OPEN_THREE : SCORE.HALF_THREE;
    case 2: return openEnds === 2 ? SCORE.OPEN_TWO : SCORE.HALF_TWO;
    default: return 0;
  }
}

// Score all sequences of `symbol` across every row, column, and diagonal.
function evalBoardFor(board, boardSize, symbol, rules = null) {
  const blockBothEnds = rules?.blockBothEnds ?? false;
  let total = 0;

  const scoreLine = (getCell) => {
    let i = 0;
    while (i < boardSize) {
      if (getCell(i) !== symbol) { i++; continue; }
      let j = i;
      while (j < boardSize && getCell(j) === symbol) j++;
      const count = j - i;
      // Count contiguous empty space in each direction
      let bwdSpace = 0, k = i - 1;
      while (k >= 0 && getCell(k) === '') { bwdSpace++; k--; }
      let fwdSpace = 0, fwdK = j;
      while (fwdK < boardSize && getCell(fwdK) === '') { fwdSpace++; fwdK++; }
      // Skip sequences whose total window can never reach WIN_LENGTH
      if (count + bwdSpace + fwdSpace < WIN_LENGTH) { i = j; continue; }
      // Under blockBothEnds: if the window is exactly WIN_LENGTH and both outer ends are
      // blocked (wall or opponent), any 5-in-a-row that fills this window will itself be
      // blocked on both sides — it can never be a valid win, so score 0.
      if (blockBothEnds && count + bwdSpace + fwdSpace === WIN_LENGTH) {
        const bwdFarBlocked = k < 0 || getCell(k) !== symbol;
        const fwdFarBlocked = fwdK >= boardSize || getCell(fwdK) !== symbol;
        if (bwdFarBlocked && fwdFarBlocked) { i = j; continue; }
      }
      total += seqScore(count, (bwdSpace > 0 ? 1 : 0) + (fwdSpace > 0 ? 1 : 0), blockBothEnds);
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
// A small defensive bias (DEFENSIVE_BIAS) makes the AI slightly favour blocking
// over attacking when scores are equal, which produces safer play.
const DEFENSIVE_BIAS = 1.05;

function evaluateBoard(board, boardSize, aiSym, playerSym, rules = null) {
  return evalBoardFor(board, boardSize, aiSym, rules) - evalBoardFor(board, boardSize, playerSym, rules) * DEFENSIVE_BIAS;
}

// Quick per-cell score used for move ordering (cheap directional scan).
function quickMoveScore(board, boardSize, idx, aiSym, playerSym, rules = null) {
  const blockBothEnds = rules?.blockBothEnds ?? false;
  const row = Math.floor(idx / boardSize);
  const col = idx % boardSize;
  let score = 0;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];

  for (const [dr, dc] of dirs) {
    for (const [sym, weight] of [[aiSym, 1.0], [playerSym, 0.95]]) {
      board[idx] = sym;
      let cnt = 1;
      let r = row + dr, c = col + dc;
      while (r >= 0 && r < boardSize && c >= 0 && c < boardSize && board[r * boardSize + c] === sym) {
        cnt++; r += dr; c += dc;
      }
      let fwdOpen = 0;
      while (r >= 0 && r < boardSize && c >= 0 && c < boardSize && board[r * boardSize + c] === '') {
        fwdOpen++; r += dr; c += dc;
      }
      // Save far-forward position for blockBothEnds check
      const fwdFarR = r, fwdFarC = c;
      r = row - dr; c = col - dc;
      while (r >= 0 && r < boardSize && c >= 0 && c < boardSize && board[r * boardSize + c] === sym) {
        cnt++; r -= dr; c -= dc;
      }
      let bwdOpen = 0;
      while (r >= 0 && r < boardSize && c >= 0 && c < boardSize && board[r * boardSize + c] === '') {
        bwdOpen++; r -= dr; c -= dc;
      }
      board[idx] = '';
      // Skip if window can never reach WIN_LENGTH
      if (cnt + fwdOpen + bwdOpen < WIN_LENGTH) continue;
      // Under blockBothEnds: skip if only possible win is trapped on both ends
      if (blockBothEnds && cnt + fwdOpen + bwdOpen === WIN_LENGTH) {
        const fwdFarCell = fwdFarR >= 0 && fwdFarR < boardSize && fwdFarC >= 0 && fwdFarC < boardSize
          ? board[fwdFarR * boardSize + fwdFarC] : null;
        const bwdFarCell = r >= 0 && r < boardSize && c >= 0 && c < boardSize
          ? board[r * boardSize + c] : null;
        const fwdFarBlocked = fwdFarCell === null || (fwdFarCell !== '' && fwdFarCell !== sym);
        const bwdFarBlocked = bwdFarCell === null || (bwdFarCell !== '' && bwdFarCell !== sym);
        if (fwdFarBlocked && bwdFarBlocked) continue;
      }
      score += seqScore(cnt, (fwdOpen > 0 ? 1 : 0) + (bwdOpen > 0 ? 1 : 0), blockBothEnds) * weight;
    }
  }
  return score;
}

// Check if an end cell blocks a sequence: wall (out of bounds) or opponent piece = blocked.
function isEndBlockedAI(board, row, col, boardSize, symbol) {
  if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) return true; // wall = blocked
  const cell = board[row * boardSize + col];
  return cell !== '' && cell !== symbol;
}

// Check if placing `symbol` at `index` creates a valid win (respects blockBothEnds rule).
// @param {object|null} rules - game rules object, e.g. { blockBothEnds: true }
function isWinAtIndex(board, index, symbol, boardSize, rules = null) {
  const row = Math.floor(index / boardSize);
  const col = index % boardSize;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    let fwd = 0;
    for (let d = 1; d < WIN_LENGTH; d++) {
      const r = row + dr * d, c = col + dc * d;
      if (r < 0 || r >= boardSize || c < 0 || c >= boardSize || board[r * boardSize + c] !== symbol) break;
      fwd++;
    }
    let bwd = 0;
    for (let d = 1; d < WIN_LENGTH; d++) {
      const r = row - dr * d, c = col - dc * d;
      if (r < 0 || r >= boardSize || c < 0 || c >= boardSize || board[r * boardSize + c] !== symbol) break;
      bwd++;
    }
    const cnt = 1 + fwd + bwd;
    if (cnt >= WIN_LENGTH) {
      if (rules?.blockBothEnds && cnt === WIN_LENGTH) {
        const fwdBlocked = isEndBlockedAI(board, row + (fwd + 1) * dr, col + (fwd + 1) * dc, boardSize, symbol);
        const bwdBlocked = isEndBlockedAI(board, row - (bwd + 1) * dr, col - (bwd + 1) * dc, boardSize, symbol);
        if (fwdBlocked && bwdBlocked) continue;
      }
      return true;
    }
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
    if (board[center] === '') {
      result.push(center);
    } else {
      // Unlikely edge case: center occupied on an otherwise empty board
      for (let i = 0; i < board.length; i++) {
        if (board[i] === '') { result.push(i); break; }
      }
    }
  }
  return result;
}

// Sort candidates by quick score (best first) and truncate.
// biasMap (optional Map<index, number>) adds a training-data bonus to scores.
function topCandidates(board, boardSize, candidates, aiSym, playerSym, limit, biasMap = null, rules = null) {
  const BIAS_SCALE = 50; // keep bias small relative to heuristic scores
  return candidates
    .map((idx) => ({
      idx,
      score: quickMoveScore(board, boardSize, idx, aiSym, playerSym, rules)
        + (biasMap ? (biasMap.get(idx) || 0) * BIAS_SCALE : 0),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.idx);
}

// Alpha-beta minimax. `lastIdx` is the index of the most recent move (for win check).
function minimax(board, boardSize, depth, alpha, beta, isMaximizing, aiSym, playerSym, lastIdx, biasMap = null, rules = null) {
  if (lastIdx !== null) {
    const sym = isMaximizing ? playerSym : aiSym; // last move was by the other side
    if (isWinAtIndex(board, lastIdx, sym, boardSize, rules)) {
      return isMaximizing ? -(SCORE.FIVE + depth) : (SCORE.FIVE + depth);
    }
  }

  if (depth === 0) return evaluateBoard(board, boardSize, aiSym, playerSym, rules);

  const range = depth >= 3 ? 1 : 2;
  const limit = depth >= 3 ? 10 : 18;
  const allCands = getCandidates(board, boardSize, range);
  const cands = topCandidates(board, boardSize, allCands, aiSym, playerSym, limit, biasMap, rules);

  const sym = isMaximizing ? aiSym : playerSym;

  if (isMaximizing) {
    let best = -Infinity;
    for (const idx of cands) {
      board[idx] = sym;
      const score = minimax(board, boardSize, depth - 1, alpha, beta, false, aiSym, playerSym, idx, biasMap, rules);
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
      const score = minimax(board, boardSize, depth - 1, alpha, beta, true, aiSym, playerSym, idx, biasMap, rules);
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
function level2Move(board, boardSize, aiSym, playerSym, rules = null) {
  const work = [...board];
  const cands = getCandidates(work, boardSize, 2);
  for (const idx of cands) {
    work[idx] = aiSym;
    if (isWinAtIndex(work, idx, aiSym, boardSize, rules)) { work[idx] = ''; return idx; }
    work[idx] = '';
  }
  for (const idx of cands) {
    work[idx] = playerSym;
    if (isWinAtIndex(work, idx, playerSym, boardSize, rules)) { work[idx] = ''; return idx; }
    work[idx] = '';
  }
  return cands[Math.floor(Math.random() * cands.length)];
}

// Level 3: greedy – picks the candidate with the best immediate board eval.
function level3Move(board, boardSize, aiSym, playerSym, biasMap = null, rules = null) {
  const work = [...board];
  const cands = getCandidates(work, boardSize, 2);
  for (const idx of cands) {
    work[idx] = aiSym;
    if (isWinAtIndex(work, idx, aiSym, boardSize, rules)) { work[idx] = ''; return idx; }
    work[idx] = '';
  }
  for (const idx of cands) {
    work[idx] = playerSym;
    if (isWinAtIndex(work, idx, playerSym, boardSize, rules)) { work[idx] = ''; return idx; }
    work[idx] = '';
  }
  let best = -Infinity, bestIdx = cands[0];
  for (const idx of cands) {
    work[idx] = aiSym;
    const s = evaluateBoard(work, boardSize, aiSym, playerSym, rules)
      + (biasMap ? (biasMap.get(idx) || 0) * 50 : 0);
    work[idx] = '';
    if (s > best) { best = s; bestIdx = idx; }
  }
  return bestIdx;
}

// Levels 4 & 5: minimax at given depth.
function minimaxMove(board, boardSize, aiSym, playerSym, depth, biasMap = null, rules = null) {
  const work = [...board];
  const allCands = getCandidates(work, boardSize, 2);

  // Immediate checks first (free optimisation)
  for (const idx of allCands) {
    work[idx] = aiSym;
    if (isWinAtIndex(work, idx, aiSym, boardSize, rules)) { work[idx] = ''; return idx; }
    work[idx] = '';
  }
  for (const idx of allCands) {
    work[idx] = playerSym;
    if (isWinAtIndex(work, idx, playerSym, boardSize, rules)) { work[idx] = ''; return idx; }
    work[idx] = '';
  }

  const limit = depth >= 4 ? 12 : 20;
  const cands = topCandidates(work, boardSize, allCands, aiSym, playerSym, limit, biasMap, rules);

  let best = -Infinity, bestIdx = cands[0];
  for (const idx of cands) {
    work[idx] = aiSym;
    const score = minimax(work, boardSize, depth - 1, -Infinity, Infinity, false, aiSym, playerSym, idx, biasMap, rules);
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
 * @param {Map<number,number>} [biasMap] - optional training bias (cell → score bonus)
 * @param {object}   [rules]    - game rules, e.g. { blockBothEnds: true }
 * @returns {number} index of the chosen cell
 */
export function getAIMove(board, boardSize, aiSym, playerSym, difficulty, biasMap = null, rules = null) {
  switch (difficulty) {
    case 1: return randomMove(board);
    case 2: return level2Move(board, boardSize, aiSym, playerSym, rules);
    case 3: return level3Move(board, boardSize, aiSym, playerSym, biasMap, rules);
    case 4: return minimaxMove(board, boardSize, aiSym, playerSym, 2, biasMap, rules);
    case 5: return minimaxMove(board, boardSize, aiSym, playerSym, 4, biasMap, rules);
    default: return randomMove(board);
  }
}
