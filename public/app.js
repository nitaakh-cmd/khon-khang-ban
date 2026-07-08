const app = document.querySelector("#app");
const toastEl = document.querySelector("#toast");

const state = {
  room: null,
  me: null,
  eventSource: null,
  selectedVotes: new Set(),
  routeCode: new URLSearchParams(location.search).get("room") || "",
  soundReady: false,
  lastTimerKey: "",
  lastRoundId: "",
  acknowledgedRounds: new Set(),
  acknowledgedResults: new Set()
};

const storageKey = (code) => `kkb:${code}:playerId`;
const currentCode = () => state.room?.code || state.routeCode;
const playerId = () => state.me?.playerId || localStorage.getItem(storageKey(currentCode()));

const toast = (message) => {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastEl.timer);
  toastEl.timer = setTimeout(() => {
    toastEl.hidden = true;
  }, 2600);
};

const api = async (path, body = {}) => {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "เกิดข้อผิดพลาด");
  return data;
};

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#039;"
})[char]);

const playerName = (id) => state.room?.players.find((player) => player.id === id)?.name || "ไม่ทราบชื่อ";
const isHost = () => state.me?.isHost;

const avatarMarks = ["smile", "glasses", "star", "hat", "question", "bolt", "moon", "heart", "crown", "bubble", "spark", "mask"];
const hashId = (value) => String(value || "").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
const avatarFor = (player) => avatarMarks[hashId(player?.id) % avatarMarks.length];
const avatar = (player, extra = "") => `
  <span class="avatar avatar-${avatarFor(player)} ${extra}" aria-hidden="true">
    <span class="avatar-face"></span>
    <span class="avatar-mark"></span>
  </span>
`;

const unlockSound = () => {
  if (state.soundReady) return;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0.001;
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.02);
  state.audio = ctx;
  state.soundReady = true;
};

const beep = (frequency = 720, duration = 0.09) => {
  if (!state.soundReady || !state.audio) return;
  const ctx = state.audio;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + duration + 0.01);
};

const handleTimerSound = (timer) => {
  if (!timer?.enabled) return;
  const key = `${timer.status}:${timer.countdownSecondsRemaining}:${timer.secondsRemaining}:${timer.currentPlayerId}:${timer.currentSpeechRound}`;
  if (key === state.lastTimerKey) return;
  state.lastTimerKey = key;
  if (timer.status === "countdown" && timer.countdownSecondsRemaining > 0) beep(860, 0.08);
  if (timer.status === "speaking" && timer.secondsRemaining <= 5 && timer.secondsRemaining > 0) beep(620, 0.08);
  if (timer.status === "completed") beep(320, 0.22);
};

const connectEvents = (code, id) => {
  state.eventSource?.close();
  state.eventSource = new EventSource(`/api/events?roomCode=${encodeURIComponent(code)}&playerId=${encodeURIComponent(id)}`);
  state.eventSource.addEventListener("state", (event) => {
    const data = JSON.parse(event.data);
    state.room = data.room;
    state.me = data.me;
    if (state.room.round?.id !== state.lastRoundId) {
      state.selectedVotes.clear();
      state.lastRoundId = state.room.round?.id || "";
    }
    handleTimerSound(state.room.round?.timer);
    render();
  });
  state.eventSource.onerror = () => toast("กำลังเชื่อมต่อใหม่...");
};

const joinCreatedRoom = (room, id) => {
  state.room = room;
  state.me = { playerId: id, isHost: room.hostPlayerId === id };
  state.routeCode = room.code;
  localStorage.setItem(storageKey(room.code), id);
  history.replaceState(null, "", `/?room=${room.code}`);
  connectEvents(room.code, id);
  render();
};

window.createRoom = async (event) => {
  event.preventDefault();
  unlockSound();
  const form = new FormData(event.currentTarget);
  try {
    const data = await api("/api/rooms", {
      playerName: form.get("playerName"),
      settings: {
        maxPlayers: Number(form.get("maxPlayers")),
        neighborCount: Number(form.get("neighborCount")),
        speechTimerEnabled: form.get("speechTimerEnabled") === "on",
        speechSecondsPerTurn: Number(form.get("speechSecondsPerTurn"))
      }
    });
    joinCreatedRoom(data.room, data.playerId);
  } catch (err) {
    toast(err.message);
  }
};

