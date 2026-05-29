import { onValue, onDisconnect, ref, runTransaction, set } from "firebase/database";
import { database } from "./firebase";
import { getAIMove } from "./ai";
import { getGeminiMove } from "./gemini";
import "./style.css";

const WIN_LENGTH = 5;
const STORAGE_KEY = "caro-online-player";
const THEME_KEY = "caro-theme";
const GEMINI_KEY = "caro-gemini-key";
const BOARD_SIZE_PRESETS = [15, 30];
const DEFAULT_BOARD_SIZE = 15;

const AI_DIFFICULTY_LABELS = ["", "Dễ", "Trung bình thấp", "Trung bình", "Khó", "Rất khó"];

const savedPlayer = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");

// Theme initialisation – apply before first render to avoid flash
const savedTheme = localStorage.getItem(THEME_KEY) || "dark";
document.documentElement.setAttribute("data-theme", savedTheme);

const state = {
  playerId: savedPlayer.id || crypto.randomUUID(),
  playerName: savedPlayer.name || "",
  // "online" | "ai"
  mode: "online",
  roomId: "",
  playerSymbol: "",
  isViewer: false,
  roomData: null,
  unsubscribeRoom: null,
  error: "",
  theme: savedTheme,
  // Settings used when creating a new room
  settings: {
    boardSize: DEFAULT_BOARD_SIZE,
    customBoardSize: 20,
    useCustomSize: false,
    blockBothEnds: false,
  },
  // Settings and runtime state for AI mode
  aiSettings: {
    difficulty: 3,
    boardSize: DEFAULT_BOARD_SIZE,
    customBoardSize: 20,
    useCustomSize: false,
    blockBothEnds: false,
  },
  // Active AI game (null = no game in progress)
  aiGame: null,
  // Settings for 2-player local mode
  localSettings: {
    boardSize: DEFAULT_BOARD_SIZE,
    customBoardSize: 20,
    useCustomSize: false,
    blockBothEnds: false,
    player1Name: "Người chơi 1",
    player2Name: "Người chơi 2",
  },
  // Active local game (null = no game in progress)
  localGame: null,
  // Settings and runtime state for Gemini AI mode
  geminiSettings: {
    apiKey: localStorage.getItem(GEMINI_KEY) || "",
    boardSize: DEFAULT_BOARD_SIZE,
    customBoardSize: 20,
    useCustomSize: false,
    blockBothEnds: false,
  },
  // Active Gemini game (null = no game in progress)
  geminiGame: null,
  // Aggregated Firebase stats
  stats: {
    visitCount: 0,
    onlineCount: 0,
  },
};

localStorage.setItem(
  STORAGE_KEY,
  JSON.stringify({ id: state.playerId, name: state.playerName }),
);

function clampBoardSize(size) {
  return Math.max(5, Math.min(50, size || DEFAULT_BOARD_SIZE));
}

function createEmptyBoard(boardSize) {
  return Array(boardSize * boardSize).fill("");
}

function createRoomData(name) {
  const boardSize = state.settings.useCustomSize
    ? clampBoardSize(state.settings.customBoardSize)
    : state.settings.boardSize;
  return {
    board: createEmptyBoard(boardSize),
    boardSize,
    rules: { blockBothEnds: state.settings.blockBothEnds },
    currentTurn: "X",
    status: "waiting",
    winner: "",
    players: {
      X: { id: state.playerId, name },
      O: null,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function checkWinner(board, index, symbol, boardSize, rules) {
  const row = Math.floor(index / boardSize);
  const col = index % boardSize;
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  for (const [dr, dc] of directions) {
    const fwd = countDirection(board, row, col, dr, dc, symbol, boardSize);
    const bwd = countDirection(board, row, col, -dr, -dc, symbol, boardSize);
    const count = 1 + fwd + bwd;

    if (count >= WIN_LENGTH) {
      // Only apply the "blocked both ends" exception for exactly WIN_LENGTH pieces.
      // For overlines (count > WIN_LENGTH) any interior 5-piece sub-sequence has the
      // player's own pieces on both inner sides, so it can never be blocked at both
      // ends by an opponent — overlines are always a win.
      if (rules?.blockBothEnds && count === WIN_LENGTH) {
        const fwdEndRow = row + (fwd + 1) * dr;
        const fwdEndCol = col + (fwd + 1) * dc;
        const bwdEndRow = row - (bwd + 1) * dr;
        const bwdEndCol = col - (bwd + 1) * dc;
        const fwdBlocked = isEndBlocked(board, fwdEndRow, fwdEndCol, boardSize, symbol);
        const bwdBlocked = isEndBlocked(board, bwdEndRow, bwdEndCol, boardSize, symbol);
        if (fwdBlocked && bwdBlocked) {
          continue;
        }
      }
      return true;
    }
  }

  return false;
}

function countDirection(board, row, col, dr, dc, symbol, boardSize) {
  let count = 0;
  let nextRow = row + dr;
  let nextCol = col + dc;

  while (
    nextRow >= 0 &&
    nextRow < boardSize &&
    nextCol >= 0 &&
    nextCol < boardSize &&
    board[nextRow * boardSize + nextCol] === symbol
  ) {
    count += 1;
    nextRow += dr;
    nextCol += dc;
  }

  return count;
}

function isEndBlocked(board, row, col, boardSize, symbol) {
  // Out of bounds → board edge is open (not blocked)
  if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) {
    return false;
  }
  const cell = board[row * boardSize + col];
  // Blocked only by an opponent's piece directly at this cell; empty = open
  return cell !== "" && cell !== symbol;
}

function getRoomRef(roomId) {
  return ref(database, `rooms/${roomId}`);
}

function getFriendlyError(error) {
  const normalizedMessage = `${error?.code || ""} ${error?.message || error || ""}`.toLowerCase();

  if (normalizedMessage.includes("permission_denied") || normalizedMessage.includes("permission denied")) {
    return "Firebase Realtime Database đang chặn truy cập. Hãy mở quyền đọc/ghi cho đường dẫn rooms hoặc cập nhật rules phù hợp.";
  }

  return error?.message || "Đã có lỗi xảy ra. Vui lòng thử lại.";
}

function persistPlayerName(name) {
  state.playerName = name;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ id: state.playerId, name: state.playerName }),
  );
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  localStorage.setItem(THEME_KEY, state.theme);
  document.documentElement.setAttribute("data-theme", state.theme);
  render();
}

function generateRoomId() {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
}

function joinRoomSymbol(room) {
  if (room?.players?.X?.id === state.playerId) {
    return "X";
  }

  if (room?.players?.O?.id === state.playerId) {
    return "O";
  }

  return "";
}

