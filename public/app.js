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
  lastRoundId: ""
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
        speechTimerEnabled: form.get("speechTimerEnabled") === "on"
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
        speechTimerEnabled: form.get("speechTimerEnabled") === "on"
      }
    });
  } catch (err) {
    toast(err.message);
  }
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
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <h1>คนข้างบ้าน</h1>
        <span>เกมปาร์ตี้จับพิรุธแบบ realtime</span>
      </div>
      ${state.room ? `<span class="pill">ห้อง ${state.room.code}</span>` : ""}
    </header>
    ${aside ? `<section class="grid">${content}${aside}</section>` : content}
  </div>
`;

const homeView = () => layout(`
  <section class="grid">
    <div class="panel">
      <h2>สร้างห้อง</h2>
      <form class="form" onsubmit="createRoom(event)">
        <label>ชื่อของคุณ <input name="playerName" maxlength="24" required placeholder="เช่น นิดา" /></label>
        <label>จำนวนผู้เล่นสูงสุด <input name="maxPlayers" type="number" min="3" max="20" value="20" /></label>
        <label>จำนวนคนข้างบ้าน <input name="neighborCount" type="number" min="1" max="6" value="1" /></label>
        <label class="check"><input name="speechTimerEnabled" type="checkbox" /> เปิดจับเวลาพูด 30 วิ วน 3 รอบ</label>
        <button class="btn primary" type="submit">สร้างห้อง</button>
      </form>
    </div>
    <div class="panel">
      <h2>เข้าห้อง</h2>
      <form class="form" onsubmit="joinRoom(event)">
        <label>ชื่อของคุณ <input name="playerName" maxlength="24" required placeholder="ชื่อที่เพื่อนเห็น" /></label>
        <label>โค้ดห้อง <input name="roomCode" maxlength="8" required value="${escapeHtml(state.routeCode)}" placeholder="เช่น A7K2P" /></label>
        <button class="btn primary" type="submit">เข้าห้อง</button>
      </form>
      <div class="divider"></div>
      <p class="muted">เล่นผ่านเสียงหรือแชทนอกระบบได้เลย ระบบนี้จะจัดการห้อง บทบาท คำลับ เวลา โหวต และเฉลยให้</p>
    </div>
  </section>
`);

const playerList = () => `
  <div class="card compact">
    <div class="row between">
      <h3>ผู้เล่น ${state.room.players.length}/${state.room.settings.maxPlayers}</h3>
      <span class="pill">${state.room.status}</span>
    </div>
    <div class="players">
      ${state.room.players.map((player) => `
        <div class="player">
          <strong>${escapeHtml(player.name)}</strong>
          <span class="muted">${player.isHost ? "Host" : ""}${player.id === state.me.playerId ? " คุณ" : ""}</span>
        </div>
      `).join("")}
    </div>
  </div>
`;

const lobbyView = () => layout(`
  <div class="stack">
    <section class="panel">
      <div class="row between">
        <div>
          <h2>Lobby</h2>
          <span class="muted">ส่งลิงก์ให้เพื่อนแล้วรอครบอย่างน้อย 3 คน</span>
        </div>
        <button class="btn" onclick="copyInvite()">คัดลอกลิงก์เชิญ</button>
      </div>
    </section>
    ${isHost() ? `
      <section class="panel">
        <h2>ตั้งค่าเกม</h2>
        <form class="form" onsubmit="updateSettings(event)">
          <label>จำนวนผู้เล่นสูงสุด <input name="maxPlayers" type="number" min="3" max="20" value="${state.room.settings.maxPlayers}" /></label>
          <label>จำนวนคนข้างบ้าน <input name="neighborCount" type="number" min="1" max="${Math.max(1, state.room.players.length - 1)}" value="${state.room.settings.neighborCount}" /></label>
          <label class="check"><input name="speechTimerEnabled" type="checkbox" ${state.room.settings.speechTimerEnabled ? "checked" : ""} /> เปิดจับเวลาพูด 30 วิ วน 3 รอบ</label>
          <div class="row">
            <button class="btn" type="submit">บันทึกตั้งค่า</button>
            <button class="btn primary" type="button" onclick="window.action('/api/game/start')" ${state.room.players.length < 3 ? "disabled" : ""}>เริ่มเกม</button>
          </div>
          ${state.room.players.length < 3 ? `<span class="muted">ต้องมีผู้เล่นอย่างน้อย 3 คน ตอนนี้มี ${state.room.players.length} คน</span>` : ""}
        </form>
      </section>
    ` : `
      <section class="panel"><h2>รอ Host เริ่มเกม</h2><p class="muted">เมื่อเริ่มแล้วระบบจะแสดงบทบาทของคุณทันที</p></section>
    `}
  </div>
