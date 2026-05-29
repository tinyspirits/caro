// groq.js - Play Caro against Groq AI (free tier available)

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'llama-3.3-70b-versatile';

/**
 * Ask Groq to pick the best move on the current Caro board.
 *
 * @param {string[]} board      - 1-D board array ("", "X", or "O")
 * @param {number}   boardSize  - side length
 * @param {string}   aiSym      - Groq's symbol ("X" or "O")
 * @param {string}   playerSym  - human's symbol
 * @param {string}   apiKey     - Groq API key
 * @param {{blockBothEnds?: boolean}} [rules] - optional game rules
 * @returns {Promise<number>}   index of the chosen cell
 */
export async function getGroqMove(board, boardSize, aiSym, playerSym, apiKey, rules = {}) {
  // Build a compact text representation of the board
  const colHeader =
    '     ' + Array.from({ length: boardSize }, (_, i) => String(i).padStart(2)).join('');
  const rows = [];
  for (let r = 0; r < boardSize; r++) {
    let row = '';
    for (let c = 0; c < boardSize; c++) {
      const cell = board[r * boardSize + c];
      row += (cell || '.').padStart(2);
    }
    rows.push(String(r).padStart(2) + ': ' + row);
  }
  const boardStr = [colHeader, ...rows].join('\n');

  const blockBothEndsNote = rules.blockBothEnds
    ? 'Special rule: a sequence of exactly 5 that is blocked on BOTH ends by the opponent does NOT count as a win.\n'
    : '';

  const prompt =
    'You are an expert Caro (Gomoku) player on a ' + boardSize + 'x' + boardSize + ' board.\n' +
    'Rules: first to get 5 consecutive pieces in a row, column, or diagonal wins.\n' +
    blockBothEndsNote +
    'You play as "' + aiSym + '". Opponent plays as "' + playerSym + '". Empty cells shown as ".".\n\n' +
    'Board (row 0-' + (boardSize - 1) + ', col 0-' + (boardSize - 1) + '):\n' + boardStr + '\n\n' +
    'Strategy priorities:\n' +
    '1. Win immediately if you can form 5 in a row.\n' +
    '2. Block the opponent if they are about to win.\n' +
    '3. Build the strongest offensive position otherwise.\n\n' +
    'Reply with ONLY "row,col" (example: "7,8"). No explanation, no extra text.';

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + apiKey,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 20,
    }),
  });

  if (!response.ok) {
    let msg = 'Groq API l\u1ed7i: ' + response.status;
    try {
      const errBody = await response.json();
      if (errBody?.error?.message) msg = errBody.error.message;
    } catch (_) {
      // ignore parse error
    }
    throw new Error(msg);
  }

  const data = await response.json();
  const text = (data?.choices?.[0]?.message?.content || '').trim();

  // Accept "row,col" anywhere in the response
  const match = text.match(/(\d+)\s*,\s*(\d+)/);
  if (!match) {
    throw new Error('Groq tr\u1ea3 v\u1ec1 n\u1ed9i dung kh\u00f4ng h\u1ee3p l\u1ec7: "' + text + '"');
  }

  const row = parseInt(match[1], 10);
  const col = parseInt(match[2], 10);

  if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) {
    throw new Error('Groq ch\u1ecdn \u00f4 ngo\u00e0i b\u00e0n c\u1edd: ' + row + ',' + col);
  }

  const idx = row * boardSize + col;
  if (board[idx] !== '') {
    const err = new Error('Groq ch\u1ecdn \u00f4 \u0111\u00e3 c\u00f3 qu\u00e2n: ' + row + ',' + col);
    err.code = 'OCCUPIED_CELL';
    throw err;
  }

  return idx;
}
