const infoEl = document.getElementById("info");
const resultEl = document.getElementById("result");
const timerEl = document.getElementById("timer");
const scoreEl = document.getElementById("score");
const counterInfoEl = document.getElementById("counter-info");
const votesListEl = document.getElementById("votes-list");
const timerBarEl = document.querySelector("#timer-bar > i");
const liveAvgEl = document.getElementById("live-avg");

const params = (new URL(document.location)).searchParams;
const channel = params.get("channel") || null;
const defaultTime = parseInt(params.get("time")) || 60;

// YouTube (необязательно): API-ключ + канал (@handle или ID вида UC...) либо ID трансляции
const ytKey = params.get("yt_key") || null;
const ytChannel = params.get("yt_channel") || null;
const ytVideo = params.get("yt_video") || null;
const ytEnabled = !!ytKey;

let timer = null;
let state = 0; // 0 - ожидание, 1 - голосование, 2 - результаты
let timerValue = 0;
let totalTime = 0; // полная длительность голосования (для полосы-прогресса)
let users = [];
let votes = []; // {user, rating, value}
let score = 0.0;

// Категории с значениями
const categories = {
  "кринж-контент": 1,
  "кринж-контент+": 2,
  "кринж-контент++": 3,
  "ну такое--": 4,
  "ну такое-": 5,
  "ну такое": 6,
  "ну такое+": 7,
  "ну такое++": 8,
  "нормас--": 9,
  "нормас-": 10,
  "нормас": 11,
  "нормас+": 12,
  "нормас++": 13,
  "хорошечно--": 14,
  "хорошечно-": 15,
  "хорошечно": 16,
  "хорошечно+": 17,
  "хорошечно++": 18,
  "атлична--": 19,
  "атлична-": 20,
  "атлична": 21,
  "атлична+": 22,
  "атлична++": 23,
  "гениально--": 24,
  "гениально-": 25,
  "гениально": 26
};

// Инвертированный map для поиска категории по значению
const valueToCategory = Object.fromEntries(Object.entries(categories).map(([k, v]) => [v, k.charAt(0).toUpperCase() + k.slice(1)]));

// ============================================================
// СИНОНИМЫ: альтернативные написания оценок.
// Ключ — каноническое базовое слово, значение — список синонимов.
// Плюсы/минусы подхватываются автоматически:
// "отлично++" засчитается как "атлична++" и т.д.
// Чтобы добавить новый синоним — просто допиши его в список.
// ============================================================
const aliases = {
  "атлична":       ["отлично", "отлична"],
  "хорошечно":     ["хорошо"],
  "нормас":        ["норм", "нормально"],
  "кринж-контент": ["кринж"],
  "ну такое":      ["нутакое"]
};

// Расширенный словарь: каноничные названия + все синонимы со всеми суффиксами.
// aliasLookup["отлично++"] -> "атлична++"
const aliasLookup = {};
for (const key of Object.keys(categories)) {
  aliasLookup[key] = key; // каноническое написание тоже валидно
  for (const [base, alts] of Object.entries(aliases)) {
    if (key === base || (key.startsWith(base) && /^[+-]{1,2}$/.test(key.slice(base.length)))) {
      const suffix = key.slice(base.length);
      for (const alt of alts) {
        aliasLookup[alt + suffix] = key;
      }
    }
  }
}

// Ключи от длинных к коротким, чтобы "хорошечно++" матчился раньше "хорошечно"
const aliasKeys = Object.keys(aliasLookup).sort((a, b) => b.length - a.length);

