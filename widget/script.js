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

function messageHandler(user, message) {
  if (state !== 1) return;
  if (users.includes(user)) return;

  message = message.trim().toLowerCase().replace(/[\uD800-\uDFFF]/gi, '');

  // Нормализуем синонимы к каноническому написанию
  const canonical = aliasLookup[message];

  if (canonical !== undefined) {
    const value = categories[canonical];
    const rating = canonical.charAt(0).toUpperCase() + canonical.slice(1);
    score += value;
    votes.push({ user, rating, value });
    users.push(user);
    counterInfoEl.innerText = users.length;
    bumpCounter();
    updateLiveAverage();
  }
}

function init() {
  ComfyJS.onChat = (user, message, flags, self, extra) => {
    messageHandler(user, message);
  };

  ComfyJS.onCommand = (user, command, message, flags, extra) => {
    if (flags.broadcaster || flags.mod || user == "laitsberg") { // Замените на свой ник, если нужно
      if (command === "оценка") {
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
    }
  };

  ComfyJS.Init(channel);
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

window.onload = () => {
  if (channel) {
    init();
  } else {
    document.body.textContent = "НЕ УКАЗАН ТВИЧ КАНАЛ (в ссылке добавить ?channel=КАНАЛ)";
    document.body.style.backgroundColor = "black";
  }
};