async function joinRoom({ roomId, playerName }) {
  const normalizedRoomId = roomId.trim().toUpperCase() || generateRoomId();
  const trimmedName = playerName.trim();

  if (!trimmedName) {
    state.error = "Vui lòng nhập tên của bạn.";
    render();
    return;
  }

  persistPlayerName(trimmedName);

  try {
    const transaction = await runTransaction(getRoomRef(normalizedRoomId), (room) => {
      if (!room) {
        return createRoomData(trimmedName);
      }

      room.players ||= { X: null, O: null };

      if (room.players.X?.id === state.playerId) {
        room.players.X.name = trimmedName;
      } else if (room.players.O?.id === state.playerId) {
        room.players.O.name = trimmedName;
      } else if (!room.players.X) {
        room.players.X = { id: state.playerId, name: trimmedName };
      } else if (!room.players.O) {
        room.players.O = { id: state.playerId, name: trimmedName };
      } else {
        return room;
      }

      room.board ||= createEmptyBoard(room.boardSize || DEFAULT_BOARD_SIZE);
      room.status = room.players.X && room.players.O ? "playing" : "waiting";
      room.currentTurn ||= "X";
      room.updatedAt = Date.now();
      return room;
    });

    const room = transaction.snapshot.val();
    const playerSymbol = joinRoomSymbol(room);

    if (!playerSymbol) {
      if (room?.players?.X && room?.players?.O) {
        // Room is full — join as viewer
        subscribeToRoom(normalizedRoomId);
        state.roomId = normalizedRoomId;
        state.playerSymbol = "";
        state.isViewer = true;
        state.error = "";
        render();
        return;
      }
      state.error = "Phòng đã đủ 2 người chơi. Hãy dùng mã phòng khác.";
      render();
      return;
    }

    subscribeToRoom(normalizedRoomId);
    state.roomId = normalizedRoomId;
    state.playerSymbol = playerSymbol;
    state.isViewer = false;
    state.error = "";
    render();
  } catch (error) {
    state.error = getFriendlyError(error);
    render();
  }
}

function subscribeToRoom(roomId) {
  if (state.unsubscribeRoom) {
    state.unsubscribeRoom();
  }

  const roomRef = getRoomRef(roomId);
  state.unsubscribeRoom = onValue(
    roomRef,
    (snapshot) => {
      state.roomData = snapshot.val();

      if (!state.roomData) {
        state.roomId = "";
        state.playerSymbol = "";
        state.isViewer = false;
        state.error = "Phòng đã bị đóng.";
      } else {
        state.playerSymbol = joinRoomSymbol(state.roomData);
      }

      render();
    },
    (error) => {
      state.error = getFriendlyError(error);
      render();
    },
  );
}

async function leaveRoom() {
  if (!state.roomId) {
    state.roomId = "";
    state.playerSymbol = "";
    state.isViewer = false;
    state.roomData = null;
    render();
    return;
  }

  // Viewers are not stored in Firebase — just unsubscribe locally
  if (state.isViewer) {
    if (state.unsubscribeRoom) {
      state.unsubscribeRoom();
      state.unsubscribeRoom = null;
    }
    state.roomId = "";
    state.playerSymbol = "";
    state.isViewer = false;
    state.roomData = null;
    state.error = "";
    render();
    return;
  }

  if (!state.playerSymbol) {
    state.roomId = "";
    state.playerSymbol = "";
    state.roomData = null;
    render();
    return;
  }

  const symbol = state.playerSymbol;
  const roomId = state.roomId;

  try {
    await runTransaction(getRoomRef(roomId), (room) => {
      if (!room?.players) {
        return room;
      }

      room.players[symbol] = null;

      if (!room.players.X && !room.players.O) {
        return null;
      }

      room.status = room.players.X && room.players.O ? "playing" : "waiting";
      room.currentTurn = "X";
      room.winner = "";
      room.board = createEmptyBoard(room.boardSize || DEFAULT_BOARD_SIZE);
      room.updatedAt = Date.now();
      return room;
    });
  } catch (error) {
    state.error = getFriendlyError(error);
    render();
    return;
  }

  if (state.unsubscribeRoom) {
    state.unsubscribeRoom();
    state.unsubscribeRoom = null;
  }

  state.roomId = "";
  state.playerSymbol = "";
  state.isViewer = false;
  state.roomData = null;
  state.error = "";
  render();
}

async function makeMove(index) {
  if (!state.roomId || !state.playerSymbol) {
    return;
  }

  try {
    await runTransaction(getRoomRef(state.roomId), (room) => {
      if (!room || room.status !== "playing" || room.currentTurn !== state.playerSymbol) {
        return room;
      }

      room.board ||= createEmptyBoard(room.boardSize || DEFAULT_BOARD_SIZE);

      if (room.board[index]) {
        return room;
      }

      room.board[index] = state.playerSymbol;
      room.lastMove = index;

      const boardSize = room.boardSize || DEFAULT_BOARD_SIZE;
      const rules = room.rules || {};
      if (checkWinner(room.board, index, state.playerSymbol, boardSize, rules)) {
        room.status = "won";
        room.winner = state.playerSymbol;
        room.currentTurn = "";
      } else if (room.board.every(Boolean)) {
        room.status = "draw";
        room.winner = "";
        room.currentTurn = "";
      } else {
        room.currentTurn = state.playerSymbol === "X" ? "O" : "X";
      }

      room.updatedAt = Date.now();
      return room;
    });
  } catch (error) {
    state.error = getFriendlyError(error);
    render();
  }
}

async function restartGame() {
  if (!state.roomId) {
    return;
  }

  try {
    await runTransaction(getRoomRef(state.roomId), (room) => {
      if (!room) {
        return room;
      }

      // Swap X and O players after each game
      if (room.players?.X && room.players?.O) {
        const temp = room.players.X;
        room.players.X = room.players.O;
        room.players.O = temp;
      }

      room.board = createEmptyBoard(room.boardSize || DEFAULT_BOARD_SIZE);
      room.winner = "";
      room.lastMove = null;
      room.currentTurn = "X";
      room.status = room.players?.X && room.players?.O ? "playing" : "waiting";
      room.updatedAt = Date.now();
      return room;
    });
  } catch (error) {
    state.error = getFriendlyError(error);
    render();
  }
}

// ---------------------------------------------------------------------------
// AI-mode logic
// ---------------------------------------------------------------------------

function aiClampBoardSize(size) {
  return Math.max(5, Math.min(50, size || DEFAULT_BOARD_SIZE));
}

function startAIGame() {
  const boardSize = state.aiSettings.useCustomSize
    ? aiClampBoardSize(state.aiSettings.customBoardSize)
    : state.aiSettings.boardSize;

  state.aiGame = {
    board: Array(boardSize * boardSize).fill(""),
    boardSize,
    currentTurn: "X",
    status: "playing",
    winner: "",
    lastMove: null,
    thinking: false,
    playerSymbol: "X",
    aiSymbol: "O",
    difficulty: state.aiSettings.difficulty,
    rules: { blockBothEnds: state.aiSettings.blockBothEnds },
  };
  render();
}