window.joinRoom = async (event) => {
  event.preventDefault();
  unlockSound();
  const form = new FormData(event.currentTarget);
  const code = String(form.get("roomCode") || state.routeCode).trim().toUpperCase();
  try {
    const data = await api("/api/rooms/join", {
      roomCode: code,
      playerName: form.get("playerName"),
      playerId: localStorage.getItem(storageKey(code))
    });
    joinCreatedRoom(data.room, data.playerId);
  } catch (err) {
    toast(err.message);
  }
};

window.updateSettings = async (event) => {
  event.preventDefault();
  unlockSound();
  const form = new FormData(event.currentTarget);
  try {
    await api("/api/rooms/settings", {
      roomCode: currentCode(),
      playerId: playerId(),
      settings: {
        maxPlayers: Number(form.get("maxPlayers")),
        neighborCount: Number(form.get("neighborCount")),
        speechTimerEnabled: form.get("speechTimerEnabled") === "on",
        speechSecondsPerTurn: Number(form.get("speechSecondsPerTurn"))
      }
    });
  } catch (err) {
    toast(err.message);
  }
};

window.syncSpeechSeconds = (input) => {
  const form = input.closest("form");
  if (!form) return;
  const value = Math.max(5, Math.min(30, Number(input.value) || 20));
  form.querySelectorAll("[data-speech-seconds]").forEach((control) => {
    control.value = value;
  });
  form.querySelectorAll("[data-speech-seconds-label]").forEach((label) => {
    label.textContent = `${value} วินาที`;
  });
};

window.acknowledgeRole = () => {
  if (state.room?.round?.id) state.acknowledgedRounds.add(state.room.round.id);
  render();
};

window.acknowledgeResult = () => {
  if (state.room?.round?.id) state.acknowledgedResults.add(state.room.round.id);
  render();
};

window.action = async (path) => {
  unlockSound();
  const payload = { roomCode: currentCode(), playerId: playerId() };
  console.log("[action] clicked", { path, payload });
  try {
    console.log("[action] before fetch", { path, payload });
    const result = await api(path, payload);
    console.log("[action] after fetch", { path, result });
  } catch (err) {
    console.error("[action] exception", err);
    toast(err.message);
  }
};

window.toggleVote = (id) => {
  const needed = state.room.round.voteTargetCount;
  if (state.selectedVotes.has(id)) {
    state.selectedVotes.delete(id);
  } else if (state.selectedVotes.size < needed) {
    state.selectedVotes.add(id);
  } else {
    toast(`เลือกได้ ${needed} คน`);
  }
  render();
};

window.submitVote = async () => {
  try {
    await api("/api/vote", {
      roomCode: currentCode(),
      playerId: playerId(),
      targetPlayerIds: [...state.selectedVotes]
    });
    toast("ส่งโหวตแล้ว");
  } catch (err) {
    toast(err.message);
  }
};

window.submitGuess = async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("/api/guess", {
      roomCode: currentCode(),
      playerId: playerId(),
      guessedWord: form.get("guessedWord")
    });
  } catch (err) {
    toast(err.message);
  }
};

window.copyInvite = async () => {
  const url = `${location.origin}/?room=${currentCode()}`;
  await navigator.clipboard.writeText(url);
  toast("คัดลอกลิงก์เชิญแล้ว");
};

const layout = (content, aside = "") => `
  <div class="shell game-shell">
    <header class="game-topbar">
      <div class="brand">
        <span class="brand-kicker">Party Table</span>
        <h1>คนข้างบ้าน</h1>
        <span>เกมจับพิรุธสำหรับแก๊งเพื่อน</span>
      </div>
      ${state.room ? `<span class="room-badge">ห้อง ${state.room.code}</span>` : ""}
    </header>
    ${aside ? `<section class="game-stage">${content}<aside class="side-stage">${aside}</aside></section>` : content}
  </div>
`;