// Ищем оценку в НАЧАЛЕ сообщения. После неё допускается любой текст
// ("хорошечно за вокал"), пробел или знаки препинания ("гениально!!!").
function extractRating(msg) {
  // Плюсы/минусы через пробел: "хорошечно ++" -> "хорошечно++"
  msg = msg.replace(/\s+([+-]{1,2})(?=\s|$)/g, "$1");

  if (aliasLookup[msg] !== undefined) return aliasLookup[msg]; // точное совпадение

  for (const key of aliasKeys) {
    if (msg.startsWith(key)) {
      const next = msg.charAt(key.length);
      // граница слова: пробел или пунктуация, чтобы "нормальный" не считался за "нормально"
      if (/[\s!?.,:;)("«»]/.test(next)) return aliasLookup[key];
    }
  }
  return undefined;
}

// Анимация "подскока" счётчика при новом голосе
function bumpCounter() {
  counterInfoEl.classList.remove("bump");
  void counterInfoEl.offsetWidth; // перезапуск CSS-анимации
  counterInfoEl.classList.add("bump");
}

// Живая средняя оценка во время голосования
function updateLiveAverage() {
  if (!liveAvgEl) return;
  if (!users.length) {
    liveAvgEl.textContent = "—";
    liveAvgEl.classList.remove("tier-low", "tier-mid", "tier-high", "tick");
    return;
  }
  const average = score / users.length;
  const rounded = Math.min(26, Math.max(1, Math.round(average)));
  const category = valueToCategory[rounded] || "—";

  // Тон: 1-8 низ шкалы, 9-18 середина, 19-26 верх
  liveAvgEl.classList.remove("tier-low", "tier-mid", "tier-high");
  liveAvgEl.classList.add(rounded <= 8 ? "tier-low" : rounded <= 18 ? "tier-mid" : "tier-high");

  // Пульс только если текст реально поменялся
  if (liveAvgEl.textContent !== category) {
    liveAvgEl.textContent = category;
    liveAvgEl.classList.remove("tick");
    void liveAvgEl.offsetWidth;
    liveAvgEl.classList.add("tick");
  }
}

// uid — уникальный id голосующего (у Ютуба ники не уникальны, поэтому там id канала),
// platform — откуда голос ("twitch" / "youtube")
function messageHandler(user, message, uid = user, platform = "twitch") {
  if (state !== 1) return;
  if (users.includes(uid)) return;

  message = message.trim().toLowerCase().replace(/[\uD800-\uDFFF]/gi, '');

  // Оценка в начале сообщения (+ синонимы, + суффиксы через пробел, + текст после)
  const canonical = extractRating(message);

  if (canonical !== undefined) {
    const value = categories[canonical];
    const rating = canonical.charAt(0).toUpperCase() + canonical.slice(1);
    score += value;
    votes.push({ user, rating, value, platform });
    users.push(uid);
    counterInfoEl.innerText = users.length;
    bumpCounter();
    updateLiveAverage();
  }
}

// Команда !оценка — общая для Твича и Ютуба
function handleCommand(command, message, isMod) {
  if (!isMod || command !== "оценка") return;
  if (state === 0) {
    let time = message.split(" ")[0];
    if (time.endsWith("m") || time.endsWith("м")) {
      time = parseInt(time.slice(0, -1)) * 60;
    } else {
      time = parseInt(time);
    }
    if (!isNaN(time) && time > 0) {
      start(time);
    } else {
      start(defaultTime);
    }
  } else if (state === 1) {
    finish();
  } else if (state === 2) {
    stop();
  }
}

function init() {
  if (channel) {
    ComfyJS.onChat = (user, message, flags, self, extra) => {
      messageHandler(user, message);
    };

    ComfyJS.onCommand = (user, command, message, flags, extra) => {
      // Замените на свой ник, если нужно
      handleCommand(command, message, flags.broadcaster || flags.mod || user == "laitsberg");
    };

    ComfyJS.Init(channel);
  }

  if (ytEnabled) ytInit();
}

function start(time) {
  timer && (typeof timer === 'number' ? clearTimeout(timer) : clearInterval(timer));
  counterInfoEl.innerText = "0";
  timerValue = time;
  totalTime = time;
  timer = setInterval(onTimer, 1000);
  infoEl.classList.remove("ending");
  infoEl.style.opacity = 1;
  state = 1;
  users = [];
  votes = [];
  score = 0.0;
  updateLiveAverage();
  timerToTime();
  ytStartPolling();
}

// Конфетти для вердикта "гениально"
function spawnConfetti() {
  const colors = ["#ffd166", "#ff7a00", "#ffab40", "#7cff9b", "#ffffff"];
  for (let i = 0; i < 50; i++) {
    const c = document.createElement("i");
    c.className = "confetti";
    c.style.left = Math.random() * 100 + "%";
    c.style.background = colors[Math.floor(Math.random() * colors.length)];
    c.style.animationDelay = (Math.random() * 0.7) + "s";
    c.style.animationDuration = (1.6 + Math.random() * 1.4) + "s";
    c.style.transform = `rotate(${Math.random() * 360}deg)`;
    if (Math.random() < 0.4) c.style.borderRadius = "50%"; // часть — кружочки
    resultEl.appendChild(c);
    // самоуничтожение после падения
    c.addEventListener("animationend", () => c.remove());
  }
}

function finish() {
  timer && (typeof timer === 'number' ? clearTimeout(timer) : clearInterval(timer));

  const metaEl = document.getElementById("result-meta");
  scoreEl.classList.remove("tier-low", "tier-mid", "tier-high");

  if (users.length) {
    const average = score / users.length;
    const rounded = Math.min(26, Math.max(1, Math.round(average)));
    const category = valueToCategory[rounded] || "Неизвестно";

    // Вердикт — главный заголовок, цвет по тону оценки
    scoreEl.textContent = category;
    scoreEl.classList.add(rounded <= 8 ? "tier-low" : rounded <= 18 ? "tier-mid" : "tier-high");

    // Эпик-эффекты для крайних вердиктов
    resultEl.classList.remove("epic-good", "epic-bad");
    scoreEl.removeAttribute("data-text");
    if (rounded >= 24) {            // гениально--/-/…
      resultEl.classList.add("epic-good");
      spawnConfetti();
    } else if (rounded <= 3) {      // кринж-контент/+/++
      resultEl.classList.add("epic-bad");
      scoreEl.setAttribute("data-text", category); // для глитч-слоёв
    }

    // Мета-строка: голоса + топ категорий
    const counts = {};
    votes.forEach(v => counts[v.rating] = (counts[v.rating] || 0) + 1);
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    let meta = `Голосов: <span id="counter-result">${users.length}</span>`;
    if (top.length > 1) { // топ есть смысл показывать, только если категорий больше одной
      meta += ` · Топ: ${top.map(([cat, cnt]) => `${cat} (${cnt})`).join(", ")}`;
    }
    if (metaEl) metaEl.innerHTML = meta;

    // Список голосов
    votesListEl.innerHTML = "";
    votes.forEach(vote => {
      const li = document.createElement("li");
      li.textContent = `${vote.user}: ${vote.rating}`;
      if (vote.platform === "youtube") li.classList.add("yt");
      votesListEl.appendChild(li);
    });
  } else {
    scoreEl.textContent = "Нет оценок";
    if (metaEl) metaEl.innerHTML = "";
    votesListEl.innerHTML = "";
  }

  // Перезапуск "поп"-анимации вердикта
  scoreEl.style.animation = "none";
  void scoreEl.offsetWidth;
  scoreEl.style.animation = "";

  infoEl.classList.remove("ending");
  infoEl.style.opacity = 0;
  resultEl.style.opacity = 1;

  state = 2;
  timer = setTimeout(stop, 60000); // 60 сек на показ результата
}

function stop() {
  timer && (typeof timer === 'number' ? clearTimeout(timer) : clearInterval(timer));
  resultEl.style.opacity = 0;
  votesListEl.innerHTML = "";
  resultEl.classList.remove("epic-good", "epic-bad");
  scoreEl.removeAttribute("data-text");
  resultEl.querySelectorAll(".confetti").forEach(c => c.remove());
  infoEl.classList.remove("ending");
  state = 0;
}

function onTimer() {
  timerValue -= 1;
  if (timerValue > 0) {
    timerToTime();
  } else {
    finish();
  }
}

function timerToTime() {
  let minutes = Math.floor(timerValue / 60);
  let seconds = timerValue % 60;
  minutes = minutes.toString().padStart(2, "0");
  seconds = seconds.toString().padStart(2, "0");
  timerEl.innerText = `${minutes}:${seconds}`;

  // Полоса-прогресс под таймером
  if (timerBarEl && totalTime > 0) {
    timerBarEl.style.setProperty("--p", (timerValue / totalTime * 100) + "%");
  }
  // Последние 10 секунд — режим "на исходе"
  infoEl.classList.toggle("ending", timerValue <= 10);
}

// ============================================================
// YOUTUBE: чтение чата через YouTube Data API v3.
// Основная платформа — Твич, Ютуб стримится периодически вместе с ним.
// Поэтому в начале каждого голосования виджет проверяет, идёт ли сейчас эфир
// на Ютубе (~3 единицы квоты). Нет эфира — голосование идёт только по Твичу,
// молча, без ошибок на экране. Есть — чат Ютуба опрашивается до конца голосования.
// Каждый запрос сообщений тратит 5 единиц дневной квоты (бесплатно ~10 000).
// Если Твич не указан — опрос постоянный, чтобы ловить !оценка с Ютуба.
// ============================================================
const YT_API = "https://www.googleapis.com/youtube/v3/";
const YT_IDLE_INTERVAL = 10000;   // минимальный интервал опроса вне голосования
const YT_RETRY_INTERVAL = 30000;  // повтор, если эфир не найден / ошибка
const YT_QUOTA_RETRY = 600000;    // квота кончилась — пробуем раз в 10 минут

const yt = {
  chatId: null,
  pageToken: null,
  active: false,      // идёт цикл опроса
  sinceTime: 0,       // сообщения, отправленные раньше, игнорируем
  endedChatId: null,  // чат закончившегося эфира (Ютуб может ещё какое-то время отдавать его как живой)
};

// "Пишите оценку в чат:" -> "Пишите оценку в чат Твича или Ютуба:", пока чат Ютуба подключён
const chatNoteEl = document.getElementById("chat-note");
function ytSetConnected(connected) {
  if (chatNoteEl) chatNoteEl.textContent = connected ? "Пишите оценку в чат Твича или Ютуба:" : "Пишите оценку в чат:";
}

const ytStatusEl = document.getElementById("yt-status");
let ytStatusTimer = null;

// Короткая плашка внизу виджета — чтобы стример видел проблемы с Ютубом прямо в OBS
function ytStatus(text, isError = true) {
  (isError ? console.warn : console.log)(text);
  if (!ytStatusEl) return;
  ytStatusEl.textContent = text;
  ytStatusEl.classList.toggle("error", isError);
  ytStatusEl.classList.add("show");
  clearTimeout(ytStatusTimer);
  ytStatusTimer = setTimeout(() => ytStatusEl.classList.remove("show"), isError ? 15000 : 5000);
}

async function ytRequest(method, query) {
  const url = new URL(YT_API + method);
  for (const [k, v] of Object.entries({ ...query, key: ytKey })) url.searchParams.set(k, v);
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error?.message || `HTTP ${res.status}`);
    err.reason = data.error?.errors?.[0]?.reason || data.error?.details?.[0]?.reason || String(res.status);
    throw err;
  }
  return data;
}

