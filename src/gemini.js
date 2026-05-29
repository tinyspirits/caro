// gemini.js – Play Caro against Google Gemini AI

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';

/**
 * Ask Gemini to pick the best move on the current Caro board.
 *
 * @param {string[]} board      - 1-D board array ("", "X", or "O")
 * @param {number}   boardSize  - side length
 * @param {string}   aiSym      - Gemini's symbol ("X" or "O")
 * @param {string}   playerSym  - human's symbol
 * @param {string}   apiKey     - Google Generative Language API key
 * @returns {Promise<number>}   index of the chosen cell
 */
export async function getGeminiMove(board, boardSize, aiSym, playerSym, apiKey) {
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
    rows.push(`${String(r).padStart(2)}: ${row}`);
  }
  const boardStr = [colHeader, ...rows].join('\n');

  const prompt =
    `You are an expert Caro (Gomoku) player on a ${boardSize}x${boardSize} board.\n` +
    `Rules: first to get 5 consecutive pieces in a row, column, or diagonal wins.\n` +
    `You play as "${aiSym}". Opponent plays as "${playerSym}". Empty cells shown as ".".\n\n` +
    `Board (row 0-${boardSize - 1}, col 0-${boardSize - 1}):\n${boardStr}\n\n` +
    `Strategy priorities:\n` +
    `1. Win immediately if you can form 5 in a row.\n` +
    `2. Block the opponent if they are about to win.\n` +
    `3. Build the strongest offensive position otherwise.\n\n` +
    `Reply with ONLY "row,col" (example: "7,8"). No explanation, no extra text.`;

  const response = await fetch(`${GEMINI_API_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 20 },
    }),
  });

  if (!response.ok) {
    let msg = `Gemini API lỗi: ${response.status}`;
    try {
      const errBody = await response.json();
      if (errBody?.error?.message) msg = errBody.error.message;
    } catch (_) {
      // ignore parse error
    }
    throw new Error(msg);
  }

  const data = await response.json();
  const text = (data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();

  // Accept "row,col" anywhere in the response
  const match = text.match(/(\d+)\s*,\s*(\d+)/);
  if (!match) {
    throw new Error(`Gemini trả về nội dung không hợp lệ: "${text}"`);
  }

  const row = parseInt(match[1], 10);
  const col = parseInt(match[2], 10);

  if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) {
    throw new Error(`Gemini chọn ô ngoài bàn cờ: ${row},${col}`);
  }

  const idx = row * boardSize + col;
  if (board[idx] !== '') {
    throw new Error(`Gemini chọn ô đã có quân: ${row},${col}`);
  }

  return idx;
}
