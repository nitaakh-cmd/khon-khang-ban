import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const port = Number(globalThis.process?.env?.PORT || 4173);

const rooms = new Map();
const streams = new Map();
const timers = new Map();

const WORD_CATEGORIES = {
  animals: {
    label: "🐶 สัตว์โลกน่ารัก",
    words: ["แมว", "สุนัข", "กระต่าย", "แพนด้า", "ช้าง", "ยีราฟ", "สิงโต", "เสือ", "ม้าลาย", "ฮิปโป", "จิงโจ้", "โคอาลา", "เพนกวิน", "โลมา", "วาฬ", "ปลาหมึก", "เต่าทะเล", "นาก", "แฮมสเตอร์", "เม่น", "นกฮูก", "อัลปากา", "จิ้งจอก", "แรคคูน"]
  },
  home: {
    label: "🏠 บ้านของเรา",
    words: ["โซฟา", "โทรทัศน์", "ตู้เย็น", "หมอน", "ผ้าห่ม", "เตียง", "โต๊ะกินข้าว", "เก้าอี้", "พัดลม", "เครื่องปรับอากาศ", "ไมโครเวฟ", "หม้อหุงข้าว", "เครื่องซักผ้า", "ไม้กวาด", "กระจก", "โคมไฟ", "นาฬิกา", "กุญแจ", "ร่ม", "แจกัน", "ช้อน", "จาน", "แก้วน้ำ", "แปรงสีฟัน"]
  },
  office: {
    label: "💼 ชีวิตออฟฟิศ",
    words: ["คอมพิวเตอร์", "คีย์บอร์ด", "เมาส์", "เครื่องพิมพ์", "เครื่องถ่ายเอกสาร", "โปรเจกเตอร์", "ปากกา", "ดินสอ", "ยางลบ", "สมุดโน้ต", "แฟ้มเอกสาร", "คลิปหนีบกระดาษ", "เครื่องเย็บกระดาษ", "โต๊ะทำงาน", "เก้าอี้สำนักงาน", "บัตรพนักงาน", "แก้วกาแฟ", "โพสต์อิท", "หูฟัง", "ไวท์บอร์ด", "ซองจดหมาย", "ตรายาง", "เครื่องคิดเลข", "ปฏิทิน"]
  },
  food: {
    label: "🍜 อาหาร",
    words: ["ต้มยำกุ้ง", "ผัดไทย", "ข้าวมันไก่", "ส้มตำ", "ซูชิ", "ราเมง", "พิซซ่า", "แฮมเบอร์เกอร์", "ทาโก้", "พาสต้า", "ข้าวผัด", "แกงเขียวหวาน", "ติ่มซำ", "บิบิมบับ", "ครัวซองต์", "แพนเค้ก", "ไอศกรีม", "โดนัท", "ช็อกโกแลต", "ก๋วยเตี๋ยว", "ข้าวเหนียวมะม่วง", "ซาโมซ่า", "เคบับ", "ฟิชแอนด์ชิปส์"]
  },
  seven: {
    label: "🛒 เซเว่นจ๋าพี่มาแล้ว",
    words: ["แซนด์วิช", "ข้าวกล่อง", "บะหมี่กึ่งสำเร็จรูป", "ไส้กรอก", "ซาลาเปา", "ไข่ต้ม", "นมสด", "โยเกิร์ต", "น้ำอัดลม", "น้ำเปล่า", "กาแฟ", "ชาเขียว", "ขนมปัง", "มันฝรั่งทอด", "ช็อกโกแลต", "ลูกอม", "หมากฝรั่ง", "ทิชชู", "ยาสีฟัน", "สบู่", "แชมพู", "ถ่านไฟฉาย", "สายชาร์จ", "ร่มพับ"]
  },
  olympics: {
    label: "🏅 โอลิมปิก",
    words: ["ฟุตบอล", "บาสเกตบอล", "วอลเลย์บอล", "ว่ายน้ำ", "กรีฑา", "แบดมินตัน", "เทนนิส", "เทเบิลเทนนิส", "มวยสากล", "ยกน้ำหนัก", "ยิงธนู", "ฟันดาบ", "ยิมนาสติก", "จักรยาน", "พายเรือ", "เรือใบ", "ยูโด", "เทควันโด", "สเกตบอร์ด", "ปีนหน้าผา", "เซิร์ฟ", "ฮอกกี้", "รักบี้", "ไตรกีฬา"]
  }
};
const CATEGORY_IDS = Object.keys(WORD_CATEGORIES);
const AVATARS = ["😀", "😎", "🥳", "🤓", "😊", "🧑‍🎨", "🧑‍🚀", "🧑‍🍳", "🧙", "🦸", "🐶", "🐱", "🐰", "🐼", "🦊", "🐸", "🐵", "🐧", "🦄", "🐙", "🍄", "🌻", "⭐", "🌈", "🍉", "🧸", "🚲", "🎈", "💡", "🎁", "☕", "🎮", "🪴", "🏠", "🚀", "🍀"];

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
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
const cleanCategories = (value) => {
  const values = Array.isArray(value) ? value : [];
  if (values.includes("all")) return ["all"];
  const valid = [...new Set(values.filter((id) => CATEGORY_IDS.includes(id)))];
  return valid.length ? valid : ["all"];
};
const defaultSettings = (settings = {}) => ({
  roomName: String(settings.roomName || "ห้องนั่งเล่น").trim().slice(0, 40) || "ห้องนั่งเล่น",
  maxPlayers: clamp(settings.maxPlayers ?? 20, 3, 20),
  neighborCount: clamp(settings.neighborCount ?? 1, 1, 6),
  speechTimerEnabled: settings.speechTimerEnabled === undefined ? true : Boolean(settings.speechTimerEnabled),
  speechSecondsPerTurn: clamp(settings.speechSecondsPerTurn ?? 20, 5, 120),
  speechRounds: clamp(settings.speechRounds ?? 1, 1, 3),
  selectedCategories: cleanCategories(settings.selectedCategories)
});
const playerPublic = ({ id, name, avatar, isHost, isConnected, joinedAt }) => ({ id, name, avatar, isHost, isConnected, joinedAt });
const elapsedSeconds = (round) => Math.max(0, Math.round((Date.now() - new Date(round.startedAt).getTime()) / 1000));