function leaveAIGame() {
  state.aiGame = null;
  render();
}

function restartAIGame() {
  if (!state.aiGame) return;
  const { boardSize, playerSymbol, aiSymbol, difficulty, rules } = state.aiGame;
  // Swap sides each restart
  const newPlayerSym = aiSymbol;
  const newAISym = playerSymbol;
  state.aiGame = {
    board: Array(boardSize * boardSize).fill(""),
    boardSize,
    currentTurn: "X",
    status: "playing",
    winner: "",
    lastMove: null,
    thinking: false,
    playerSymbol: newPlayerSym,
    aiSymbol: newAISym,
    difficulty,
    rules,
  };
  render();
  // If AI goes first (X) after the swap
  if (state.aiGame.currentTurn === state.aiGame.aiSymbol) {
    scheduleAIMove();
  }
}

function scheduleAIMove() {
  state.aiGame.thinking = true;
  render();
  setTimeout(() => {
    if (!state.aiGame || state.aiGame.status !== "playing") return;
    const { board, boardSize, aiSymbol, playerSymbol, difficulty, rules } = state.aiGame;
    const idx = getAIMove([...board], boardSize, aiSymbol, playerSymbol, difficulty);
    if (idx === -1 || idx === null) return;
    applyAIBoardMove(idx, aiSymbol);
  }, 50);
}

function applyAIBoardMove(index, symbol) {
  if (!state.aiGame) return;
  const g = state.aiGame;
  if (g.board[index]) return;

  g.board[index] = symbol;
  g.lastMove = index;
  g.thinking = false;

  if (checkWinner(g.board, index, symbol, g.boardSize, g.rules)) {
    g.status = "won";
    g.winner = symbol;
    g.currentTurn = "";
  } else if (g.board.every(Boolean)) {
    g.status = "draw";
    g.currentTurn = "";
  } else {
    g.currentTurn = symbol === "X" ? "O" : "X";
  }
  render();
}

function makeAIMoveLocal(index) {
  const g = state.aiGame;
  if (!g || g.status !== "playing" || g.thinking) return;
  if (g.currentTurn !== g.playerSymbol) return;
  if (g.board[index]) return;

  applyAIBoardMove(index, g.playerSymbol);

  // Schedule AI response if game is still going
  if (state.aiGame && state.aiGame.status === "playing") {
    scheduleAIMove();
  }
}

// ---------------------------------------------------------------------------
// Visit / presence tracking
// ---------------------------------------------------------------------------

function trackVisit() {
  runTransaction(ref(database, "stats/visitCount"), (count) => (count || 0) + 1).catch((err) => {
    console.warn("[caro] trackVisit failed:", err?.message || err);
  });
}

function initPresence() {
  const connRef = ref(database, ".info/connected");
  const presRef = ref(database, `presence/${state.playerId}`);
  onValue(connRef, (snap) => {
    if (snap.val() === true) {
      set(presRef, { since: Date.now() }).catch((err) => {
        console.warn("[caro] initPresence set failed:", err?.message || err);
      });
      onDisconnect(presRef).remove();
    }
  });
}

function subscribeStats() {
  onValue(ref(database, "stats/visitCount"), (snap) => {
    state.stats.visitCount = snap.val() || 0;
    render();
  });
  onValue(ref(database, "presence"), (snap) => {
    state.stats.onlineCount = snap.exists() ? Object.keys(snap.val()).length : 0;
    render();
  });
}

// ---------------------------------------------------------------------------
// 2-player local (offline) mode logic
// ---------------------------------------------------------------------------

function startLocalGame() {
  const s = state.localSettings;
  const boardSize = s.useCustomSize
    ? clampBoardSize(s.customBoardSize)
    : s.boardSize;
  state.localGame = {
    board: Array(boardSize * boardSize).fill(""),
    boardSize,
    currentTurn: "X",
    status: "playing",
    winner: "",
    lastMove: null,
    player1Name: s.player1Name.trim() || "Người chơi 1",
    player2Name: s.player2Name.trim() || "Người chơi 2",
    rules: { blockBothEnds: s.blockBothEnds },
  };
  render();
}

function leaveLocalGame() {
  state.localGame = null;
  render();
}

function restartLocalGame() {
  if (!state.localGame) return;
  const { boardSize, player1Name, player2Name, rules } = state.localGame;
  state.localGame = {
    board: Array(boardSize * boardSize).fill(""),
    boardSize,
    currentTurn: "X",
    status: "playing",
    winner: "",
    lastMove: null,
    player1Name,
    player2Name,
    rules,
  };
  render();
}

function makeLocalMove(index) {
  const g = state.localGame;
  if (!g || g.status !== "playing") return;
  if (g.board[index]) return;

  const symbol = g.currentTurn;
  g.board[index] = symbol;
  g.lastMove = index;

  if (checkWinner(g.board, index, symbol, g.boardSize, g.rules)) {
    g.status = "won";
    g.winner = symbol;
    g.currentTurn = "";
  } else if (g.board.every(Boolean)) {
    g.status = "draw";
    g.currentTurn = "";
  } else {
    g.currentTurn = symbol === "X" ? "O" : "X";
  }
  render();
}

// ---------------------------------------------------------------------------
// Gemini AI mode logic
// ---------------------------------------------------------------------------

function geminiClampBoardSize(size) {
  return Math.max(5, Math.min(50, size || DEFAULT_BOARD_SIZE));
}

function startGeminiGame() {
  const s = state.geminiSettings;
  if (!s.apiKey.trim()) {
    state.geminiGame = null;
    render();
    return;
  }
  const boardSize = s.useCustomSize
    ? geminiClampBoardSize(s.customBoardSize)
    : s.boardSize;

  state.geminiGame = {
    board: Array(boardSize * boardSize).fill(""),
    boardSize,
    currentTurn: "X",
    status: "playing",
    winner: "",
    lastMove: null,
    thinking: false,
    error: "",
    playerSymbol: "X",
    aiSymbol: "O",
    rules: { blockBothEnds: s.blockBothEnds },
  };
  render();
}

function leaveGeminiGame() {
  state.geminiGame = null;
  render();
}

function restartGeminiGame() {
  if (!state.geminiGame) return;
  const { boardSize, playerSymbol, aiSymbol, rules } = state.geminiGame;
  const newPlayerSym = aiSymbol;
  const newAISym = playerSymbol;
  state.geminiGame = {
    board: Array(boardSize * boardSize).fill(""),
    boardSize,
    currentTurn: "X",
    status: "playing",
    winner: "",
    lastMove: null,
    thinking: false,
    error: "",
    playerSymbol: newPlayerSym,
    aiSymbol: newAISym,
    rules,
  };
  render();
  if (state.geminiGame.currentTurn === state.geminiGame.aiSymbol) {
    scheduleGeminiMove();
  }
}