`, `<aside class="stack">${playerList()}${rulesCard()}</aside>`);

const rulesCard = () => `
  <div class="card compact">
    <h3>กติกาย่อ</h3>
    <p class="muted">ทุกคนเห็นคำเดียวกัน ยกเว้นคนข้างบ้าน ห้ามพูดคำตรง ๆ ผู้เล่นต้องโหวตจับคนข้างบ้านให้ครบ ถ้าจับครบ คนข้างบ้านยังมีสิทธิ์เดาคำเพื่อพลิกชนะ</p>
  </div>
`;

const roleCard = () => {
  const role = state.me.role;
  const isNeighbor = role === "neighbor";
  return `
    <section class="panel role-card ${isNeighbor ? "neighbor" : ""}">
      <div>
        <div class="label">บทบาทของคุณ</div>
        <div class="word">${isNeighbor ? "คุณคือคนข้างบ้าน" : escapeHtml(state.me.secretWord || "รอคำลับ")}</div>
        <p class="muted">${isNeighbor ? "ฟังบทสนทนาแล้วพยายามเดาคำลับให้ได้" : "ถามตอบโดยห้ามพูดคำนี้ตรง ๆ"}</p>
      </div>
    </section>
  `;
};

const timerPanel = () => {
  const timer = state.room.round?.timer;
  if (!timer?.enabled) return "";
  const current = timer.currentPlayerId ? playerName(timer.currentPlayerId) : "-";
  const display = timer.status === "countdown" ? timer.countdownSecondsRemaining : timer.secondsRemaining;
  return `
    <section class="panel timer">
      <div class="row between">
        <h2>จับเวลาพูด</h2>
        <span class="pill">รอบ ${timer.currentSpeechRound}/${timer.totalSpeechRounds}</span>
      </div>
      <div class="timer-face">
        <div>
          <div class="seconds">${display}</div>
          <div class="speaker">${timer.status === "countdown" ? "เตรียมตัว" : "กำลังพูด"}: ${escapeHtml(current)}</div>
          <div class="muted">${timer.status === "paused" ? "หยุดเวลาอยู่" : timer.status === "completed" ? "ครบ 3 รอบแล้ว" : ""}</div>
        </div>
      </div>
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
  <div class="stack">
    ${roleCard()}
    ${timerPanel()}
    <section class="panel">
      <div class="row between">
        <div>
          <h2>ช่วงถามตอบ</h2>
          <span class="muted">คุยนอกระบบ แล้วกดเริ่มโหวตเมื่อพร้อม</span>
        </div>
        ${isHost() ? `<button class="btn primary" onclick="window.action('/api/game/vote/start')">เริ่มโหวต</button>` : ""}
      </div>
    </section>
  </div>
`, `<aside class="stack">${playerList()}${rulesCard()}</aside>`);

const voteView = () => {
  const needed = state.room.round.voteTargetCount;
  return layout(`
    <div class="stack">
      <section class="panel">
        <h2>โหวตจับคนข้างบ้าน</h2>
        <p class="muted">เลือก ${needed} คนที่น่าสงสัยที่สุด ถ้าจับไม่ครบ ฝ่ายคนข้างบ้านชนะทันที</p>
        <div class="vote-grid">
          ${state.room.players.map((player) => `
            <button class="vote-option ${state.selectedVotes.has(player.id) ? "selected" : ""}" onclick="toggleVote('${player.id}')">
              <strong>${escapeHtml(player.name)}</strong>
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

const resultView = () => {
  const result = state.room.round.result;
  const neighborWin = result.winner === "neighbor";
  return layout(`
    <section class="panel result ${neighborWin ? "neighbor" : ""}">
      <h2>${neighborWin ? "ฝ่ายคนข้างบ้านชนะ" : "ฝ่ายผู้เล่นทั่วไปชนะ"}</h2>
      <p class="muted">${escapeHtml(result.reason)}</p>
      <div class="card compact">
        <h3>คำลับ</h3>
        <div class="role-card"><div class="word">${escapeHtml(result.secretWord)}</div></div>
      </div>
      <div class="divider"></div>
      <h3>เฉลยบทบาท</h3>
      <div class="players">
        ${state.room.players.map((player) => `
          <div class="player">
            <strong>${escapeHtml(player.name)}</strong>
            <span class="pill">${result.neighborIds.includes(player.id) ? "คนข้างบ้าน" : "ผู้เล่นทั่วไป"}</span>
          </div>
        `).join("")}
      </div>
      ${isHost() ? `<div class="divider"></div><button class="btn primary" onclick="window.action('/api/game/reset')">กลับ Lobby เพื่อเริ่มรอบใหม่</button>` : ""}
    </section>
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