const publicRoom = (room) => {
  const round = room.round;
  return {
    code: room.code,
    hostPlayerId: room.hostPlayerId,
    status: room.status,
    settings: room.settings,
    categories: CATEGORY_IDS.map((id) => ({ id, label: WORD_CATEGORIES[id].label })),
    avatars: AVATARS,
    players: room.players.map(playerPublic),
    round: round ? {
      id: round.id,
      categoryId: round.categoryId,
      categoryLabel: WORD_CATEGORIES[round.categoryId].label,
      voteTargetCount: round.neighborIds.length,
      votesSubmitted: round.votes.size,
      readyPlayerIds: [...round.readyPlayerIds],
      readyCount: round.readyPlayerIds.size,
      guessedPlayerIds: [...round.guesses.keys()],
      guesses: [...round.guesses.entries()].map(([id, guess]) => ({ playerId: id, ...guess })),
      capturedIds: round.capturedIds,
      voteOutcome: round.voteOutcome,
      turn: round.turn,
      timer: round.timer,
      manualJudging: round.manualJudging,
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
  for (const client of streams.get(room.code) || []) {
    client.res.write(`event: state\ndata: ${JSON.stringify({ room: publicRoom(room), me: privateState(room, client.playerId) })}\n\n`);
  }
};
const closeRoom = (room, message = "Host ได้ออกจากเกม ห้องนี้ถูกปิดแล้ว") => {
  stopTimer(room);
  for (const client of streams.get(room.code) || []) {
    client.res.write(`event: room_closed\ndata: ${JSON.stringify({ message })}\n\n`);
  }
  streams.delete(room.code);
  rooms.delete(room.code);
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
  if (room.hostPlayerId !== playerId) throw error("เฉพาะ Host เท่านั้น", 403);
};
const validateSettings = (room, next = {}) => {
  const settings = defaultSettings({ ...room.settings, ...next });
  settings.neighborCount = clamp(settings.neighborCount, 1, Math.max(1, settings.maxPlayers - 1));
  return settings;
};
const stopTimer = (room) => {
  const handle = timers.get(room.code);
  if (handle) clearInterval(handle);
  timers.delete(room.code);
};
const nextTurn = (room) => {
  const turn = room.round?.turn;
  if (!turn || turn.completed) return;
  turn.currentIndex += 1;
  if (turn.currentIndex >= turn.order.length) {
    turn.currentIndex = 0;
    turn.currentRound += 1;
  }
  if (turn.currentRound > turn.totalRounds) {
    turn.completed = true;
    turn.currentPlayerId = null;
    turn.nextPlayerId = null;
    if (room.round.timer) {
      room.round.timer.status = "completed";
      room.round.timer.secondsRemaining = 0;
      room.round.timer.countdownSecondsRemaining = 0;
    }
    stopTimer(room);
    return;
  }
  turn.currentPlayerId = turn.order[turn.currentIndex];
  const isLast = turn.currentRound === turn.totalRounds && turn.currentIndex === turn.order.length - 1;
  turn.nextPlayerId = isLast ? null : turn.order[(turn.currentIndex + 1) % turn.order.length];
  if (room.round.timer) {
    room.round.timer.status = "countdown";
    room.round.timer.countdownSecondsRemaining = 3;
    room.round.timer.secondsRemaining = room.settings.speechSecondsPerTurn;
  }
};
const startTimerLoop = (room) => {
  stopTimer(room);
  if (!room.round?.timer?.enabled) return;
  timers.set(room.code, setInterval(() => {
    const timer = room.round?.timer;
    if (!timer || ["completed", "paused", "idle"].includes(timer.status)) return;
    if (timer.status === "countdown") {
      timer.countdownSecondsRemaining -= 1;
      if (timer.countdownSecondsRemaining <= 0) {
        timer.status = "speaking";
        timer.secondsRemaining = room.settings.speechSecondsPerTurn;
      }
    } else if (timer.status === "speaking") {
      timer.secondsRemaining -= 1;
      if (timer.secondsRemaining <= 0) nextTurn(room);
    }
    sendRoom(room);
  }, 1000));
};
const pickSecret = (room) => {
  let categoryPool = room.settings.selectedCategories;
  if (categoryPool.includes("all")) categoryPool = CATEGORY_IDS;
  const availableCategories = categoryPool.filter((id) => WORD_CATEGORIES[id].words.some((word) => !room.usedWords.has(word)));
  if (!availableCategories.length) room.usedWords.clear();
  const pool = availableCategories.length ? availableCategories : categoryPool;
  const categoryId = pool[Math.floor(Math.random() * pool.length)];
  const availableWords = WORD_CATEGORIES[categoryId].words.filter((word) => !room.usedWords.has(word));
  const words = availableWords.length ? availableWords : WORD_CATEGORIES[categoryId].words;
  const secretWord = words[Math.floor(Math.random() * words.length)];
  room.usedWords.add(secretWord);
  return { categoryId, secretWord };
};
const startRound = (room) => {
  if (room.players.length < 3) throw error("ต้องมีผู้เล่นอย่างน้อย 3 คน");
  const neighborCount = clamp(room.settings.neighborCount, 1, Math.max(1, room.players.length - 1));
  const shuffled = [...room.players].sort(() => Math.random() - 0.5);
  const neighborIds = shuffled.slice(0, neighborCount).map((player) => player.id);
  const roles = new Map(room.players.map((player) => [player.id, neighborIds.includes(player.id) ? "neighbor" : "normal"]));
  const order = [...room.players].sort(() => Math.random() - 0.5).map((player) => player.id);
  const { categoryId, secretWord } = pickSecret(room);
  room.status = "reveal";
  room.round = {
    id: uid("round"),
    secretWord,
    categoryId,
    roles,
    neighborIds,
    votes: new Map(),
    readyPlayerIds: new Set(),
    guesses: new Map(),
    capturedIds: [],
    voteOutcome: null,
    manualJudging: false,
    turn: {
      order,
      currentIndex: 0,
      currentRound: 1,
      totalRounds: room.settings.speechRounds,
      currentPlayerId: order[0],
      nextPlayerId: order.length > 1 ? order[1] : null,
      completed: false
    },
    timer: {
      enabled: room.settings.speechTimerEnabled,
      status: "idle",
      secondsRemaining: room.settings.speechSecondsPerTurn,
      totalSeconds: room.settings.speechSecondsPerTurn,
      countdownSecondsRemaining: 3
    },
    result: null,
    startedAt: new Date().toISOString()
  };
};
const beginPlayingIfReady = (room) => {
  if (room.status !== "reveal" || room.round.readyPlayerIds.size < room.players.length) return;
  room.status = "playing";
  if (room.round.timer.enabled) {
    room.round.timer.status = "countdown";
    startTimerLoop(room);
  }
};
const tallyVotes = (room) => {
  const counts = new Map();
  for (const targets of room.round.votes.values()) {
    for (const target of targets) counts.set(target, (counts.get(target) || 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const needed = room.round.neighborIds.length;
  if (ranked.length < needed) return { tied: true, capturedIds: [] };
  const cutoff = ranked[needed - 1][1];
  const tiedAtCutoff = ranked.filter(([, count]) => count >= cutoff);
  if (tiedAtCutoff.length > needed) return { tied: true, capturedIds: tiedAtCutoff.map(([id]) => id) };
  return { tied: false, capturedIds: ranked.slice(0, needed).map(([id]) => id) };
};
const makeResult = (room, winner, reason) => {
  room.status = "result";
  room.round.result = {
    winner,
    reason,
    secretWord: room.round.secretWord,
    categoryLabel: WORD_CATEGORIES[room.round.categoryId].label,
    neighborIds: room.round.neighborIds,
    capturedIds: room.round.capturedIds,
    guesses: [...room.round.guesses.entries()].map(([playerId, guess]) => ({ playerId, ...guess })),
    roundsPlayed: room.settings.speechRounds,
    totalSeconds: elapsedSeconds(room.round),
    startingPlayerId: room.round.turn.order[0]
  };
};
const finishVoting = (room) => {
  const { tied, capturedIds } = tallyVotes(room);
  room.round.capturedIds = capturedIds;
  const capturedAll = !tied && room.round.neighborIds.every((id) => capturedIds.includes(id)) && capturedIds.every((id) => room.round.neighborIds.includes(id));
  room.round.voteOutcome = { tied, capturedAll, capturedIds };
  room.status = "vote_reveal";
};
const finishGuessesIfReady = (room) => {
  const allGuessed = room.round.neighborIds.every((id) => room.round.guesses.has(id));
  const anyCorrect = [...room.round.guesses.values()].some((guess) => guess.isCorrect);
  if (!allGuessed && !anyCorrect) return;
  makeResult(room, anyCorrect ? "neighbor" : "normal", anyCorrect ? "คนข้างบ้านทายคำลับถูก" : "คนข้างบ้านทายคำลับไม่ถูก");
};

const handlers = {
  "POST /api/rooms": async (req, res) => {
    const body = await readBody(req);
    const code = roomCode();
    const player = { id: uid("player"), name: String(body.playerName || "Host").trim().slice(0, 24), avatar: AVATARS[0], isHost: true, isConnected: true, joinedAt: new Date().toISOString() };
    const room = { code, hostPlayerId: player.id, status: "lobby", settings: defaultSettings(body.settings), players: [player], round: null, usedWords: new Set(), createdAt: new Date().toISOString() };
    rooms.set(code, room);
    json(res, 201, { room: publicRoom(room), playerId: player.id });
  },
  "POST /api/rooms/join": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    let player = body.playerId ? room.players.find((item) => item.id === body.playerId) : null;
    if (!player && room.players.length >= room.settings.maxPlayers) throw error("ห้องเต็มแล้ว");
    if (!player && room.status !== "lobby") throw error("เกมเริ่มแล้ว กรุณารอรอบถัดไป");
    if (!player) {
      player = { id: uid("player"), name: String(body.playerName || "ผู้เล่น").trim().slice(0, 24), avatar: AVATARS[room.players.length % AVATARS.length], isHost: false, isConnected: true, joinedAt: new Date().toISOString() };
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
    if (room.status !== "lobby") throw error("แก้การตั้งค่าได้เฉพาะในห้องรอ");
    room.settings = validateSettings(room, body.settings || {});
    sendRoom(room);
    json(res, 200, { room: publicRoom(room) });
  },
  "POST /api/players/profile": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    if (room.status !== "lobby") throw error("เปลี่ยนโปรไฟล์ได้เฉพาะในห้องรอ");
    const player = getPlayer(room, body.playerId);
    const name = String(body.name || "").trim().slice(0, 24);
    if (!name) throw error("กรุณาใส่ชื่อ");
    player.name = name;
    if (AVATARS.includes(body.avatar)) player.avatar = body.avatar;
    sendRoom(room);
    json(res, 200, { room: publicRoom(room) });
  },
  "POST /api/rooms/leave": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    const player = getPlayer(room, body.playerId);
    if (player.isHost) closeRoom(room);
    else {
      room.players = room.players.filter((item) => item.id !== player.id);
      sendRoom(room);
    }
    json(res, 200, { ok: true });
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
  "POST /api/game/ready": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    getPlayer(room, body.playerId);
    if (room.status !== "reveal") throw error("ยังไม่ถึงช่วงเตรียมพร้อม");
    room.round.readyPlayerIds.add(body.playerId);
    beginPlayingIfReady(room);
    sendRoom(room);
    json(res, 200, { room: publicRoom(room) });
  },
  "POST /api/game/turn/next": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    requireHost(room, body.playerId);
    if (room.status !== "playing") throw error("ไม่ได้อยู่ในช่วงใบ้คำ");
    nextTurn(room);
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
    if (targets.length !== room.round.neighborIds.length || new Set(targets).size !== targets.length) throw error(`ต้องเลือก ${room.round.neighborIds.length} คน`);
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
    if (room.status !== "voting" || room.round.votes.size < room.players.length) throw error("กรุณารอให้ทุกคนโหวต");
    finishVoting(room);
    sendRoom(room);
    json(res, 200, { room: publicRoom(room) });
  },
  "POST /api/vote/reveal/continue": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    requireHost(room, body.playerId);
    if (room.status !== "vote_reveal") throw error("ยังไม่ถึงช่วงเฉลยโหวต");
    if (room.round.voteOutcome.capturedAll) room.status = "neighbor_guess";
    else makeResult(room, "neighbor", room.round.voteOutcome.tied ? "คะแนนโหวตเสมอ จับคนข้างบ้านไม่ได้ครบ" : "จับคนข้างบ้านได้ไม่ครบ");
    sendRoom(room);
    json(res, 200, { room: publicRoom(room) });
  },
  "POST /api/guess": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    if (room.status !== "neighbor_guess") throw error("ยังไม่ถึงช่วงทายคำ");
    if (!room.round.neighborIds.includes(body.playerId)) throw error("เฉพาะคนข้างบ้านเท่านั้น");
    const guessedWord = String(body.guessedWord || "").trim();
    if (!guessedWord) throw error("กรุณาใส่คำตอบ");
    room.round.guesses.set(body.playerId, { guessedWord, displayAnswer: guessedWord, isCorrect: guessedWord.replace(/\s/g, "") === room.round.secretWord.replace(/\s/g, ""), source: "typed" });
    finishGuessesIfReady(room);
    sendRoom(room);
    json(res, 200, { room: publicRoom(room) });
  },
  "POST /api/guess/skip": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    requireHost(room, body.playerId);
    if (room.status !== "neighbor_guess") throw error("ยังไม่ถึงช่วงทายคำ");
    room.round.manualJudging = true;
    sendRoom(room);
    json(res, 200, { room: publicRoom(room) });
  },
  "POST /api/guess/manual": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    requireHost(room, body.playerId);
    if (room.status !== "neighbor_guess" || !room.round.manualJudging) throw error("กรุณากดข้ามก่อนตัดสิน");
    const isCorrect = Boolean(body.isCorrect);
    for (const neighborId of room.round.neighborIds) {
      if (!room.round.guesses.has(neighborId)) room.round.guesses.set(neighborId, { guessedWord: "", displayAnswer: isCorrect ? "ตอบถูก" : "ตอบผิด", isCorrect, source: "host" });
    }
    makeResult(room, isCorrect ? "neighbor" : "normal", isCorrect ? "Host ตัดสินว่าคนข้างบ้านตอบถูก" : "Host ตัดสินว่าคนข้างบ้านตอบผิด");
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
    if (room.round?.timer?.enabled && room.round.timer.status === "paused") room.round.timer.status = room.round.timer.countdownSecondsRemaining > 0 ? "countdown" : "speaking";
    sendRoom(room);
    json(res, 200, { room: publicRoom(room) });
  },
  "POST /api/timer/skip": async (req, res) => {
    const body = await readBody(req);
    const room = getRoom(body.roomCode);
    requireHost(room, body.playerId);
    nextTurn(room);
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
    const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml" };
    res.writeHead(200, {
      "content-type": `${types[path.extname(filePath)] || "application/octet-stream"}; charset=utf-8`,
      "cache-control": "no-store, no-cache, must-revalidate",
      pragma: "no-cache",
      expires: "0"
    });
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
      const player = getPlayer(room, playerId);
      player.isConnected = true;
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
      const client = { playerId, res };
      if (!streams.has(room.code)) streams.set(room.code, new Set());
      streams.get(room.code).add(client);
      res.write(`event: state\ndata: ${JSON.stringify({ room: publicRoom(room), me: privateState(room, playerId) })}\n\n`);
      req.on("close", () => {
        const roomClients = streams.get(room.code);
        roomClients?.delete(client);
        const stillConnected = [...(roomClients || [])].some((item) => item.playerId === playerId);
        if (!stillConnected && rooms.has(room.code)) {
          player.isConnected = false;
          if (player.isHost) closeRoom(room);
          else sendRoom(room);
        }
      });
      return;
    }
    const key = `${req.method} ${url.pathname}`;
    if (handlers[key]) return await handlers[key](req, res);
    return serveStatic(req, res);
  } catch (err) {
    json(res, err.status || 500, { message: err.message || "Server error" });
  }
});

server.listen(port, () => console.log(`คนข้างบ้าน running at http://localhost:${port}`));