function applyGeminiBoardMove(index, symbol) {
  if (!state.geminiGame) return;
  const g = state.geminiGame;
  if (g.board[index]) return;

  g.board[index] = symbol;
  g.lastMove = index;
  g.thinking = false;
  g.error = "";

  if (checkWinner(g.board, index, symbol, g.boardSize, g.rules)) {
    g.status = "won";
    g.winner = symbol;
    g.currentTurn = "";
  } else if (g.board.every(Boolean)) {
    g.status = "draw";
    g.currentTurn = "";
  } else {
    g.currentTurn = symbol === "X" ? "O" : "X";
  }
  render();
}

function scheduleGeminiMove() {
  if (!state.geminiGame || state.geminiGame.status !== "playing") return;
  state.geminiGame.thinking = true;
  state.geminiGame.error = "";
  render();

  const g = state.geminiGame;
  const { board, boardSize, aiSymbol, playerSymbol, rules } = g;

  getGeminiMove([...board], boardSize, aiSymbol, playerSymbol, state.geminiSettings.apiKey, rules)
    .then((idx) => {
      if (!state.geminiGame || state.geminiGame.status !== "playing") return;
      applyGeminiBoardMove(idx, state.geminiGame.aiSymbol);
    })
    .catch((err) => {
      if (!state.geminiGame) return;
      state.geminiGame.error = `Gemini API thất bại: ${err.message}`;
      state.geminiGame.thinking = false;
      render();
    });
}

function makeGeminiMoveLocal(index) {
  const g = state.geminiGame;
  if (!g || g.status !== "playing" || g.thinking) return;
  if (g.currentTurn !== g.playerSymbol) return;
  if (g.board[index]) return;

  applyGeminiBoardMove(index, g.playerSymbol);

  if (state.geminiGame && state.geminiGame.status === "playing") {
    scheduleGeminiMove();
  }
}

// ---------------------------------------------------------------------------
// Online-mode game status helpers
// ---------------------------------------------------------------------------

function gameStatusText() {
  if (!state.roomData) {
    return "Tạo phòng mới hoặc nhập mã để vào phòng cùng bạn bè.";
  }

  if (state.roomData.status === "waiting") {
    return "Đang chờ người chơi thứ hai vào phòng.";
  }

  if (state.roomData.status === "won") {
    return `Người thắng: ${state.roomData.winner}`;
  }

  if (state.roomData.status === "draw") {
    return "Ván cờ hòa.";
  }

  return `Đến lượt: ${state.roomData.currentTurn}`;
}

function boardDisabled(index) {
  return (
    !state.roomData ||
    state.roomData.status !== "playing" ||
    state.roomData.currentTurn !== state.playerSymbol ||
    !state.playerSymbol ||
    state.isViewer ||
    Boolean(state.roomData.board?.[index])
  );
}

function roomBoardSize() {
  return state.roomData?.boardSize || DEFAULT_BOARD_SIZE;
}

function roomRules() {
  return state.roomData?.rules || {};
}

// ---------------------------------------------------------------------------
// Render helpers – shared board widget
// ---------------------------------------------------------------------------

function renderBoardHtml(board, boardSize, lastMove, isCellDisabled) {
  return `
    <div class="board" role="grid" aria-label="Bàn cờ caro"
      style="grid-template-columns: repeat(${boardSize}, minmax(0, 1fr))">
      ${board
        .map(
          (cell, index) => `
            <button
              class="cell ${cell ? `mark-${cell.toLowerCase()}` : ""} ${index === lastMove ? "last-move" : ""}"
              data-index="${index}"
              ${isCellDisabled(index, cell) ? "disabled" : ""}
              aria-label="Ô ${index + 1}"
            >${cell || ""}</button>
          `,
        )
        .join("")}
    </div>`;
}

function renderWinOverlay(status, winner, winnerName) {
  if (status !== "won" && status !== "draw") return "";
  const isWon = status === "won";
  const escapedWinner = winner ? escapeHtml(winner) : "";
  const escapedName = winnerName ? escapeHtml(winnerName) : "";
  return `
    <div class="win-overlay">
      <div class="win-card">
        <div class="win-emoji">${isWon ? "🎉" : "🤝"}</div>
        <h2>${isWon ? "Chúc mừng!" : "Hòa!"}</h2>
        <p>${isWon ? `<strong>${escapedName}</strong> (${escapedWinner}) đã thắng!` : "Ván cờ kết thúc hòa."}</p>
        <button id="overlay-restart-btn">Chơi lại</button>
      </div>
    </div>`;
}

function renderStatsBar() {
  return `
    <div class="stats-bar">
      <span>🌐 ${state.stats.onlineCount} đang trực tuyến</span>
      <span>👁️ ${state.stats.visitCount.toLocaleString("vi-VN")} lượt truy cập</span>
    </div>`;
}

function renderSizeOptions(settingsKey) {
  const s = state[settingsKey];
  return `
    <div class="card settings">
      <p class="settings-title"><strong>Kích thước bàn cờ</strong></p>
      <label class="settings-label">
        <div class="size-options">
          ${BOARD_SIZE_PRESETS.map(
            (size) => `
            <label class="size-option">
              <input type="radio" name="boardSizePreset" value="${size}"
                ${s.useCustomSize ? "" : s.boardSize === size ? "checked" : ""} />
              ${size}x${size}
            </label>`,
          ).join("")}
          <label class="size-option">
            <input type="radio" name="boardSizePreset" value="custom"
              ${s.useCustomSize ? "checked" : ""} />
            Tùy chỉnh
          </label>
        </div>
      </label>
      ${
        s.useCustomSize
          ? `<label class="settings-label">
              Số ô (5–50)
              <input id="custom-size-input" type="number" min="5" max="50" value="${s.customBoardSize}" />
            </label>`
          : ""
      }
      <label class="settings-label checkbox-label">
        <input type="checkbox" id="block-both-ends" ${s.blockBothEnds ? "checked" : ""} />
        Bị chặn 2 đầu không thắng
      </label>
    </div>`;
}

// ---------------------------------------------------------------------------
// AI mode render
// ---------------------------------------------------------------------------

