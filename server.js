import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 4173);

const rooms = new Map();
const streams = new Map();
const timers = new Map();

const words = [
  "แมว", "หมา", "ต้นไม้", "ยางลบ", "โทรศัพท์", "รถยนต์", "ข้าว", "พระจันทร์",
  "รองเท้า", "แก้วน้ำ", "นาฬิกา", "หมอน", "กุญแจ", "กระเป๋า", "ดินสอ", "ร่ม",
  "จักรยาน", "สบู่", "เทียน", "หนังสือ", "หน้าต่าง", "เก้าอี้", "โต๊ะ", "ไฟฉาย",
  "แตงโม", "กาแฟ", "ปลา", "ทะเล", "ภูเขา", "ดาว", "เมฆ", "สะพาน",
  "กล้อง", "หูฟัง", "พัดลม", "ตู้เย็น", "ขนมปัง", "ไข่", "ช้อน", "แปรงสีฟัน",
  "กระดาษ", "ดอกไม้", "เงิน", "บัตร", "เตียง", "ถุงเท้า", "หมวก", "ประตู",
  "ลิฟต์", "สนาม", "รถไฟ", "เครื่องบิน", "จาน", "กระจก", "ขวดน้ำ", "จดหมาย",
  "ตุ๊กตา", "ลูกบอล", "คอมพิวเตอร์", "ปากกา", "นม", "ฝน", "แดด", "ถนน"
];

const json = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
};

const uid = (prefix) => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
const roomCode = () => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i += 1) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? roomCode() : code;
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || min));
const readBody = async (req) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  return raw ? JSON.parse(raw) : {};
};

const defaultSettings = (settings = {}) => ({
  maxPlayers: clamp(settings.maxPlayers ?? 20, 3, 20),
  neighborCount: clamp(settings.neighborCount ?? 1, 1, 6),
  speechTimerEnabled: Boolean(settings.speechTimerEnabled),
  speechSecondsPerTurn: 30,
  speechRounds: 3
});

const publicRoom = (room) => {
  const round = room.round;
  return {
    code: room.code,
    hostPlayerId: room.hostPlayerId,
    status: room.status,
    settings: room.settings,
    players: room.players.map(({ id, name, isHost, isConnected, joinedAt }) => ({ id, name, isHost, isConnected, joinedAt })),
    round: round ? {
      id: round.id,
      voteTargetCount: round.neighborIds.length,
      votesSubmitted: round.votes.size,
      guessedPlayerIds: [...round.guesses.keys()],
      capturedIds: round.capturedIds,
      timer: round.timer,
      result: round.result
    } : null
  };
};

const privateState = (room, playerId) => {
  const role = room.round?.roles.get(playerId) || null;
  return {
    playerId,
    isHost: room.hostPlayerId === playerId,
    role,
    secretWord: role === "normal" ? room.round.secretWord : null
  };
};

const sendRoom = (room) => {
  const clients = streams.get(room.code) || new Set();
  for (const client of clients) {
    const payload = {
      room: publicRoom(room),
      me: privateState(room, client.playerId)
    };
    client.res.write(`event: state\ndata: ${JSON.stringify(payload)}\n\n`);
  }
};

const error = (message, status = 400) => ({ status, message });
const getRoom = (code) => {
  const room = rooms.get(String(code || "").toUpperCase());
  if (!room) throw error("ไม่พบห้องนี้", 404);
  return room;
};
const getPlayer = (room, playerId) => {
  const player = room.players.find((item) => item.id === playerId);
  if (!player) throw error("ไม่พบผู้เล่นในห้องนี้", 404);
  return player;
};
const requireHost = (room, playerId) => {
  if (room.hostPlayerId !== playerId) throw error("เฉพาะเจ้าของห้องเท่านั้น", 403);
};

const validateSettings = (room, nextSettings) => {
  const settings = { ...room.settings, ...defaultSettings(nextSettings) };
  settings.maxPlayers = clamp(nextSettings.maxPlayers ?? settings.maxPlayers, 3, 20);
  settings.neighborCount = clamp(nextSettings.neighborCount ?? settings.neighborCount, 1, Math.max(1, settings.maxPlayers - 1));
  settings.speechTimerEnabled = Boolean(nextSettings.speechTimerEnabled);
  return settings;
};

