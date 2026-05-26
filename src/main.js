import { onValue, ref, runTransaction } from "firebase/database";
import { database } from "./firebase";
import "./style.css";

const BOARD_SIZE = 15;
const WIN_LENGTH = 5;
const STORAGE_KEY = "caro-online-player";

const savedPlayer = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");

const state = {
  playerId: savedPlayer.id || crypto.randomUUID(),
  playerName: savedPlayer.name || "",
  roomId: "",
  playerSymbol: "",
  roomData: null,
  unsubscribeRoom: null,
  error: "",
};

localStorage.setItem(
  STORAGE_KEY,
  JSON.stringify({ id: state.playerId, name: state.playerName }),
);

function createEmptyBoard() {
  return Array(BOARD_SIZE * BOARD_SIZE).fill("");
}

function createRoomData(name) {
  return {
    board: createEmptyBoard(),
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

function checkWinner(board, index, symbol) {
  const row = Math.floor(index / BOARD_SIZE);
  const col = index % BOARD_SIZE;
  const directions = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  for (const [dr, dc] of directions) {
    let count = 1;
    count += countDirection(board, row, col, dr, dc, symbol);
    count += countDirection(board, row, col, -dr, -dc, symbol);

    if (count >= WIN_LENGTH) {
      return true;
    }
  }

  return false;
}

function countDirection(board, row, col, dr, dc, symbol) {
  let count = 0;
  let nextRow = row + dr;
  let nextCol = col + dc;

  while (
    nextRow >= 0 &&
    nextRow < BOARD_SIZE &&
    nextCol >= 0 &&
    nextCol < BOARD_SIZE &&
    board[nextRow * BOARD_SIZE + nextCol] === symbol
  ) {
    count += 1;
    nextRow += dr;
    nextCol += dc;
  }

  return count;
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

function generateRoomId() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
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

      room.board ||= createEmptyBoard();
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
      room.board = createEmptyBoard();
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

      room.board ||= createEmptyBoard();

      if (room.board[index]) {
        return room;
      }

      room.board[index] = state.playerSymbol;

      if (checkWinner(room.board, index, state.playerSymbol)) {
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

      room.board = createEmptyBoard();
      room.winner = "";
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

function render() {
  const board = state.roomData?.board || createEmptyBoard();

  const app = document.querySelector("#app");
  app.innerHTML = `
    <main class="layout">
      <section class="panel">
        <h1>Caro Online</h1>
        <p class="subtitle">Tạo phòng, gửi mã cho bạn bè và chơi cờ caro trực tuyến theo thời gian thực.</p>

        <form id="room-form" class="card form">
          <label>
            Tên của bạn
            <input name="playerName" maxlength="30" placeholder="Ví dụ: Tiny Spirits" value="${escapeHtml(state.playerName)}" />
          </label>
          <label>
            Mã phòng
            <input name="roomId" maxlength="10" placeholder="Để trống để tạo phòng mới" value="${escapeHtml(state.roomId)}" />
          </label>
          <button type="submit">Tạo / vào phòng</button>
        </form>

        <div class="card info">
          <p><strong>Phòng:</strong> ${state.roomId || "Chưa tham gia"}</p>
          <p><strong>Vai trò:</strong> ${state.playerSymbol || "Khách"}</p>
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

        <div class="board" role="grid" aria-label="Bàn cờ caro">
          ${board
            .map(
              (cell, index) => `
                <button
                  class="cell ${cell ? `mark-${cell.toLowerCase()}` : ""}"
                  data-index="${index}"
                  ${boardDisabled(index) ? "disabled" : ""}
                  aria-label="Ô ${index + 1}"
                >${cell || ""}</button>
              `,
            )
            .join("")}
        </div>
      </section>
    </main>
  `;

  document.querySelector("#room-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await joinRoom({
      playerName: String(form.get("playerName") || ""),
      roomId: String(form.get("roomId") || ""),
    });
  });

  document.querySelector("#restart-btn")?.addEventListener("click", restartGame);
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