function renderAIMode() {
  const g = state.aiGame;

  // Left panel
  const modeTabs = `
    <div class="mode-tabs">
      <button class="mode-tab" id="tab-online">🌐 Online</button>
      <button class="mode-tab mode-tab--active" id="tab-ai">🤖 vs AI</button>
      <button class="mode-tab" id="tab-local">👥 2 Người</button>
      <button class="mode-tab" id="tab-gemini">🧠 Gemini</button>
    </div>`;

  let leftPanel;

  if (!g) {
    // Settings screen
    const diffHtml = [1, 2, 3, 4, 5]
      .map(
        (d) => `
        <button class="diff-btn ${state.aiSettings.difficulty === d ? "diff-btn--active" : ""}"
          data-diff="${d}" title="${AI_DIFFICULTY_LABELS[d]}">
          Cấp ${d}
        </button>`,
      )
      .join("");

    leftPanel = `
      ${modeTabs}
      <p class="subtitle">Chơi cờ caro một mình – thử sức với AI ở nhiều cấp độ.</p>

      <div class="card settings">
        <p class="settings-title"><strong>Cấp độ AI</strong></p>
        <div class="diff-options">${diffHtml}</div>
        <p class="diff-label">${escapeHtml(AI_DIFFICULTY_LABELS[state.aiSettings.difficulty])}</p>
      </div>

      ${renderSizeOptions("aiSettings")}

      <button id="ai-start-btn" class="start-btn">Bắt đầu chơi</button>`;
  } else {
    // Active game info
    const aiStatusText = g.thinking
      ? "AI đang suy nghĩ…"
      : g.status === "won"
        ? `${g.winner === g.playerSymbol ? "Bạn thắng 🎉" : "AI thắng 🤖"}`
        : g.status === "draw"
          ? "Ván cờ hòa 🤝"
          : `Đến lượt: ${g.currentTurn === g.playerSymbol ? "Bạn (" + g.playerSymbol + ")" : "AI (" + g.aiSymbol + ")"}`;

    leftPanel = `
      ${modeTabs}
      <div class="card info">
        <p><strong>Cấp độ:</strong> Cấp ${g.difficulty} – ${escapeHtml(AI_DIFFICULTY_LABELS[g.difficulty])}</p>
        <p><strong>Bạn:</strong> ${g.playerSymbol} &nbsp;|&nbsp; <strong>AI:</strong> ${g.aiSymbol}</p>
        <p><strong>Bàn cờ:</strong> ${g.boardSize}x${g.boardSize}</p>
        <p><strong>Luật:</strong> ${g.rules.blockBothEnds ? "Bị chặn 2 đầu không thắng" : "Chỉ cần 5 là thắng"}</p>
        <p><strong>Trạng thái:</strong> ${aiStatusText}</p>
      </div>
      <div class="actions">
        <button id="ai-restart-btn" ${g ? "" : "disabled"}>Chơi lại</button>
        <button id="ai-leave-btn" class="ghost">Kết thúc</button>
      </div>`;
  }

  // Right panel – board
  let boardHtml;
  if (!g) {
    const previewSize = state.aiSettings.useCustomSize
      ? aiClampBoardSize(state.aiSettings.customBoardSize)
      : state.aiSettings.boardSize;
    const emptyBoard = createEmptyBoard(previewSize);
    boardHtml = renderBoardHtml(emptyBoard, previewSize, null, () => true);
  } else {
    boardHtml = renderBoardHtml(
      g.board,
      g.boardSize,
      g.lastMove,
      (idx, cell) => Boolean(cell) || g.status !== "playing" || g.currentTurn !== g.playerSymbol || g.thinking,
    );
  }

  const players = g
    ? `
      <div class="players">
        <div class="player-card ${g.currentTurn === g.playerSymbol && g.status === "playing" ? "active" : ""}">
          <span>${g.playerSymbol}</span>
          <strong>Bạn</strong>
        </div>
        <div class="player-card ${(g.currentTurn === g.aiSymbol || g.thinking) && g.status === "playing" ? "active" : ""}">
          <span>${g.aiSymbol}</span>
          <strong>AI${g.thinking ? " 🤔" : ""}</strong>
        </div>
      </div>`
    : "";

  const winOverlay = g
    ? renderWinOverlay(
        g.status,
        g.winner,
        g.winner === g.playerSymbol ? "Bạn" : "AI",
      )
    : "";

  const app = document.querySelector("#app");
  app.innerHTML = `
    <main class="layout">
      <section class="panel">
        <div class="app-header">
          <h1>Caro</h1>
          <button id="theme-toggle-btn" class="theme-toggle" title="Chuyển chế độ sáng/tối" aria-label="Chuyển chế độ sáng/tối">
            ${state.theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
        ${leftPanel}
        ${renderStatsBar()}
      </section>

      <section class="board-panel">
        ${players}
        ${boardHtml}
        ${winOverlay}
      </section>
    </main>
  `;

  document.querySelector("#theme-toggle-btn").addEventListener("click", toggleTheme);
  document.querySelector("#tab-online").addEventListener("click", () => {
    state.aiGame = null;
    state.mode = "online";
    render();
  });
  document.querySelector("#tab-local").addEventListener("click", () => {
    state.aiGame = null;
    state.mode = "local";
    render();
  });
  document.querySelector("#tab-gemini").addEventListener("click", () => {
    state.aiGame = null;
    state.mode = "gemini";
    render();
  });

  // Difficulty buttons (settings screen only)
  document.querySelectorAll(".diff-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.aiSettings.difficulty = Number(btn.dataset.diff);
      render();
    });
  });

  // Board size options (settings screen only)
  document.querySelectorAll("input[name='boardSizePreset']").forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.value === "custom") {
        state.aiSettings.useCustomSize = true;
      } else {
        state.aiSettings.useCustomSize = false;
        state.aiSettings.boardSize = Number(radio.value);
      }
      render();
    });
  });

  document.querySelector("#custom-size-input")?.addEventListener("change", (event) => {
    const val = parseInt(event.target.value, 10);
    if (!isNaN(val)) {
      state.aiSettings.customBoardSize = aiClampBoardSize(val);
      render();
    }
  });

  document.querySelector("#block-both-ends")?.addEventListener("change", (event) => {
    state.aiSettings.blockBothEnds = event.target.checked;
  });

  document.querySelector("#ai-start-btn")?.addEventListener("click", startAIGame);
  document.querySelector("#ai-restart-btn")?.addEventListener("click", restartAIGame);
  document.querySelector("#overlay-restart-btn")?.addEventListener("click", restartAIGame);
  document.querySelector("#ai-leave-btn")?.addEventListener("click", leaveAIGame);

  document.querySelectorAll(".cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      makeAIMoveLocal(Number(cell.dataset.index));
    });
  });
}

// ---------------------------------------------------------------------------
// Local (2-player offline) mode render
// ---------------------------------------------------------------------------