const timerSetting = (value = 20) => `
  <div class="field timer-setting">
    <div class="row between">
      <span class="muted">เวลาพูดต่อคน</span>
      <strong data-speech-seconds-label>${value} วินาที</strong>
    </div>
    <div class="range-row">
      <input data-speech-seconds name="speechSecondsPerTurn" type="range" min="5" max="30" value="${value}" oninput="window.syncSpeechSeconds(this)" />
      <input data-speech-seconds type="number" min="5" max="30" value="${value}" oninput="window.syncSpeechSeconds(this)" />
    </div>
  </div>
`;

const homeView = () => layout(`
  <section class="home-hero">
    <div class="hero-copy">
      <span class="brand-kicker">Realtime Party Game</span>
      <h2>ใครกันแน่ที่เป็น<br>คนข้างบ้าน?</h2>
      <p>สร้างห้อง ส่งลิงก์ แล้วเริ่มจับพิรุธกันบนโต๊ะเกมออนไลน์</p>
    </div>
    <div class="gate-grid">
      <div class="panel gate-card">
        <h2>สร้างห้องใหม่</h2>
        <form class="form" onsubmit="createRoom(event)">
          <label>ชื่อของคุณ <input name="playerName" maxlength="24" required placeholder="เช่น นิดา" /></label>
          <div class="form-pair">
            <label>ผู้เล่นสูงสุด <input name="maxPlayers" type="number" min="3" max="20" value="20" /></label>
            <label>คนข้างบ้าน <input name="neighborCount" type="number" min="1" max="6" value="1" /></label>
          </div>
          <label class="check"><input name="speechTimerEnabled" type="checkbox" /> เปิดจับเวลาพูด วน 3 รอบ</label>
          ${timerSetting(20)}
          <button class="btn primary jumbo" type="submit">สร้างห้อง</button>
        </form>
      </div>
      <div class="panel gate-card join-card">
        <h2>เข้าห้อง</h2>
        <form class="form" onsubmit="joinRoom(event)">
          <label>ชื่อของคุณ <input name="playerName" maxlength="24" required placeholder="ชื่อที่เพื่อนเห็น" /></label>
          <label>โค้ดห้อง <input name="roomCode" maxlength="8" required value="${escapeHtml(state.routeCode)}" placeholder="เช่น A7K2P" /></label>
          <button class="btn primary jumbo" type="submit">เข้าห้อง</button>
        </form>
      </div>
    </div>
  </section>
`);

const playerList = () => `
  <div class="card compact player-board">
    <div class="row between">
      <h3>ผู้เล่น ${state.room.players.length}/${state.room.settings.maxPlayers}</h3>
      <span class="pill">${state.room.status}</span>
    </div>
    <div class="players">
      ${state.room.players.map((player) => {
        const speaking = state.room.round?.timer?.currentPlayerId === player.id;
        return `
          <div class="player ${speaking ? "speaking" : ""}">
            ${avatar(player, `${player.isHost ? "host" : ""} ${speaking ? "speaking" : ""}`)}
            <strong>${escapeHtml(player.name)}</strong>
            <span class="muted">${player.isHost ? "Host" : ""}${player.id === state.me.playerId ? " คุณ" : ""}</span>
          </div>
        `;
      }).join("")}
    </div>
  </div>
`;

const lobbyView = () => layout(`
  <div class="lobby-table">
    <section class="panel table-card">
      <div class="row between">
        <div>
          <span class="brand-kicker">Game Room</span>
          <h2>ห้อง ${state.room.code}</h2>
          <span class="muted">ชวนเพื่อนอย่างน้อย 3 คน แล้วเริ่มเกมได้เลย</span>
        </div>
        <button class="btn" onclick="copyInvite()">คัดลอกลิงก์เชิญ</button>
      </div>
      <div class="avatar-ring">
        ${state.room.players.map((player) => `
          <div class="avatar-seat">
            ${avatar(player, player.isHost ? "host" : "")}
            <strong>${escapeHtml(player.name)}</strong>
          </div>
        `).join("")}
      </div>
    </section>
    ${isHost() ? `
      <section class="panel settings-card">
        <h2>ตั้งค่าโต๊ะเกม</h2>
        <form class="form" onsubmit="updateSettings(event)">
          <div class="form-pair">
            <label>ผู้เล่นสูงสุด <input name="maxPlayers" type="number" min="3" max="20" value="${state.room.settings.maxPlayers}" /></label>
            <label>คนข้างบ้าน <input name="neighborCount" type="number" min="1" max="${Math.max(1, state.room.players.length - 1)}" value="${state.room.settings.neighborCount}" /></label>
          </div>
          <label class="check"><input name="speechTimerEnabled" type="checkbox" ${state.room.settings.speechTimerEnabled ? "checked" : ""} /> เปิดจับเวลาพูด วน 3 รอบ</label>
          ${timerSetting(state.room.settings.speechSecondsPerTurn)}
          <div class="row">
            <button class="btn" type="submit">บันทึกตั้งค่า</button>
            <button class="btn primary jumbo" type="button" onclick="window.action('/api/game/start')" ${state.room.players.length < 3 ? "disabled" : ""}>เริ่มเกม</button>
          </div>
          ${state.room.players.length < 3 ? `<span class="muted">ต้องมีผู้เล่นอย่างน้อย 3 คน ตอนนี้มี ${state.room.players.length} คน</span>` : ""}
        </form>
      </section>
    ` : `
      <section class="panel settings-card"><h2>รอ Host เริ่มเกม</h2><p class="muted">เมื่อเริ่มแล้ว ระบบจะเปิดการ์ดบทบาทของคุณทันที</p></section>
    `}
  </div>
`, `${playerList()}${rulesCard()}`);

