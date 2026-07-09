const app = document.querySelector("#app");
const toastEl = document.querySelector("#toast");

const state = {
  room: null,
  me: null,
  eventSource: null,
  routeCode: new URLSearchParams(location.search).get("room") || "",
  selectedVotes: new Set(),
  flippedRounds: new Set(),
  acknowledgedResults: new Set(),
  createSetup: null,
  closedMessage: "",
  lastTimerKey: "",
  soundReady: false
};

const storageKey = (code) => `kkb:${code}:playerId`;
const currentCode = () => state.room?.code || state.routeCode;
const playerId = () => state.me?.playerId || localStorage.getItem(storageKey(currentCode()));
const isHost = () => Boolean(state.me?.isHost);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[char]);
const playerName = (id) => state.room?.players.find((player) => player.id === id)?.name || "—";
const playerById = (id) => state.room?.players.find((player) => player.id === id);
const formatTime = (seconds = 0) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} นาที`;
const toast = (message) => {
  toastEl.textContent = message;
  toastEl.hidden = false;
  clearTimeout(toastEl.timer);
  toastEl.timer = setTimeout(() => { toastEl.hidden = true; }, 2600);
};
const api = async (path, body = {}) => {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || "เกิดข้อผิดพลาด");
  return data;
};
const avatar = (player, extra = "") => `<span class="avatar ${extra}" aria-hidden="true">${escapeHtml(player?.avatar || "😀")}</span>`;

const unlockSound = () => {
  if (state.soundReady) return;
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return;
  state.audio = new Audio();
  state.soundReady = true;
};
const beep = (frequency = 720, duration = 0.08) => {
  if (!state.audio) return;
  const osc = state.audio.createOscillator();
  const gain = state.audio.createGain();
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, state.audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.08, state.audio.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, state.audio.currentTime + duration);
  osc.connect(gain);
  gain.connect(state.audio.destination);
  osc.start();
  osc.stop(state.audio.currentTime + duration + 0.01);
};
const handleTimerSound = (timer) => {
  if (!timer?.enabled) return;
  const key = `${timer.status}:${timer.countdownSecondsRemaining}:${timer.secondsRemaining}`;
  if (key === state.lastTimerKey) return;
  state.lastTimerKey = key;
  if (timer.status === "countdown" && timer.countdownSecondsRemaining > 0) beep(850);
  if (timer.status === "speaking" && timer.secondsRemaining <= 5 && timer.secondsRemaining > 0) beep(620);
};

const connectEvents = (code, id) => {
  state.eventSource?.close();
  const source = new EventSource(`/api/events?roomCode=${encodeURIComponent(code)}&playerId=${encodeURIComponent(id)}`);
  state.eventSource = source;
  source.addEventListener("state", (event) => {
    const data = JSON.parse(event.data);
    const oldRound = state.room?.round?.id;
    state.room = data.room;
    state.me = data.me;
    if (oldRound && oldRound !== state.room.round?.id) state.selectedVotes.clear();
    handleTimerSound(state.room.round?.timer);
    render();
  });
  source.addEventListener("room_closed", (event) => {
    state.closedMessage = JSON.parse(event.data).message;
    source.close();
    render();
  });
  source.onerror = () => {
    if (!state.closedMessage) toast("กำลังเชื่อมต่อใหม่...");
  };
};
const joinCreatedRoom = (room, id) => {
  state.room = room;
  state.me = { playerId: id, isHost: room.hostPlayerId === id };
  state.routeCode = room.code;
  state.createSetup = null;
  localStorage.setItem(storageKey(room.code), id);
  history.replaceState(null, "", `/?room=${room.code}`);
  connectEvents(room.code, id);
  render();
};

window.openCreateSetup = (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  state.createSetup = { playerName: String(form.get("playerName") || "").trim() };
  render();
};
window.cancelCreateSetup = () => { state.createSetup = null; render(); };
const settingsFromForm = (form) => ({
  roomName: form.get("roomName"),
  maxPlayers: Number(form.get("maxPlayers")),
  neighborCount: Number(form.get("neighborCount")),
  speechTimerEnabled: form.get("speechTimerEnabled") === "on",
  speechSecondsPerTurn: Number(form.get("speechSecondsPerTurn")),
  speechRounds: Number(form.get("speechRounds")),
  selectedCategories: form.getAll("selectedCategories")
});
window.createRoom = async (event) => {
  event.preventDefault();
  unlockSound();
  const form = new FormData(event.currentTarget);
  try {
    const data = await api("/api/rooms", { playerName: state.createSetup.playerName, settings: settingsFromForm(form) });
    joinCreatedRoom(data.room, data.playerId);
  } catch (err) { toast(err.message); }
};
window.joinRoom = async (event) => {
  event.preventDefault();
  unlockSound();
  const form = new FormData(event.currentTarget);
  const code = String(form.get("roomCode") || state.routeCode).trim().toUpperCase();
  try {
    const data = await api("/api/rooms/join", { roomCode: code, playerName: form.get("playerName"), playerId: localStorage.getItem(storageKey(code)) });
    joinCreatedRoom(data.room, data.playerId);
  } catch (err) { toast(err.message); }
};
window.updateSettings = async (event) => {
  event.preventDefault();
  try {
    await api("/api/rooms/settings", { roomCode: currentCode(), playerId: playerId(), settings: settingsFromForm(new FormData(event.currentTarget)) });
    toast("บันทึกการตั้งค่าแล้ว");
  } catch (err) { toast(err.message); }
};
window.updateProfile = async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    await api("/api/players/profile", { roomCode: currentCode(), playerId: playerId(), name: form.get("name"), avatar: form.get("avatar") });
    toast("อัปเดตโปรไฟล์แล้ว");
  } catch (err) { toast(err.message); }
};
window.selectAvatar = (button, emoji) => {
  const form = button.closest("form");
  form.querySelector("[name=avatar]").value = emoji;
  form.querySelectorAll(".avatar-choice").forEach((item) => item.classList.toggle("selected", item === button));
};
window.toggleAllCategories = (checkbox) => {
  checkbox.closest(".category-grid").querySelectorAll("input[value]:not([value=all])").forEach((input) => {
    input.disabled = checkbox.checked;
    if (checkbox.checked) input.checked = false;
  });
};
window.syncSpeechSeconds = (input) => {
  const form = input.closest("form");
  const value = Math.max(5, Math.min(120, Number(input.value) || 20));
  form.querySelectorAll("[data-speech-seconds]").forEach((control) => { control.value = value; });
  form.querySelectorAll("[data-speech-seconds-label]").forEach((label) => { label.textContent = `${value} วินาที`; });
};
window.flipRole = () => {
  state.flippedRounds.add(state.room.round.id);
  render();
};
window.markReady = async () => {
  try { await api("/api/game/ready", { roomCode: currentCode(), playerId: playerId() }); }
  catch (err) { toast(err.message); }
};
window.action = async (path, extra = {}) => {
  unlockSound();
  try { await api(path, { roomCode: currentCode(), playerId: playerId(), ...extra }); }
  catch (err) { toast(err.message); }
};
window.toggleVote = (id) => {
  const needed = state.room.round.voteTargetCount;
  if (state.selectedVotes.has(id)) state.selectedVotes.delete(id);
  else if (state.selectedVotes.size < needed) state.selectedVotes.add(id);
  else return toast(`เลือกได้ ${needed} คน`);
  render();
};
window.submitVote = async () => {
  try {
    await api("/api/vote", { roomCode: currentCode(), playerId: playerId(), targetPlayerIds: [...state.selectedVotes] });
    toast("ส่งโหวตแล้ว");
  } catch (err) { toast(err.message); }
};
window.submitGuess = async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try { await api("/api/guess", { roomCode: currentCode(), playerId: playerId(), guessedWord: form.get("guessedWord") }); }
  catch (err) { toast(err.message); }
};
window.copyInvite = async () => {
  await navigator.clipboard.writeText(`${location.origin}/?room=${currentCode()}`);
  toast("คัดลอกลิงก์เชิญแล้ว");
};
window.leaveRoom = async () => {
  if (!state.room) return goLobby();
  const warning = isHost() ? "หากคุณออก ห้องจะถูกปิดสำหรับผู้เล่นทุกคน ต้องการออกหรือไม่?" : "ต้องการออกจากห้องและกลับ Lobby หรือไม่?";
  if (!window.confirm(warning)) return;
  try { await api("/api/rooms/leave", { roomCode: currentCode(), playerId: playerId() }); } catch {}
  localStorage.removeItem(storageKey(currentCode()));
  goLobby();
};
window.goLobby = () => {
  state.eventSource?.close();
  state.room = null;
  state.me = null;
  state.routeCode = "";
  state.closedMessage = "";
  history.replaceState(null, "", "/");
  render();
};

const exitButton = () => state.room ? `<button class="btn ghost exit-btn" onclick="leaveRoom()">ออกจากห้อง</button>` : "";
const layout = (content, className = "") => `
  <div class="village-bg" aria-hidden="true">
    <span class="hill hill-a"></span><span class="hill hill-b"></span>
    <span class="house-art">⌂</span><span class="tree-art">♧</span><span class="lamp-art">♧</span>
  </div>
  <div class="shell ${className}">
    <header class="topbar">
      <a class="brand" href="/" onclick="${state.room ? "event.preventDefault(); leaveRoom()" : ""}">
        <span class="brand-mark">🏡</span><span><strong>คนข้างบ้าน</strong><small>เกมจับพิรุธของแก๊งเพื่อน</small></span>
      </a>
      <div class="top-actions"><span class="version-badge">Version 2 Loaded</span>${state.room ? `<span class="room-badge">${escapeHtml(state.room.settings.roomName)} · ${state.room.code}</span>` : ""}${exitButton()}</div>
    </header>
    ${content}
  </div>`;

const timerSetting = (value = 20, enabled = true) => `
  <label class="switch-row"><span><strong>เวลาต่อคน</strong><small>เปิดจับเวลาอัตโนมัติ</small></span><input name="speechTimerEnabled" type="checkbox" ${enabled ? "checked" : ""}></label>
  <div class="timer-setting">
    <div class="row between"><span>ระยะเวลา</span><strong data-speech-seconds-label>${value} วินาที</strong></div>
    <div class="range-row"><input data-speech-seconds name="speechSecondsPerTurn" type="range" min="5" max="120" value="${value}" oninput="syncSpeechSeconds(this)"><input data-speech-seconds type="number" min="5" max="120" value="${value}" oninput="syncSpeechSeconds(this)"></div>
  </div>`;
const categoriesForm = (selected = ["all"]) => {
  const categories = state.room?.categories || [
    { id: "animals", label: "🐶 สัตว์โลกน่ารัก" }, { id: "home", label: "🏠 บ้านของเรา" },
    { id: "office", label: "💼 ชีวิตออฟฟิศ" }, { id: "food", label: "🍜 อาหาร" },
    { id: "seven", label: "🛒 เซเว่นจ๋าพี่มาแล้ว" }, { id: "olympics", label: "🏅 โอลิมปิก" }
  ];
  const all = selected.includes("all");
  return `<fieldset><legend>เลือกหมวดคำ</legend><p class="helper">เลือกได้หลายหมวด</p><div class="category-grid">
    <label class="category-option all"><input name="selectedCategories" value="all" type="checkbox" ${all ? "checked" : ""} onchange="toggleAllCategories(this)"><span>🎲 สุ่มทุกหมวด</span></label>
    ${categories.map((item) => `<label class="category-option"><input name="selectedCategories" value="${item.id}" type="checkbox" ${selected.includes(item.id) ? "checked" : ""} ${all ? "disabled" : ""}><span>${item.label}</span></label>`).join("")}
  </div></fieldset>`;
};
const settingsFields = (settings = {}) => `
  <div class="form-grid">
    <label class="wide">ชื่อห้อง<input name="roomName" maxlength="40" value="${escapeHtml(settings.roomName || "ห้องนั่งเล่น")}" required></label>
    <label>จำนวนผู้เล่น<input name="maxPlayers" type="number" min="3" max="20" value="${settings.maxPlayers || 20}"></label>
    <label>จำนวนคนข้างบ้าน<input name="neighborCount" type="number" min="1" max="6" value="${settings.neighborCount || 1}"></label>
    <label>จำนวนรอบใบ้คำ<select name="speechRounds">${[1, 2, 3].map((n) => `<option value="${n}" ${Number(settings.speechRounds || 1) === n ? "selected" : ""}>${n} รอบ</option>`).join("")}</select></label>
  </div>
  ${timerSetting(settings.speechSecondsPerTurn || 20, settings.speechTimerEnabled !== false)}
  ${categoriesForm(settings.selectedCategories || ["all"])}`;

const homeView = () => layout(`
  <main class="home">
    <section class="hero">
      <span class="eyebrow">REALTIME PARTY GAME</span>
      <h1>ใครกันนะ<br><em>“คนข้างบ้าน”</em></h1>
      <p>เกมใบ้คำ จับพิรุธ และหาตัวคนที่ไม่รู้คำลับ เล่นได้ทั้งออนไลน์และวงเพื่อน</p>
    </section>
    <section class="gate">
      <div class="panel">
        <div class="panel-icon coral">✨</div><h2>สร้างห้องใหม่</h2>
        <form class="form" onsubmit="openCreateSetup(event)">
          <label>ชื่อของคุณ<input name="playerName" maxlength="24" required placeholder="เช่น นิตา"></label>
          <button class="btn primary jumbo" type="submit">สร้างห้อง</button>
        </form>
      </div>
      <div class="panel">
        <div class="panel-icon teal">🚪</div><h2>เข้าร่วมห้อง</h2>
        <form class="form" onsubmit="joinRoom(event)">
          <label>ชื่อของคุณ<input name="playerName" maxlength="24" required placeholder="ชื่อที่เพื่อนเห็น"></label>
          <label>รหัสห้อง<input name="roomCode" maxlength="8" required value="${escapeHtml(state.routeCode)}" placeholder="เช่น A7K2P"></label>
          <button class="btn secondary jumbo" type="submit">เข้าห้อง</button>
        </form>
      </div>
    </section>
  </main>`, "home-shell");
const createSetupView = () => layout(`
  <main class="center-page"><section class="panel setup-panel">
    <div class="section-heading"><div><span class="eyebrow">CREATE ROOM</span><h1>ตั้งค่าห้อง</h1><p>ปรับโต๊ะเกมให้พอดีกับแก๊งของคุณ</p></div><button class="btn ghost" onclick="cancelCreateSetup()">กลับ Lobby</button></div>
    <form class="form" onsubmit="createRoom(event)">${settingsFields()}<button class="btn primary jumbo" type="submit">สร้างห้องและไปรอเพื่อน</button></form>
  </section></main>`);
const joinOnlyView = () => layout(`<main class="center-page"><section class="panel join-panel"><span class="eyebrow">INVITE LINK</span><h1>เข้าห้อง ${escapeHtml(state.routeCode)}</h1><form class="form" onsubmit="joinRoom(event)"><label>ชื่อของคุณ<input name="playerName" maxlength="24" required autofocus></label><input name="roomCode" type="hidden" value="${escapeHtml(state.routeCode)}"><button class="btn primary jumbo">เข้าห้อง</button></form><button class="btn ghost" onclick="goLobby()">กลับ Lobby</button></section></main>`);

const profileEditor = () => {
  const me = playerById(state.me.playerId);
  return `<section class="panel profile-panel"><h2>โปรไฟล์ของฉัน</h2><form class="form" onsubmit="updateProfile(event)"><div class="profile-row">${avatar(me, "xl")}<label>ชื่อที่แสดง<input name="name" maxlength="24" value="${escapeHtml(me.name)}" required></label></div><input name="avatar" type="hidden" value="${escapeHtml(me.avatar)}"><div class="avatar-picker">${state.room.avatars.map((emoji) => `<button type="button" class="avatar-choice ${emoji === me.avatar ? "selected" : ""}" onclick="selectAvatar(this, '${emoji}')">${emoji}</button>`).join("")}</div><button class="btn secondary" type="submit">บันทึกโปรไฟล์</button></form></section>`;
};
const playerGrid = () => `<div class="waiting-players">${state.room.players.map((player) => `<article class="player-tile">${avatar(player, "large")}<strong>${escapeHtml(player.name)}</strong><span>${player.isHost ? "👑 Host" : player.isConnected ? "พร้อมอยู่ในห้อง" : "ขาดการเชื่อมต่อ"}</span></article>`).join("")}</div>`;
const lobbyView = () => layout(`<main class="lobby-page">
  <section class="panel waiting-panel"><div class="section-heading"><div><span class="eyebrow">WAITING ROOM</span><h1>${escapeHtml(state.room.settings.roomName)}</h1><p>รหัสห้อง <strong>${state.room.code}</strong> · ${state.room.players.length}/${state.room.settings.maxPlayers} คน</p></div><button class="btn secondary" onclick="copyInvite()">คัดลอกลิงก์เชิญ</button></div>${playerGrid()}</section>
  <aside class="lobby-side">${profileEditor()}${isHost() ? `<section class="panel"><h2>ตั้งค่าห้อง</h2><form class="form compact-form" onsubmit="updateSettings(event)">${settingsFields(state.room.settings)}<button class="btn secondary" type="submit">บันทึกตั้งค่า</button><button class="btn primary jumbo" type="button" onclick="action('/api/game/start')" ${state.room.players.length < 3 ? "disabled" : ""}>เริ่มเกม</button>${state.room.players.length < 3 ? `<p class="helper">ต้องมีผู้เล่นอย่างน้อย 3 คน</p>` : ""}</form></section>` : `<section class="panel wait-host"><div>☕</div><h2>รอ Host เริ่มเกม</h2><p>ระหว่างนี้เปลี่ยนชื่อและ Avatar ได้เลย</p></section>`}</aside>