function renderLocalMode() {
  const g = state.localGame;
  const s = state.localSettings;

  const modeTabs = `
    <div class="mode-tabs">
      <button class="mode-tab" id="tab-online">🌐 Online</button>
      <button class="mode-tab" id="tab-ai">🤖 vs AI</button>
      <button class="mode-tab mode-tab--active" id="tab-local">👥 2 Người</button>
      <button class="mode-tab" id="tab-gemini">🧠 Gemini</button>
    </div>`;

  let leftPanel;

  if (!g) {
    // Settings screen
    leftPanel = `
      ${modeTabs}
      <p class="subtitle">Chơi cờ caro 2 người trên cùng một thiết bị.</p>

      <div class="card settings">
        <p class="settings-title"><strong>Tên người chơi</strong></p>
        <label class="settings-label">
          Người chơi X
          <input id="local-p1-name" type="text" maxlength="30"
            value="${escapeHtml(s.player1Name)}" placeholder="Người chơi 1" />
        </label>
        <label class="settings-label">
          Người chơi O
          <input id="local-p2-name" type="text" maxlength="30"
            value="${escapeHtml(s.player2Name)}" placeholder="Người chơi 2" />
        </label>
      </div>

      ${renderSizeOptions("localSettings")}

      <button id="local-start-btn" class="start-btn">Bắt đầu chơi</button>`;
  } else {
    const statusText = g.status === "won"
      ? `${escapeHtml(g.winner === "X" ? g.player1Name : g.player2Name)} thắng!`
      : g.status === "draw"
        ? "Ván cờ hòa 🤝"
        : `Đến lượt: ${g.currentTurn === "X"
            ? `${escapeHtml(g.player1Name)} (X)`
            : `${escapeHtml(g.player2Name)} (O)`}`;

    leftPanel = `
      ${modeTabs}
      <div class="card info">
        <p><strong>Người chơi X:</strong> ${escapeHtml(g.player1Name)}</p>
        <p><strong>Người chơi O:</strong> ${escapeHtml(g.player2Name)}</p>
        <p><strong>Bàn cờ:</strong> ${g.boardSize}x${g.boardSize}</p>
        <p><strong>Luật:</strong> ${g.rules.blockBothEnds ? "Bị chặn 2 đầu không thắng" : "Chỉ cần 5 là thắng"}</p>
        <p><strong>Trạng thái:</strong> ${statusText}</p>
      </div>
      <div class="actions">
        <button id="local-restart-btn">Chơi lại</button>
        <button id="local-leave-btn" class="ghost">Kết thúc</button>
      </div>`;
  }

  // Right panel – board
  let boardHtml;
  if (!g) {
    const previewSize = s.useCustomSize
      ? clampBoardSize(s.customBoardSize)
      : s.boardSize;
    const emptyBoard = createEmptyBoard(previewSize);
    boardHtml = renderBoardHtml(emptyBoard, previewSize, null, () => true);
  } else {
    boardHtml = renderBoardHtml(
      g.board,
      g.boardSize,
      g.lastMove,
      (idx, cell) => Boolean(cell) || g.status !== "playing",
    );
  }

  const players = g
    ? `
      <div class="players">
        <div class="player-card ${g.currentTurn === "X" && g.status === "playing" ? "active" : ""}">
          <span>X</span>
          <strong>${escapeHtml(g.player1Name)}</strong>
        </div>
        <div class="player-card ${g.currentTurn === "O" && g.status === "playing" ? "active" : ""}">
          <span>O</span>
          <strong>${escapeHtml(g.player2Name)}</strong>
        </div>
      </div>`
    : "";

  const winOverlay = g
    ? renderWinOverlay(
        g.status,
        g.winner,
        g.winner === "X" ? g.player1Name : g.winner === "O" ? g.player2Name : "",
      )
    : "";

  const app = document.querySelector("#app");
  app.innerHTML = `
    <main class="layout">
      <section class="panel">
        <div class="app-header">
          <h1>Caro</h1>
          <button id="theme-toggle-btn" class="theme-toggle" title="Chuyển chế độ sáng/tối" aria-label="Chuyển chế độ sáng/tối">
            ${state.theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
        ${leftPanel}
        ${renderStatsBar()}
      </section>

      <section class="board-panel">
        ${players}
        ${boardHtml}
        ${winOverlay}
      </section>
    </main>
  `;

  document.querySelector("#theme-toggle-btn").addEventListener("click", toggleTheme);
  document.querySelector("#tab-online").addEventListener("click", () => {
    state.localGame = null;
    state.mode = "online";
    render();
  });
  document.querySelector("#tab-ai").addEventListener("click", () => {
    state.localGame = null;
    state.mode = "ai";
    render();
  });
  document.querySelector("#tab-gemini").addEventListener("click", () => {
    state.localGame = null;
    state.mode = "gemini";
    render();
  });

  // Settings screen listeners
  document.querySelector("#local-p1-name")?.addEventListener("input", (e) => {
    state.localSettings.player1Name = e.target.value;
  });
  document.querySelector("#local-p2-name")?.addEventListener("input", (e) => {
    state.localSettings.player2Name = e.target.value;
  });

  document.querySelectorAll("input[name='boardSizePreset']").forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.value === "custom") {
        state.localSettings.useCustomSize = true;
      } else {
        state.localSettings.useCustomSize = false;
        state.localSettings.boardSize = Number(radio.value);
      }
      render();
    });
  });

  document.querySelector("#custom-size-input")?.addEventListener("change", (event) => {
    const val = parseInt(event.target.value, 10);
    if (!isNaN(val)) {
      state.localSettings.customBoardSize = clampBoardSize(val);
      render();
    }
  });

  document.querySelector("#block-both-ends")?.addEventListener("change", (event) => {
    state.localSettings.blockBothEnds = event.target.checked;
  });

  document.querySelector("#local-start-btn")?.addEventListener("click", startLocalGame);
  document.querySelector("#local-restart-btn")?.addEventListener("click", restartLocalGame);
  document.querySelector("#overlay-restart-btn")?.addEventListener("click", restartLocalGame);
  document.querySelector("#local-leave-btn")?.addEventListener("click", leaveLocalGame);

  document.querySelectorAll(".cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      makeLocalMove(Number(cell.dataset.index));
    });
  });
}

// ---------------------------------------------------------------------------
// Gemini AI mode render
// ---------------------------------------------------------------------------