const stopTimer = (room) => {
  const handle = timers.get(room.code);
  if (handle) clearInterval(handle);
  timers.delete(room.code);
};

const startTimerLoop = (room) => {
  stopTimer(room);
  if (!room.round?.timer?.enabled) return;
  const handle = setInterval(() => {
    const timer = room.round?.timer;
    if (!timer || timer.status === "completed" || timer.status === "paused") return;
    if (timer.status === "countdown") {
      timer.countdownSecondsRemaining -= 1;
      if (timer.countdownSecondsRemaining <= 0) {
        timer.status = "speaking";
        timer.secondsRemaining = room.settings.speechSecondsPerTurn;
      }
      sendRoom(room);
      return;
    }
    if (timer.status === "speaking") {
      timer.secondsRemaining -= 1;
      if (timer.secondsRemaining <= 0) advanceSpeaker(room);
      sendRoom(room);
    }
  }, 1000);
  timers.set(room.code, handle);
};

const advanceSpeaker = (room) => {
  const timer = room.round?.timer;
  if (!timer) return;
  const nextIndex = timer.currentPlayerIndex + 1;
  if (nextIndex >= timer.order.length) {
    timer.currentSpeechRound += 1;
    timer.currentPlayerIndex = 0;
  } else {
    timer.currentPlayerIndex = nextIndex;
  }
  if (timer.currentSpeechRound > timer.totalSpeechRounds) {
    timer.status = "completed";
    timer.currentPlayerId = null;
    timer.secondsRemaining = 0;
    timer.countdownSecondsRemaining = 0;
    stopTimer(room);
    return;
  }
  timer.currentPlayerId = timer.order[timer.currentPlayerIndex];
  timer.status = "countdown";
  timer.countdownSecondsRemaining = 3;
  timer.secondsRemaining = room.settings.speechSecondsPerTurn;
};

const startRound = (room) => {
  if (room.players.length < 3) throw error("ต้องมีผู้เล่นอย่างน้อย 3 คน");
  const maxNeighbors = Math.max(1, room.players.length - 1);
  const neighborCount = clamp(room.settings.neighborCount, 1, maxNeighbors);
  const shuffled = [...room.players].sort(() => Math.random() - 0.5);
  const neighborIds = shuffled.slice(0, neighborCount).map((player) => player.id);
  const roles = new Map(room.players.map((player) => [player.id, neighborIds.includes(player.id) ? "neighbor" : "normal"]));
  const timer = room.settings.speechTimerEnabled ? {
    enabled: true,
    status: "countdown",
    currentPlayerId: room.players[0].id,
    currentPlayerIndex: 0,
    currentSpeechRound: 1,
    totalSpeechRounds: room.settings.speechRounds,
    secondsRemaining: room.settings.speechSecondsPerTurn,
    countdownSecondsRemaining: 3,
    order: room.players.map((player) => player.id)
  } : {
    enabled: false,
    status: "idle",
    currentPlayerId: null,
    currentPlayerIndex: 0,
    currentSpeechRound: 0,
    totalSpeechRounds: room.settings.speechRounds,
    secondsRemaining: 0,
    countdownSecondsRemaining: 0,
    order: []
  };
  room.status = "playing";
  room.round = {
    id: uid("round"),
    secretWord: words[Math.floor(Math.random() * words.length)],
    roles,
    neighborIds,
    votes: new Map(),
    guesses: new Map(),
    capturedIds: [],
    timer,
    result: null,
    startedAt: new Date().toISOString()
  };
  if (timer.enabled) startTimerLoop(room);
};

