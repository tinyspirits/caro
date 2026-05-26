import { onValue, ref, runTransaction } from "firebase/database";
import { database } from "./firebase";
import "./style.css";

const WIN_LENGTH = 5;
const STORAGE_KEY = "caro-online-player";
const THEME_KEY = "caro-theme";
const BOARD_SIZE_PRESETS = [15, 30];
const DEFAULT_BOARD_SIZE = 15;

const savedPlayer = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");

// Theme initialisation – apply before first render to avoid flash
const savedTheme = localStorage.getItem(THEME_KEY) || "dark";
document.documentElement.setAttribute("data-theme", savedTheme);

const state = {
  playerId: savedPlayer.id || crypto.randomUUID(),
  playerName: savedPlayer.name || "",
  roomId: "",
  playerSymbol: "",
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
      if (rules?.blockBothEnds) {
        const fwdEndRow = row + (fwd + 1) * dr;
        const fwdEndCol = col + (fwd + 1) * dc;
        const bwdEndRow = row - (bwd + 1) * dr;
        const bwdEndCol = col - (bwd + 1) * dc;
        const fwdBlocked = isEndBlocked(board, fwdEndRow, fwdEndCol, boardSize);
        const bwdBlocked = isEndBlocked(board, bwdEndRow, bwdEndCol, boardSize);
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

function isEndBlocked(board, row, col, boardSize) {
  if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) return true;
  return Boolean(board[row * boardSize + col]);
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
      state.error = "Phòng đã đủ 2 người chơi. Hãy dùng mã phòng khác.";
      render();
      return;
    }

    subscribeToRoom(normalizedRoomId);
    state.roomId = normalizedRoomId;
    state.playerSymbol = playerSymbol;
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
  if (!state.roomId || !state.playerSymbol) {
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
    Boolean(state.roomData.board?.[index])
  );
}

function roomBoardSize() {
  return state.roomData?.boardSize || DEFAULT_BOARD_SIZE;
}

function roomRules() {
  return state.roomData?.rules || {};
}

function render() {
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

  const app = document.querySelector("#app");
  app.innerHTML = `
    <main class="layout">
      <section class="panel">
        <div class="app-header">
          <h1>Caro Online</h1>
          <button id="theme-toggle-btn" class="theme-toggle" title="Chuyển chế độ sáng/tối" aria-label="Chuyển chế độ sáng/tối">
            ${state.theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
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
          <p><strong>Vai trò:</strong> ${state.playerSymbol || "Khách"}</p>
          ${isInRoom ? `<p><strong>Bàn cờ:</strong> ${boardSize}x${boardSize}</p>` : ""}
          ${isInRoom ? `<p><strong>Luật:</strong> ${escapeHtml(blockBothEndsLabel)}</p>` : ""}
          <p><strong>Trạng thái:</strong> ${gameStatusText()}</p>
          ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
        </div>

        <div class="actions">
          <button id="restart-btn" ${state.roomId ? "" : "disabled"}>Chơi lại</button>
          <button id="leave-btn" class="ghost" ${state.roomId ? "" : "disabled"}>Rời phòng</button>
        </div>
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

        <div class="board" role="grid" aria-label="Bàn cờ caro"
          style="grid-template-columns: repeat(${boardSize}, minmax(0, 1fr))">
          ${board
            .map(
              (cell, index) => `
                <button
                  class="cell ${cell ? `mark-${cell.toLowerCase()}` : ""} ${index === state.roomData?.lastMove ? "last-move" : ""}"
                  data-index="${index}"
                  ${boardDisabled(index) ? "disabled" : ""}
                  aria-label="Ô ${index + 1}"
                >${cell || ""}</button>
              `,
            )
            .join("")}
        </div>

        ${(() => {
          const status = state.roomData?.status;
          if (status !== "won" && status !== "draw") return "";
          const winnerSymbol = state.roomData?.winner;
          const escapedWinnerSymbol = winnerSymbol ? escapeHtml(winnerSymbol) : "";
          const winnerName = winnerSymbol
            ? escapeHtml(state.roomData?.players?.[winnerSymbol]?.name || winnerSymbol)
            : "";
          const isWon = status === "won";
          return `
          <div class="win-overlay">
            <div class="win-card">
              <div class="win-emoji">${isWon ? "🎉" : "🤝"}</div>
              <h2>${isWon ? "Chúc mừng!" : "Hòa!"}</h2>
              <p>${isWon ? `<strong>${winnerName}</strong> (${escapedWinnerSymbol}) đã thắng!` : "Ván cờ kết thúc hòa."}</p>
              <button id="overlay-restart-btn">Chơi lại</button>
            </div>
          </div>`;
        })()}
      </section>
    </main>
  `;

  document.querySelector("#theme-toggle-btn").addEventListener("click", toggleTheme);

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