function renderGeminiMode() {
  const g = state.geminiGame;
  const s = state.geminiSettings;

  const modeTabs = `
    <div class="mode-tabs">
      <button class="mode-tab" id="tab-online">🌐 Online</button>
      <button class="mode-tab" id="tab-ai">🤖 vs AI</button>
      <button class="mode-tab" id="tab-local">👥 2 Người</button>
      <button class="mode-tab mode-tab--active" id="tab-gemini">🧠 Gemini</button>
    </div>`;

  let leftPanel;

  if (!g) {
    // Settings screen
    const apiKeyMissing = !s.apiKey.trim();
    leftPanel = `
      ${modeTabs}
      <p class="subtitle">Chơi cờ caro đối đầu với trí tuệ nhân tạo Gemini của Google.</p>

      <div class="card settings">
        <p class="settings-title"><strong>Google Gemini API Key</strong></p>
        <label class="settings-label">
          API Key
          <input id="gemini-api-key" type="password" maxlength="200"
            placeholder="AIza…"
            value="${escapeHtml(s.apiKey)}" />
        </label>
        <p class="settings-hint">
          Lấy API key miễn phí tại
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>.
          Key được lưu trên trình duyệt của bạn.
        </p>
        ${apiKeyMissing ? `<p class="error">Vui lòng nhập API key để bắt đầu.</p>` : ""}
      </div>

      ${renderSizeOptions("geminiSettings")}

      <button id="gemini-start-btn" class="start-btn" ${apiKeyMissing ? "disabled" : ""}>Bắt đầu chơi</button>`;
  } else {
    const geminiStatusText = g.thinking
      ? "Gemini đang suy nghĩ…"
      : g.status === "won"
        ? `${g.winner === g.playerSymbol ? "Bạn thắng 🎉" : "Gemini thắng 🧠"}`
        : g.status === "draw"
          ? "Ván cờ hòa 🤝"
          : `Đến lượt: ${g.currentTurn === g.playerSymbol ? "Bạn (" + g.playerSymbol + ")" : "Gemini (" + g.aiSymbol + ")"}`;

    leftPanel = `
      ${modeTabs}
      <div class="card info">
        <p><strong>Bạn:</strong> ${g.playerSymbol} &nbsp;|&nbsp; <strong>Gemini:</strong> ${g.aiSymbol}</p>
        <p><strong>Bàn cờ:</strong> ${g.boardSize}x${g.boardSize}</p>
        <p><strong>Luật:</strong> ${g.rules.blockBothEnds ? "Bị chặn 2 đầu không thắng" : "Chỉ cần 5 là thắng"}</p>
        <p><strong>Trạng thái:</strong> ${geminiStatusText}</p>
        ${g.error ? `<p class="error">${escapeHtml(g.error)}</p>` : ""}
      </div>
      <div class="actions">
        <button id="gemini-restart-btn">Chơi lại</button>
        <button id="gemini-leave-btn" class="ghost">Kết thúc</button>
      </div>`;
  }

  // Right panel – board
  let boardHtml;
  if (!g) {
    const previewSize = s.useCustomSize
      ? geminiClampBoardSize(s.customBoardSize)
      : s.boardSize;
    const emptyBoard = createEmptyBoard(previewSize);
    boardHtml = renderBoardHtml(emptyBoard, previewSize, null, () => true);
  } else {
    boardHtml = renderBoardHtml(
      g.board,
      g.boardSize,
      g.lastMove,
      (idx, cell) => Boolean(cell) || g.status !== "playing" || g.currentTurn !== g.playerSymbol || g.thinking,
    );
  }

  const players = g
    ? `
      <div class="players">
        <div class="player-card ${g.currentTurn === g.playerSymbol && g.status === "playing" ? "active" : ""}">
          <span>${g.playerSymbol}</span>
          <strong>Bạn</strong>
        </div>
        <div class="player-card ${(g.currentTurn === g.aiSymbol || g.thinking) && g.status === "playing" ? "active" : ""}">
          <span>${g.aiSymbol}</span>
          <strong>Gemini${g.thinking ? " 🤔" : ""}</strong>
        </div>
      </div>`
    : "";

  const winOverlay = g
    ? renderWinOverlay(
        g.status,
        g.winner,
        g.winner === g.playerSymbol ? "Bạn" : "Gemini",
      )
    : "";

  const app = document.querySelector("#app");
  app.innerHTML = `
    <main class="layout">
      <section class="panel">
        <div class="app-header">
          <h1>Caro</h1>
          <button id="theme-toggle-btn" class="theme-toggle" title="Chuyển chế độ sáng/tối" aria-label="Chuyển chế độ sáng/tối">
            ${state.theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
        ${leftPanel}
        ${renderStatsBar()}
      </section>

      <section class="board-panel">
        ${players}
        ${boardHtml}
        ${winOverlay}
      </section>
    </main>
  `;

  document.querySelector("#theme-toggle-btn").addEventListener("click", toggleTheme);
  document.querySelector("#tab-online").addEventListener("click", () => {
    state.geminiGame = null;
    state.mode = "online";
    render();
  });
  document.querySelector("#tab-ai").addEventListener("click", () => {
    state.geminiGame = null;
    state.mode = "ai";
    render();
  });
  document.querySelector("#tab-local").addEventListener("click", () => {
    state.geminiGame = null;
    state.mode = "local";
    render();
  });

  // Settings screen listeners
  document.querySelector("#gemini-api-key")?.addEventListener("input", (e) => {
    state.geminiSettings.apiKey = e.target.value;
    localStorage.setItem(GEMINI_KEY, e.target.value);
    // Enable/disable start button live
    const startBtn = document.querySelector("#gemini-start-btn");
    if (startBtn) startBtn.disabled = !e.target.value.trim();
  });

  document.querySelectorAll("input[name='boardSizePreset']").forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.value === "custom") {
        state.geminiSettings.useCustomSize = true;
      } else {
        state.geminiSettings.useCustomSize = false;
        state.geminiSettings.boardSize = Number(radio.value);
      }
      render();
    });
  });

  document.querySelector("#custom-size-input")?.addEventListener("change", (event) => {
    const val = parseInt(event.target.value, 10);
    if (!isNaN(val)) {
      state.geminiSettings.customBoardSize = geminiClampBoardSize(val);
      render();
    }
  });

  document.querySelector("#block-both-ends")?.addEventListener("change", (event) => {
    state.geminiSettings.blockBothEnds = event.target.checked;
  });

  document.querySelector("#gemini-start-btn")?.addEventListener("click", startGeminiGame);
  document.querySelector("#gemini-restart-btn")?.addEventListener("click", restartGeminiGame);
  document.querySelector("#overlay-restart-btn")?.addEventListener("click", restartGeminiGame);
  document.querySelector("#gemini-leave-btn")?.addEventListener("click", leaveGeminiGame);

  document.querySelectorAll(".cell").forEach((cell) => {
    cell.addEventListener("click", () => {
      makeGeminiMoveLocal(Number(cell.dataset.index));
    });
  });
}

// ---------------------------------------------------------------------------
// Online mode render
// ---------------------------------------------------------------------------