const tallyVotes = (room) => {
  const round = room.round;
  const counts = new Map();
  for (const targets of round.votes.values()) {
    for (const target of targets) counts.set(target, (counts.get(target) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const needed = round.neighborIds.length;
  if (ranked.length < needed) return { tied: true, capturedIds: [] };
  const cutoff = ranked[needed - 1][1];
  const aboveCutoff = ranked.filter(([, count]) => count >= cutoff);
  if (aboveCutoff.length > needed) return { tied: true, capturedIds: aboveCutoff.map(([id]) => id) };
  return { tied: false, capturedIds: ranked.slice(0, needed).map(([id]) => id) };
};

const finishVoting = (room) => {
  const round = room.round;
  const { tied, capturedIds } = tallyVotes(room);
  round.capturedIds = capturedIds;
  const capturedAll = !tied && round.neighborIds.every((id) => capturedIds.includes(id)) && capturedIds.every((id) => round.neighborIds.includes(id));
  if (!capturedAll) {
    room.status = "result";
    round.result = {
      winner: "neighbor",
      reason: tied ? "คะแนนโหวตเสมอ จึงจับคนข้างบ้านได้ไม่ครบ" : "จับคนข้างบ้านได้ไม่ครบ",
      secretWord: round.secretWord,
      neighborIds: round.neighborIds,
      capturedIds
    };
  } else {
    room.status = "neighbor_guess";
  }
};

const finishGuessesIfReady = (room) => {
  const round = room.round;
  const allGuessed = round.neighborIds.every((id) => round.guesses.has(id));
  const anyCorrect = [...round.guesses.values()].some((guess) => guess.isCorrect);
  if (!allGuessed && !anyCorrect) return;
  room.status = "result";
  round.result = {
    winner: anyCorrect ? "neighbor" : "normal",
    reason: anyCorrect ? "คนข้างบ้านเดาคำลับถูก" : "จับครบและคนข้างบ้านเดาคำลับไม่ถูก",
    secretWord: round.secretWord,
    neighborIds: round.neighborIds,
    capturedIds: round.capturedIds,
    guesses: [...round.guesses.entries()].map(([playerId, guess]) => ({ playerId, ...guess }))
  };
};

const handlers = {
  "POST /api/rooms": async (req, res) => {
    const body = await readBody(req);
    const code = roomCode();
    const player = {
      id: uid("player"),
      name: String(body.playerName || "เจ้าของห้อง").trim().slice(0, 24),
      isHost: true,
      isConnected: true,
      joinedAt: new Date().toISOString()
    };
    const room = {
      code,
      hostPlayerId: player.id,
      status: "lobby",
      settings: defaultSettings(body.settings),
      players: [player],
      round: null,
      createdAt: new Date().toISOString()
    };
    rooms.set(code, room);
    json(res, 201, { room: publicRoom(room), playerId: player.id });
  },
  "POST /api/rooms/join": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    if (room.players.length >= room.settings.maxPlayers && !room.players.some((player) => player.id === body.playerId)) {
      throw error("ห้องเต็มแล้ว");
    }
    if (room.status !== "lobby" && !room.players.some((player) => player.id === body.playerId)) {
      throw error("เกมเริ่มแล้ว กรุณารอรอบถัดไป");
    }
    let player = body.playerId ? room.players.find((item) => item.id === body.playerId) : null;
    if (!player) {
      player = {
        id: uid("player"),
        name: String(body.playerName || "ผู้เล่น").trim().slice(0, 24),
        isHost: false,
        isConnected: true,
        joinedAt: new Date().toISOString()
      };
      room.players.push(player);
    } else {
      if (body.playerName) player.name = String(body.playerName).trim().slice(0, 24);
      player.isConnected = true;
    }
    sendRoom(room);
    json(res, 200, { room: publicRoom(room), playerId: player.id });
  },
  "POST /api/rooms/settings": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    requireHost(room, body.playerId);
    if (room.status !== "lobby") throw error("แก้ตั้งค่าได้เฉพาะใน Lobby");
    room.settings = validateSettings(room, body.settings || {});
    sendRoom(room);
    json(res, 200, { room: publicRoom(room) });
  },
  "POST /api/game/start": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    requireHost(room, body.playerId);
    stopTimer(room);
    startRound(room);
    sendRoom(room);
    json(res, 200, { room: publicRoom(room) });
  },
  "POST /api/game/vote/start": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    requireHost(room, body.playerId);
    if (room.status !== "playing") throw error("ยังเริ่มโหวตไม่ได้");
    room.status = "voting";
    stopTimer(room);
    sendRoom(room);
    json(res, 200, { room: publicRoom(room) });
  },
  "POST /api/vote": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    getPlayer(room, body.playerId);
    if (room.status !== "voting") throw error("ยังไม่ถึงช่วงโหวต");
    const targets = Array.isArray(body.targetPlayerIds) ? body.targetPlayerIds : [];
    if (targets.length !== room.round.neighborIds.length) throw error(`ต้องเลือก ${room.round.neighborIds.length} คน`);
    if (new Set(targets).size !== targets.length) throw error("เลือกผู้เล่นซ้ำไม่ได้");
    targets.forEach((id) => getPlayer(room, id));
    room.round.votes.set(body.playerId, targets);
    if (room.round.votes.size >= room.players.length) finishVoting(room);
    sendRoom(room);
    json(res, 200, { room: publicRoom(room) });
  },
  "POST /api/vote/finish": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    requireHost(room, body.playerId);
    if (room.status !== "voting") throw error("ยังไม่ถึงช่วงโหวต");
    finishVoting(room);
    sendRoom(room);
    json(res, 200, { room: publicRoom(room) });
  },
  "POST /api/guess": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    if (room.status !== "neighbor_guess") throw error("ยังไม่ถึงช่วงเดาคำ");
    if (!room.round.neighborIds.includes(body.playerId)) throw error("เฉพาะคนข้างบ้านเท่านั้น");
    const guessedWord = String(body.guessedWord || "").trim();
    if (!guessedWord) throw error("กรุณาใส่คำที่เดา");
    room.round.guesses.set(body.playerId, {
      guessedWord,
      isCorrect: guessedWord.replace(/\s/g, "") === room.round.secretWord.replace(/\s/g, "")
    });
    finishGuessesIfReady(room);
    sendRoom(room);
    json(res, 200, { room: publicRoom(room) });
  },
  "POST /api/game/reset": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    requireHost(room, body.playerId);
    stopTimer(room);
    room.status = "lobby";
    room.round = null;
    sendRoom(room);
    json(res, 200, { room: publicRoom(room) });
  },
  "POST /api/timer/pause": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    requireHost(room, body.playerId);
    if (room.round?.timer?.enabled) room.round.timer.status = "paused";
    sendRoom(room);
    json(res, 200, { room: publicRoom(room) });
  },
  "POST /api/timer/resume": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    requireHost(room, body.playerId);
    const timer = room.round?.timer;
    if (timer?.enabled && timer.status === "paused") timer.status = timer.countdownSecondsRemaining > 0 ? "countdown" : "speaking";
    sendRoom(room);
    json(res, 200, { room: publicRoom(room) });
  },
  "POST /api/timer/skip": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    requireHost(room, body.playerId);
    if (room.round?.timer?.enabled) advanceSpeaker(room);
    sendRoom(room);
    json(res, 200, { room: publicRoom(room) });
  }
};

const serveStatic = async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
  const safePath = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) return json(res, 403, { message: "Forbidden" });
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
    res.writeHead(200, { "content-type": `${types[ext] || "application/octet-stream"}; charset=utf-8` });
    res.end(data);
  } catch {
    res.writeHead(302, { location: "/" });
    res.end();
  }
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname === "/api/events") {
      const room = getRoom(url.searchParams.get("roomCode"));
      const playerId = url.searchParams.get("playerId");
      getPlayer(room, playerId);
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      const client = { playerId, res };
      if (!streams.has(room.code)) streams.set(room.code, new Set());
      streams.get(room.code).add(client);
      res.write(`event: state\ndata: ${JSON.stringify({ room: publicRoom(room), me: privateState(room, playerId) })}\n\n`);
      req.on("close", () => streams.get(room.code)?.delete(client));
      return;
    }
    const key = `${req.method} ${url.pathname}`;
    if (handlers[key]) return await handlers[key](req, res);
    return serveStatic(req, res);
  } catch (err) {
    const status = err.status || 500;
    json(res, status, { message: err.message || "Server error" });
  }
});

server.listen(port, () => {
  console.log(`คนข้างบ้าน running at http://localhost:${port}`);
});