const rulesCard = () => `
  <div class="card compact rules-card">
    <h3>กติกาย่อ</h3>
    <p class="muted">ทุกคนเห็นคำเดียวกัน ยกเว้นคนข้างบ้าน ห้ามพูดคำตรง ๆ และต้องโหวตจับคนข้างบ้านให้ครบ</p>
  </div>
`;

const roleCard = () => {
  const role = state.me.role;
  const isNeighbor = role === "neighbor";
  const icon = isNeighbor ? "?" : "!";
  return `
    <section class="panel role-card secret-card ${isNeighbor ? "neighbor" : ""}">
      <div class="role-icon">${icon}</div>
      <div>
        <div class="label">การ์ดบทบาทของฉัน</div>
        <div class="role-name">${isNeighbor ? "คนข้างบ้าน" : "ผู้เล่นทั่วไป"}</div>
        <div class="word">${isNeighbor ? "คุณคือคนข้างบ้าน" : escapeHtml(state.me.secretWord || "รอคำลับ")}</div>
        <p class="muted">${isNeighbor ? "ฟังบทสนทนาแล้วกลมกลืนให้มากที่สุด" : "ถามตอบโดยห้ามพูดคำนี้ตรง ๆ"}</p>
      </div>
    </section>
  `;
};

const roleRevealOverlay = () => {
  const roundId = state.room?.round?.id;
  if (!roundId || state.acknowledgedRounds.has(roundId)) return "";
  const isNeighbor = state.me.role === "neighbor";
  return `
    <div class="reveal-backdrop">
      <section class="reveal-card ${isNeighbor ? "neighbor" : ""}">
        <div class="reveal-flip">
          <div class="role-icon reveal-icon">${isNeighbor ? "?" : "!"}</div>
          <div class="label">เปิดบทบาท</div>
          <h2>${isNeighbor ? "คุณคือคนข้างบ้าน" : "คำลับของคุณ"}</h2>
          <div class="reveal-word">${isNeighbor ? "อย่าให้ใครจับได้" : escapeHtml(state.me.secretWord || "")}</div>
          <p class="muted">${isNeighbor ? "ฟังคำถามและเดาคำจากบทสนทนา" : "จำคำนี้ไว้ แล้วถามตอบให้เนียน"}</p>
          <button class="btn primary" onclick="window.acknowledgeRole()">รับทราบ</button>
        </div>
      </section>
    </div>
  `;
};

