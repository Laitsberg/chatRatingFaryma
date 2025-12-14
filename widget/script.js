const infoEl = document.getElementById("info");
const resultEl = document.getElementById("result");
const timerEl = document.getElementById("timer");
const scoreEl = document.getElementById("score");
const counterInfoEl = document.getElementById("counter-info");
const counterResultEl = document.getElementById("counter-result");
const votesListEl = document.getElementById("votes-list");

const params = (new URL(document.location)).searchParams;
const channel = params.get("channel") || null;
const defaultTime = parseInt(params.get("time")) || 60;

let timer = null;
let state = 0; // 0 - ожидание, 1 - голосование, 2 - результаты
let timerValue = 0;
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

function messageHandler(user, message) {
  if (state !== 1) return;
  if (users.includes(user)) return;

  message = message.trim().toLowerCase().replace(/[\uD800-\uDFFF]/gi, '');

  if (categories.hasOwnProperty(message)) {
    const value = categories[message];
    const rating = message.charAt(0).toUpperCase() + message.slice(1);
    score += value;
    votes.push({ user, rating, value });
    users.push(user);
    counterInfoEl.innerText = users.length;
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
  timer = setInterval(onTimer, 1000);
  infoEl.style.opacity = 1;
  state = 1;
  users = [];
  votes = [];
  score = 0.0;
  timerToTime();
}

function finish() {
  timer && (typeof timer === 'number' ? clearTimeout(timer) : clearInterval(timer));

  let resultText;
  if (users.length) {
    const average = score / users.length;
    const rounded = Math.round(average); // Округляем до ближайшего целого
    const category = valueToCategory[rounded] || "Неизвестно"; // Ближайшая категория

    resultText = `Итог: ${category}`;

    // Топ категории
    const counts = {};
    votes.forEach(v => counts[v.rating] = (counts[v.rating] || 0) + 1);
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (top.length) {
      resultText += `<br>Топ: ${top.map(([cat, cnt]) => `${cat} (${cnt})`).join(", ")}`;
    }

    // Список голосов
    votesListEl.innerHTML = "";
    votes.forEach(vote => {
      const li = document.createElement("li");
      li.textContent = `${vote.user}: ${vote.rating}`;
      votesListEl.appendChild(li);
    });
  } else {
    resultText = `Нет оценок`;
  }
  scoreEl.innerHTML = resultText;
  counterResultEl.textContent = users.length;

  infoEl.style.opacity = 0;
  resultEl.style.opacity = 1;

  state = 2;
  timer = setTimeout(stop, 60000); // 10 сек на результат
}

function stop() {
  timer && (typeof timer === 'number' ? clearTimeout(timer) : clearInterval(timer));
  resultEl.style.opacity = 0;
  votesListEl.innerHTML = "";
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
}

window.onload = () => {
  if (channel) {
    init();
  } else {
    document.body.textContent = "НЕ УКАЗАН ТВИЧ КАНАЛ (в ссылке добавить ?channel=КАНАЛ)";
    document.body.style.backgroundColor = "black";
  }
};