function ytErrorText(e) {
  const r = e.reason || "";
  if (r === "quotaExceeded" || r === "dailyLimitExceeded") return "Ютуб: закончилась дневная квота API";
  if (r === "keyInvalid" || r === "API_KEY_INVALID" || /API key not valid/i.test(e.message)) return "Ютуб: неверный API-ключ";
  if (r === "accessNotConfigured" || r === "SERVICE_DISABLED") return "Ютуб: в Google Cloud не включён YouTube Data API v3";
  if (/referer|referrer/i.test(r + e.message)) return "Ютуб: ключ ограничен по сайтам — добавь laitsberg.github.io";
  if (r === "liveChatDisabled") return "Ютуб: на трансляции выключен чат";
  if (r === "channelNotFound") return "Ютуб: канал " + ytChannel + " не найден — проверь yt_channel";
  if (r === "playlistNotFound") return "Ютуб: у канала " + ytChannel + " нет публичных видео — проверь yt_channel";
  if (r === "liveChatNotFound") return "Ютуб: чат трансляции не найден";
  return "Ютуб: ошибка — " + e.message;
}

// activeLiveChatId трансляции: в первую очередь той, что идёт прямо сейчас,
// иначе — запланированной, у которой уже открыт чат (зал ожидания перед эфиром)
function ytPickLiveChat(videos) {
  const withChat = (videos.items || []).filter(v => {
    const d = v.liveStreamingDetails;
    return d && d.activeLiveChatId && !d.actualEndTime;
  });
  const pick = withChat.find(v => v.liveStreamingDetails.actualStartTime) || withChat[0];
  return pick ? pick.liveStreamingDetails.activeLiveChatId : null;
}