</main>`);

const playerStatus = () => `<div class="ready-list">${state.room.players.map((player) => `<div>${avatar(player)}<span>${escapeHtml(player.name)}</span><strong>${state.room.round.readyPlayerIds.includes(player.id) ? "✓ พร้อม" : "กำลังดูการ์ด"}</strong></div>`).join("")}</div>`;
const revealView = () => {
  const round = state.room.round;
  const flipped = state.flippedRounds.has(round.id);
  const ready = round.readyPlayerIds.includes(state.me.playerId);
  const neighbor = state.me.role === "neighbor";
  return layout(`<main class="reveal-page"><section class="reveal-main"><span class="eyebrow">บทบาทลับของคุณ</span><h1>พลิกการ์ดเมื่อพร้อม</h1>
    <button class="role-flip ${flipped ? "flipped" : ""}" onclick="flipRole()" aria-label="พลิกการ์ดดูบทบาท">
      <span class="card-face card-back"><span>🏘️</span><strong>พลิกการ์ดเพื่อดู<br>บทบาทของคุณ</strong><small>แตะที่การ์ด</small></span>
      <span class="card-face card-front ${neighbor ? "neighbor" : ""}"><small>บทบาทของคุณ</small><strong>${neighbor ? "คนข้างบ้าน" : "คนบ้านเดียวกัน"}</strong><span class="secret">${neighbor ? "คุณไม่รู้คำลับ" : escapeHtml(state.me.secretWord)}</span><span class="category">${escapeHtml(round.categoryLabel)}</span></span>
    </button>
    <button class="btn primary jumbo ready-btn" onclick="markReady()" ${!flipped || ready ? "disabled" : ""}>${ready ? "พร้อมแล้ว ✓" : "พร้อม"}</button>
  </section><aside class="panel reveal-side"><h2>รอทุกคนพร้อม</h2><div class="ready-count">${round.readyCount}/${state.room.players.length}</div>${playerStatus()}</aside></main>`);
};
const circlePlayers = () => {
  const turn = state.room.round.turn;
  const count = state.room.players.length;
  return state.room.players.map((player, index) => {
    const angle = (Math.PI * 2 * index / count) - Math.PI / 2;
    const left = 50 + Math.cos(angle) * 42;
    const top = 50 + Math.sin(angle) * 39;
    const active = player.id === turn.currentPlayerId;
    return `<div class="circle-player ${active ? "active" : ""}" style="--left:${left}%;--top:${top}%">${avatar(player, active ? "active" : "")}<strong>${escapeHtml(player.name)}</strong>${active ? "<span>ถึงตาแล้ว</span>" : ""}</div>`;
  }).join("");
};
const timerCenter = () => {
  const { timer, turn } = state.room.round;
  const display = timer.enabled ? (timer.status === "countdown" ? timer.countdownSecondsRemaining : timer.secondsRemaining) : "∞";
  return `<div class="table-center"><span>รอบ ${turn.currentRound}/${turn.totalRounds}</span><div class="clock">${turn.completed ? "✓" : display}</div><strong>${turn.completed ? "ครบทุกคนแล้ว" : timer.status === "countdown" ? "เตรียมตัว" : timer.enabled ? "วินาที" : "ไม่จับเวลา"}</strong></div>`;
};
const gameView = () => {
  const { turn, timer } = state.room.round;
  const current = playerName(turn.currentPlayerId);
  const next = playerName(turn.nextPlayerId);
  return layout(`<main class="play-page"><section class="turn-banner"><span>${turn.completed ? "จบรอบการใบ้คำแล้ว" : `ถึงตาของ “${escapeHtml(current)}” แล้ว`}</span><strong>${turn.completed ? "พร้อมเข้าสู่การโหวต" : turn.nextPlayerId ? `คนถัดไปคือ “${escapeHtml(next)}”` : "นี่คือคนสุดท้าย"}</strong></section>
    <section class="game-table">${circlePlayers()}${timerCenter()}</section>
    <section class="play-controls panel"><div><strong>${escapeHtml(state.room.round.categoryLabel)}</strong><span>คำลับของคุณ: ${state.me.role === "normal" ? escapeHtml(state.me.secretWord) : "คุณคือคนข้างบ้าน"}</span></div>${isHost() ? `<div class="row">${timer.enabled ? `<button class="btn ghost" onclick="action('/api/timer/${timer.status === "paused" ? "resume" : "pause"}')">${timer.status === "paused" ? "เล่นต่อ" : "หยุดเวลา"}</button>` : ""}<button class="btn secondary" onclick="action('/api/game/turn/next')" ${turn.completed ? "disabled" : ""}>คนถัดไป</button><button class="btn primary" onclick="action('/api/game/vote/start')" ${!turn.completed ? "" : ""}>เริ่มโหวต</button></div>` : `<span>Host จะควบคุมลำดับการเล่น</span>`}</section>
  </main>`, "play-shell");
};
const voteView = () => {
  const needed = state.room.round.voteTargetCount;
  const submitted = state.room.round.guessedPlayerIds?.includes(state.me.playerId);
  return layout(`<main class="vote-page"><section class="panel vote-panel"><span class="eyebrow">VOTING TIME</span><h1>ใครคือคนข้างบ้าน?</h1><p>เลือกผู้เล่น ${needed} คนที่คุณสงสัย</p><div class="vote-grid">${state.room.players.map((player) => `<button class="vote-option ${state.selectedVotes.has(player.id) ? "selected" : ""}" onclick="toggleVote('${player.id}')">${avatar(player, "large")}<strong>${escapeHtml(player.name)}</strong><span>${state.selectedVotes.has(player.id) ? "✓ เลือกแล้ว" : "แตะเพื่อเลือก"}</span></button>`).join("")}</div><div class="vote-footer"><span>เลือกแล้ว ${state.selectedVotes.size}/${needed}</span><button class="btn primary" onclick="submitVote()" ${state.selectedVotes.size !== needed ? "disabled" : ""}>ยืนยันการโหวต</button></div></section><aside class="panel vote-progress"><h2>สถานะการโหวต</h2><div class="ready-count">${state.room.round.votesSubmitted}/${state.room.players.length}</div><p>ส่งคำตอบแล้ว</p></aside></main>`);
};
const voteRevealView = () => {
  const outcome = state.room.round.voteOutcome;
  const captured = outcome.capturedIds.map(playerName);
  return layout(`<main class="center-page"><section class="panel decision-card"><span class="eyebrow">ผลการโหวต</span><div class="decision-avatars">${outcome.capturedIds.map((id) => avatar(playerById(id), "xl")).join("")}</div><h1>${outcome.tied ? "คะแนนโหวตเสมอกัน" : `คุณคิดว่า “${escapeHtml(captured.join(" และ "))}”`}</h1><h2>${outcome.tied ? "ยังจับคนข้างบ้านไม่ได้" : "คือคนข้างบ้านใช่หรือไม่?"}</h2><div class="verdict ${outcome.capturedAll ? "correct" : "wrong"}">${outcome.capturedAll ? "✅ จับคนข้างบ้านถูกต้อง" : "❌ ยังจับคนข้างบ้านไม่สำเร็จ"}</div>${isHost() ? `<button class="btn primary jumbo" onclick="action('/api/vote/reveal/continue')">ดูขั้นตอนถัดไป</button>` : `<p>รอ Host ดำเนินเกมต่อ</p>`}</section></main>`);
};
const guessAnswers = () => {
  const guesses = state.room.round.guesses || [];
  if (!guesses.length) return `<p class="helper">ยังไม่มีคำตอบ</p>`;
  return `<div class="answer-feed">${guesses.map((guess) => `<div>${avatar(playerById(guess.playerId))}<span><strong>${escapeHtml(playerName(guess.playerId))}</strong> ตอบว่า</span><b class="${guess.isCorrect ? "correct-text" : ""}">${escapeHtml(guess.displayAnswer)}</b></div>`).join("")}</div>`;
};
const guessView = () => {
  const neighbor = state.me.role === "neighbor";
  const guessed = state.room.round.guessedPlayerIds.includes(state.me.playerId);
  const manual = state.room.round.manualJudging;
  return layout(`<main class="guess-page"><section class="panel guess-card"><span class="eyebrow">LAST CHANCE</span><h1>คนข้างบ้านทายคำลับ</h1><p>ถ้าทายถูก ฝ่ายคนข้างบ้านจะพลิกกลับมาชนะ</p>${neighbor && !guessed && !manual ? `<form class="guess-form" onsubmit="submitGuess(event)"><input name="guessedWord" required autofocus autocomplete="off" placeholder="พิมพ์คำตอบ"><button class="btn primary">ส่งคำตอบ</button></form>` : `<div class="waiting-bubble">${manual ? "Host กำลังตัดสินคำตอบจากเสียง" : guessed ? "ส่งคำตอบแล้ว" : "รอคนข้างบ้านส่งคำตอบ"}</div>`}${guessAnswers()}</section><aside class="panel host-judge"><h2>สำหรับ Host</h2><p>ใช้เมื่อเล่นผ่าน Discord หรือพูดคำตอบต่อหน้ากัน</p>${isHost() ? manual ? `<div class="judge-buttons"><button class="btn success jumbo" onclick="action('/api/guess/manual',{isCorrect:true})">✅ ตอบถูก</button><button class="btn danger jumbo" onclick="action('/api/guess/manual',{isCorrect:false})">❌ ตอบผิด</button></div>` : `<button class="btn secondary jumbo" onclick="action('/api/guess/skip')">ข้าม</button>` : `<p class="helper">Host เป็นผู้ควบคุมส่วนนี้</p>`}</aside></main>`);
};
const resultView = () => {
  const result = state.room.round.result;
  const neighborWin = result.winner === "neighbor";
  return layout(`<main class="result-page"><section class="panel result-card"><div class="winner-icon">${neighborWin ? "🕵️" : "🏡"}</div><span class="eyebrow">GAME SUMMARY</span><h1>${neighborWin ? "ฝ่ายคนข้างบ้านชนะ!" : "ฝ่ายคนบ้านเดียวกันชนะ!"}</h1><p>${escapeHtml(result.reason)}</p><div class="summary-grid"><div><span>จำนวนรอบที่เล่น</span><strong>${result.roundsPlayed} รอบ</strong></div><div><span>เวลาที่ใช้ทั้งหมด</span><strong>${formatTime(result.totalSeconds)}</strong></div><div><span>คนเริ่มเกม</span><strong>${escapeHtml(playerName(result.startingPlayerId))}</strong></div><div><span>คำลับ</span><strong>${escapeHtml(result.secretWord)}</strong></div><div class="wide"><span>คนข้างบ้าน</span><strong>${result.neighborIds.map(playerName).map(escapeHtml).join(", ")}</strong></div></div>${result.guesses?.length ? `<h3>คำตอบของคนข้างบ้าน</h3>${guessAnswers()}` : ""}<div class="result-actions">${isHost() ? `<button class="btn primary jumbo" onclick="action('/api/game/reset')">เล่นใหม่</button>` : `<p>รอ Host เริ่มเกมใหม่ในห้องเดิม</p>`}<button class="btn ghost" onclick="leaveRoom()">กลับ Lobby</button></div></section></main>`);
};
const closedView = () => layout(`<main class="center-page"><section class="panel closed-card"><div>🚪</div><h1>ห้องถูกปิดแล้ว</h1><p>${escapeHtml(state.closedMessage)}</p><button class="btn primary jumbo" onclick="goLobby()">กลับ Lobby</button></section></main>`);

const render = () => {
  if (state.closedMessage) return void (app.innerHTML = closedView());
  if (!state.room) {
    app.innerHTML = state.createSetup ? createSetupView() : state.routeCode ? joinOnlyView() : homeView();
    return;
  }
  const views = { lobby: lobbyView, reveal: revealView, playing: gameView, voting: voteView, vote_reveal: voteRevealView, neighbor_guess: guessView, result: resultView };
  app.innerHTML = (views[state.room.status] || lobbyView)();
};
const tryReconnect = async () => {
  if (!state.routeCode) return render();
  const id = localStorage.getItem(storageKey(state.routeCode));
  if (!id) return render();
  try {
    const data = await api("/api/rooms/join", { roomCode: state.routeCode, playerId: id });
    joinCreatedRoom(data.room, data.playerId);
  } catch { render(); }
};
tryReconnect();