function render() {
  if (state.mode === "ai") {
    renderAIMode();
    return;
  }

  if (state.mode === "local") {
    renderLocalMode();
    return;
  }

  if (state.mode === "gemini") {
    renderGeminiMode();
    return;
  }

  const boardSize = roomBoardSize();
  const board = state.roomData?.board || createEmptyBoard(boardSize);
  const isInRoom = Boolean(state.roomId);
  const currentRules = roomRules();
  const blockBothEndsLabel = currentRules.blockBothEnds
    ? "Bị chặn 2 đầu không thắng"
    : "Chỉ cần 5 là thắng";

  const settingsHtml = !isInRoom
    ? `
        <div class="card settings">
          <p class="settings-title"><strong>Cài đặt phòng mới</strong></p>
          <label class="settings-label">
            Kích thước bàn cờ
            <div class="size-options">
              ${BOARD_SIZE_PRESETS.map(
                (size) => `
                <label class="size-option">
                  <input type="radio" name="boardSizePreset" value="${size}"
                    ${state.settings.useCustomSize ? "" : state.settings.boardSize === size ? "checked" : ""} />
                  ${size}x${size}
                </label>`,
              ).join("")}
              <label class="size-option">
                <input type="radio" name="boardSizePreset" value="custom"
                  ${state.settings.useCustomSize ? "checked" : ""} />
                Tùy chỉnh
              </label>
            </div>
          </label>
          ${
            state.settings.useCustomSize
              ? `<label class="settings-label">
                  Số ô (5–50)
                  <input id="custom-size-input" type="number" min="5" max="50" value="${state.settings.customBoardSize}" />
                </label>`
              : ""
          }
          <label class="settings-label checkbox-label">
            <input type="checkbox" id="block-both-ends" ${state.settings.blockBothEnds ? "checked" : ""} />
            Bị chặn 2 đầu không thắng
          </label>
        </div>
      `
    : "";

  const modeTabs = `
    <div class="mode-tabs">
      <button class="mode-tab mode-tab--active" id="tab-online">🌐 Online</button>
      <button class="mode-tab" id="tab-ai">🤖 vs AI</button>
      <button class="mode-tab" id="tab-local">👥 2 Người</button>
      <button class="mode-tab" id="tab-gemini">🧠 Gemini</button>
    </div>`;

  const app = document.querySelector("#app");
  app.innerHTML = `
    <main class="layout">
      <section class="panel">
        <div class="app-header">
          <h1>Caro</h1>
          <button id="theme-toggle-btn" class="theme-toggle" title="Chuyển chế độ sáng/tối" aria-label="Chuyển chế độ sáng/tối">
            ${state.theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
        ${modeTabs}
        <p class="subtitle">Tạo phòng, gửi mã cho bạn bè và chơi cờ caro trực tuyến theo thời gian thực.</p>

        <form id="room-form" class="card form">
          <label for="player-name">
            Tên của bạn
            <input id="player-name" name="playerName" maxlength="30" placeholder="Ví dụ: Tiny Spirits" value="${escapeHtml(state.playerName)}" />
          </label>
          <label for="room-id">
            Mã phòng
            <input id="room-id" name="roomId" maxlength="10" placeholder="Để trống để tạo phòng mới" value="${escapeHtml(state.roomId)}" />
          </label>
          <button type="submit">Tạo / vào phòng</button>
        </form>

        ${settingsHtml}

        <div class="card info">
          <p><strong>Phòng:</strong> ${state.roomId || "Chưa tham gia"}</p>
          <p><strong>Vai trò:</strong> ${state.isViewer ? "Người xem" : state.playerSymbol || "Khách"}</p>
          ${isInRoom ? `<p><strong>Bàn cờ:</strong> ${boardSize}x${boardSize}</p>` : ""}
          ${isInRoom ? `<p><strong>Luật:</strong> ${escapeHtml(blockBothEndsLabel)}</p>` : ""}
          <p><strong>Trạng thái:</strong> ${gameStatusText()}</p>
          ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
        </div>

        <div class="actions">
          <button id="restart-btn" ${state.roomId && !state.isViewer ? "" : "disabled"}>Chơi lại</button>
          <button id="leave-btn" class="ghost" ${state.roomId ? "" : "disabled"}>Rời phòng</button>
        </div>
        ${renderStatsBar()}
      </section>

      <section class="board-panel">
        <div class="players">
          <div class="player-card ${state.playerSymbol === "X" ? "active" : ""}">
            <span>X</span>
            <strong>${escapeHtml(state.roomData?.players?.X?.name || "Đang chờ")}</strong>
          </div>
          <div class="player-card ${state.playerSymbol === "O" ? "active" : ""}">
            <span>O</span>
            <strong>${escapeHtml(state.roomData?.players?.O?.name || "Đang chờ")}</strong>
          </div>
        </div>

        ${renderBoardHtml(board, boardSize, state.roomData?.lastMove, boardDisabled)}

        ${(() => {
          const status = state.roomData?.status;
          const winnerSymbol = state.roomData?.winner;
          const winnerName = winnerSymbol
            ? state.roomData?.players?.[winnerSymbol]?.name || winnerSymbol
            : "";
          return renderWinOverlay(status, winnerSymbol, winnerName);
        })()}
      </section>
    </main>
  `;

  document.querySelector("#theme-toggle-btn").addEventListener("click", toggleTheme);
  document.querySelector("#tab-online").addEventListener("click", () => {
    state.mode = "online";
    render();
  });
  document.querySelector("#tab-ai").addEventListener("click", () => {
    state.mode = "ai";
    render();
  });
  document.querySelector("#tab-local").addEventListener("click", () => {
    state.mode = "local";
    render();
  });
  document.querySelector("#tab-gemini").addEventListener("click", () => {
    state.mode = "gemini";
    render();
  });

  document.querySelector("#room-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await joinRoom({
      playerName: String(form.get("playerName") || ""),
      roomId: String(form.get("roomId") || ""),
    });
  });

  document.querySelectorAll("input[name='boardSizePreset']").forEach((radio) => {
    radio.addEventListener("change", () => {
      if (radio.value === "custom") {
        state.settings.useCustomSize = true;
      } else {
        state.settings.useCustomSize = false;
        state.settings.boardSize = Number(radio.value);
      }
      render();
    });
  });

  document.querySelector("#custom-size-input")?.addEventListener("change", (event) => {
    const val = parseInt(event.target.value, 10);
    if (!isNaN(val)) {
      state.settings.customBoardSize = clampBoardSize(val);
      render();
    }
  });

  document.querySelector("#block-both-ends")?.addEventListener("change", (event) => {
    state.settings.blockBothEnds = event.target.checked;
  });

  document.querySelector("#restart-btn")?.addEventListener("click", restartGame);
  document.querySelector("#overlay-restart-btn")?.addEventListener("click", restartGame);
  document.querySelector("#leave-btn")?.addEventListener("click", leaveRoom);
  document.querySelectorAll(".cell").forEach((cell) => {
    cell.addEventListener("click", async () => {
      await makeMove(Number(cell.dataset.index));
    });
  });
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

render();
trackVisit();
initPresence();
subscribeStats();