// Ищем чат текущего эфира. Через плейлист загрузок канала это стоит ~3 единицы квоты.
// (Дорогой search.list за 100 единиц специально не используем — эфир на Ютубе
// бывает не всегда, и проверка идёт перед каждым голосованием.)
async function ytFindLiveChatId() {
  if (ytVideo) {
    const v = await ytRequest("videos", { part: "liveStreamingDetails", id: ytVideo });
    return ytPickLiveChat(v);
  }

  // 1) канал -> плейлист загрузок (1 ед.)
  const byHandle = ytChannel.startsWith("@");
  const ch = await ytRequest("channels", { part: "contentDetails", [byHandle ? "forHandle" : "id"]: ytChannel });
  const channelItem = ch.items?.[0];
  if (!channelItem) throw Object.assign(new Error("канал не найден"), { reason: "channelNotFound" });
  const uploads = channelItem.contentDetails?.relatedPlaylists?.uploads;

  if (!uploads) return null;

  // 2) последние видео канала (1 ед.) -> 3) какое из них сейчас в эфире (1 ед.)
  const pl = await ytRequest("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: 10 });
  const ids = (pl.items || []).map(i => i.contentDetails.videoId);
  if (!ids.length) return null;
  return ytPickLiveChat(await ytRequest("videos", { part: "liveStreamingDetails", id: ids.join(",") }));
}

function ytResetChat(ended = false) {
  if (ended) yt.endedChatId = yt.chatId;
  yt.chatId = null;
  yt.pageToken = null;
  ytSetConnected(false);
}

async function ytEnsureChat() {
  if (yt.chatId) return true;
  const chatId = await ytFindLiveChatId();
  yt.chatId = chatId !== yt.endedChatId ? chatId : null;
  if (!yt.chatId) {
    // Обычная ситуация: сегодня стрим только на Твиче. Без плашек на экране.
    console.log("Ютуб: эфира сейчас нет");
    return false;
  }
  yt.pageToken = null;
  ytSetConnected(true);
  if (state !== 1) ytStatus("Ютуб: чат подключён", false); // во время голосования плашка только мешает
  return true;
}

function ytShouldPoll() {
  return ytEnabled && (state === 1 || !channel);
}

function ytStartPolling() {
  if (!ytEnabled) return;
  yt.sinceTime = Date.now() - 3000; // небольшой запас на расхождение часов
  if (yt.active) return;
  yt.active = true;
  yt.pageToken = null;
  ytPoll();
}

function ytHandleMessage(item) {
  const s = item.snippet, a = item.authorDetails;
  if (!s || !a || s.type !== "textMessageEvent") return;
  if (Date.parse(s.publishedAt) < yt.sinceTime) return; // старые сообщения из истории чата

  const text = (s.textMessageDetails?.messageText || s.displayMessage || "").trim();
  if (text.startsWith("!")) {
    const [command, ...rest] = text.slice(1).split(/\s+/);
    handleCommand(command.toLowerCase(), rest.join(" "), a.isChatOwner || a.isChatModerator);
    return;
  }
  messageHandler(a.displayName, text, "yt:" + a.channelId, "youtube");
}

async function ytPoll() {
  if (!ytShouldPoll()) {
    yt.active = false;
    yt.pageToken = null;
    return;
  }

  let delay;
  try {
    if (await ytEnsureChat()) {
      const query = { liveChatId: yt.chatId, part: "snippet,authorDetails", maxResults: 2000 };
      if (yt.pageToken) query.pageToken = yt.pageToken;
      const data = await ytRequest("liveChat/messages", query);
      yt.pageToken = data.nextPageToken || null;
      (data.items || []).forEach(ytHandleMessage);

      if (data.offlineAt) ytResetChat(true); // эфир на Ютубе закончился — дальше только Твич
      delay = data.pollingIntervalMillis || 5000;
      if (state !== 1) delay = Math.max(delay, YT_IDLE_INTERVAL);
    } else if (channel) {
      // Эфира на Ютубе нет — это голосование только по Твичу, до конца его больше не ищем.
      // В следующем голосовании проверим снова (вдруг Ютуб к тому времени запустили).
      yt.active = false;
      return;
    } else {
      delay = YT_RETRY_INTERVAL;
    }
  } catch (e) {
    if (e.reason === "liveChatEnded") {
      console.log("Ютуб: эфир закончился");
    } else {
      ytStatus(ytErrorText(e));
    }
    if (["liveChatEnded", "liveChatNotFound", "liveChatDisabled", "forbidden"].includes(e.reason)) ytResetChat(true);
    delay = (e.reason === "quotaExceeded" || e.reason === "dailyLimitExceeded") ? YT_QUOTA_RETRY : YT_RETRY_INTERVAL;
  }

  setTimeout(ytPoll, delay);
}

function ytInit() {
  if (!ytChannel && !ytVideo) {
    ytStatus("Ютуб: в ссылке нет yt_channel (или yt_video)");
    return;
  }
  if (!channel) {
    // Только Ютуб: опрос постоянный, чтобы ловить !оценка
    ytStartPolling();
  } else {
    // Сразу проверяем ключ, чтобы ошибка настройки была видна при добавлении в OBS.
    // Если эфира на Ютубе нет — ничего не показываем, проверим при старте голосования.
    ytEnsureChat().catch(e => ytStatus(ytErrorText(e)));
  }
}

window.onload = () => {
  if (channel || ytEnabled) {
    init();
  } else {
    document.body.textContent = "НЕ УКАЗАН КАНАЛ (в ссылке добавить ?channel=ТВИЧ_КАНАЛ и/или &yt_key=КЛЮЧ&yt_channel=@ЮТУБ_КАНАЛ)";
    document.body.style.backgroundColor = "black";
  }
};