const timerPanel = () => {
  const timer = state.room.round?.timer;
  if (!timer?.enabled) return "";
  const currentPlayer = state.room.players.find((player) => player.id === timer.currentPlayerId);
  const current = currentPlayer ? currentPlayer.name : "-";
  const display = timer.status === "countdown" ? timer.countdownSecondsRemaining : timer.secondsRemaining;
  const total = Math.max(1, timer.totalSeconds || state.room.settings.speechSecondsPerTurn || 30);
  const progress = timer.status === "speaking" ? Math.max(0, Math.min(100, (timer.secondsRemaining / total) * 100)) : 100;
  const tone = timer.status !== "speaking" ? "ready" : progress <= 20 ? "danger" : progress <= 50 ? "warn" : "ok";
  const urgent = timer.status === "speaking" && timer.secondsRemaining <= 3 && timer.secondsRemaining > 0;
  return `
    <section class="panel timer party-card">
      <div class="row between">
        <h2>จับเวลาพูด</h2>
        <span class="pill">รอบ ${timer.currentSpeechRound}/${timer.totalSpeechRounds}</span>
      </div>
      <div class="timer-orbit ${tone} ${timer.secondsRemaining <= 5 && timer.status === "speaking" ? "warning-pulse" : ""}" style="--progress: ${progress}%">
        <div class="timer-face">
          <div class="seconds ${urgent ? "urgent" : ""}">${display}</div>
          <div class="timer-caption">${timer.status === "countdown" ? "เตรียมตัว" : timer.status === "paused" ? "หยุดเวลา" : "วินาที"}</div>
        </div>
      </div>
      <div class="speaker-card">
        ${currentPlayer ? avatar(currentPlayer, "speaking large") : ""}
        <div>
          <span>${timer.status === "countdown" ? "คนถัดไป" : "กำลังพูด"}</span>
          <strong>${escapeHtml(current)}</strong>
        </div>
      </div>
      <div class="muted">${timer.status === "paused" ? "หยุดเวลาอยู่" : timer.status === "completed" ? "ครบ 3 รอบแล้ว" : ""}</div>
      ${isHost() ? `
        <div class="row">
          ${timer.status === "paused"
            ? `<button class="btn primary" onclick="window.action('/api/timer/resume')">เล่นต่อ</button>`
            : `<button class="btn" onclick="window.action('/api/timer/pause')">หยุดเวลา</button>`}
          <button class="btn" onclick="window.action('/api/timer/skip')">ข้ามคนนี้</button>
        </div>
      ` : ""}
    </section>
  `;
};

const gameView = () => layout(`
  <div class="game-board">
    ${roleCard()}
    ${timerPanel()}
    <section class="panel action-card">
      <div class="row between">
        <div>
          <h2>ช่วงถามตอบ</h2>
          <span class="muted">คุยนอกระบบ แล้วกดเริ่มโหวตเมื่อพร้อม</span>
        </div>
        ${isHost() ? `<button class="btn primary" onclick="window.action('/api/game/vote/start')">เริ่มโหวต</button>` : ""}
      </div>
    </section>
  </div>
  ${roleRevealOverlay()}
`, `<aside class="stack">${playerList()}${rulesCard()}</aside>`);

const voteView = () => {
  const needed = state.room.round.voteTargetCount;
  return layout(`
    <div class="vote-stage">
      <section class="panel vote-panel">
        <h2>โหวตจับคนข้างบ้าน</h2>
        <p class="muted">เลือก ${needed} คนที่น่าสงสัยที่สุด ถ้าจับไม่ครบ ฝ่ายคนข้างบ้านชนะทันที</p>
        <div class="vote-grid">
          ${state.room.players.map((player) => `
            <button class="vote-option ${state.selectedVotes.has(player.id) ? "selected" : ""}" onclick="toggleVote('${player.id}')">
              ${avatar(player, state.selectedVotes.has(player.id) ? "selected" : "")}
              <strong>${escapeHtml(player.name)}</strong>
              <span class="checkmark">✓</span>
              <div class="muted">${state.selectedVotes.has(player.id) ? "เลือกแล้ว" : "แตะเพื่อเลือก"}</div>
            </button>
          `).join("")}
        </div>
        <div class="divider"></div>
        <div class="row between">
          <span class="pill">เลือกแล้ว ${state.selectedVotes.size}/${needed}</span>
          <div class="row">
            <button class="btn primary" onclick="submitVote()" ${state.selectedVotes.size !== needed ? "disabled" : ""}>ส่งโหวต</button>
            ${isHost() ? `<button class="btn" onclick="window.action('/api/vote/finish')">จบโหวต</button>` : ""}
          </div>
        </div>
      </section>
    </div>
  `, `<aside class="stack">${playerList()}<div class="card compact"><h3>ส่งโหวตแล้ว</h3><p class="muted">${state.room.round.votesSubmitted}/${state.room.players.length} คน</p></div></aside>`);
};

const guessView = () => {
  const isNeighbor = state.me.role === "neighbor";
  const guessed = state.room.round.guessedPlayerIds.includes(state.me.playerId);
  return layout(`
    <section class="panel">
      <h2>จับคนข้างบ้านครบแล้ว</h2>
      <p class="muted">คนข้างบ้านมีโอกาสเดาคำลับ ถ้ามีคนใดเดาถูก ฝ่ายคนข้างบ้านชนะ</p>
      ${isNeighbor ? guessed ? `
        <div class="card compact">ส่งคำตอบแล้ว รอคนข้างบ้านคนอื่น</div>
      ` : `
        <form class="form" onsubmit="submitGuess(event)">
          <label>เดาคำลับ <input name="guessedWord" required autocomplete="off" /></label>
          <button class="btn primary" type="submit">ส่งคำตอบ</button>
        </form>
      ` : `
        <div class="card compact">รอคนข้างบ้านเดาคำ</div>
      `}
    </section>
  `, `<aside class="stack">${playerList()}</aside>`);
};

const winnerPopup = (result, neighborWin) => {
  const roundId = state.room?.round?.id;
  if (!roundId || state.acknowledgedResults.has(roundId)) return "";
  return `
    <div class="winner-backdrop">
      <section class="winner-card ${neighborWin ? "neighbor" : "normal"}">
        <div class="winner-badge">WINNER</div>
        <h2>${neighborWin ? "ฝ่ายคนข้างบ้านชนะ!" : "ฝ่ายผู้เล่นทั่วไปชนะ!"}</h2>
        <p>${escapeHtml(result.reason)}</p>
        <div class="winner-word">คำลับ: <strong>${escapeHtml(result.secretWord)}</strong></div>
        <button class="btn primary jumbo" onclick="window.acknowledgeResult()">ดูเฉลยทั้งหมด</button>
      </section>
    </div>
  `;
};

const resultView = () => {
  const result = state.room.round.result;
  const neighborWin = result.winner === "neighbor";
  return layout(`
    <section class="panel result result-stage ${neighborWin ? "neighbor" : ""}">
      <span class="brand-kicker">Party Result</span>
      <h2>${neighborWin ? "ฝ่ายคนข้างบ้านชนะ" : "ฝ่ายผู้เล่นทั่วไปชนะ"}</h2>
      <p class="muted">${escapeHtml(result.reason)}</p>
      <div class="card compact secret-result">
        <h3>คำลับ</h3>
        <div class="big-secret-word">${escapeHtml(result.secretWord)}</div>
      </div>
      <div class="divider"></div>
      <h3>เฉลยบทบาท</h3>
      <div class="players">
        ${state.room.players.map((player) => `
          <div class="player result-player">
            ${avatar(player, result.neighborIds.includes(player.id) ? "neighbor" : "")}
            <strong>${escapeHtml(player.name)}</strong>
            <span class="pill">${result.neighborIds.includes(player.id) ? "คนข้างบ้าน" : "ผู้เล่นทั่วไป"}</span>
          </div>
        `).join("")}
      </div>
      ${isHost() ? `<div class="divider"></div><button class="btn primary" onclick="window.action('/api/game/reset')">กลับ Lobby เพื่อเริ่มรอบใหม่</button>` : ""}
    </section>
    ${winnerPopup(result, neighborWin)}
  `);
};

const render = () => {
  if (!state.room) {
    app.innerHTML = homeView();
    return;
  }
  if (state.room.status === "lobby") app.innerHTML = lobbyView();
  if (state.room.status === "playing") app.innerHTML = gameView();
  if (state.room.status === "voting") app.innerHTML = voteView();
  if (state.room.status === "neighbor_guess") app.innerHTML = guessView();
  if (state.room.status === "result") app.innerHTML = resultView();
};

const tryReconnect = async () => {
  if (!state.routeCode) return render();
  const id = localStorage.getItem(storageKey(state.routeCode));
  if (!id) return render();
  try {
    const data = await api("/api/rooms/join", { roomCode: state.routeCode, playerId: id });
    joinCreatedRoom(data.room, data.playerId);
  } catch {
    render();
  }
};

tryReconnect();
