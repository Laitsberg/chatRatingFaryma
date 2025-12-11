const infoEl = document.getElementById("info");
const resultEl = document.getElementById("result");
const timerEl = document.getElementById("timer");
const scoreEl = document.getElementById("score");
const counterInfoEl = document.getElementById("counter-info");
const counterResultEl = document.getElementById("counter-result");
const votesListEl = document.getElementById("votes-list"); // Новый элемент для списка

const params = (new URL(document.location)).searchParams;
const channel = params.get("channel") || null;
const defaultTime = parseInt(params.get("time")) || 60;

let timer = null;
let state = 0; // 0 - ожидание, 1 - голосование, 2 - результаты
let timerValue = 0;
let users = []; // Для предотвращения дубликатов
let votes = []; // Новый: [{user: 'name', rating: 'Категория', value: number}]
let score = 0.0; // Сумма значений

// Ваши категории с присвоенными значениями (1-25, от худшего к лучшему)
const categories = {
  "кринж-контент": 1,
  "кринж-контент+": 2,
  "ну такое --": 3,
  "ну такое -": 4,
  "ну такое": 5,
  "ну такое +": 6,
  "ну такое ++": 7,
  "нормас --": 8,
  "нормас -": 9,
  "нормас": 10,
  "нормас +": 11,
  "нормас ++": 12,
  "хорошечно --": 13,
  "хорошечно -": 14,
  "хорошечно": 15,
  "хорошечно +": 16,
  "хорошечно ++": 17,
  "атлична --": 18,
  "атлична -": 19,
  "атлична": 20,
  "атлична +": 21,
  "атлична ++": 22,
  "гениально --": 23,
  "гениально -": 24,
  "гениально": 25
};

function messageHandler(user, message) {
  if (state !== 1) return;
  if (users.includes(user)) return;

  message = message.trim().toLowerCase().replace(/[\uD800-\uDFFF]/gi, ''); // Очистка

  // Проверяем, есть ли точное совпадение с ключом
  if (categories.hasOwnProperty(message)) {
    const value = categories[message];
    score += value;
    votes.push({ user, rating: message.charAt(0).toUpperCase() + message.slice(1), value }); // Капитализируем для display
    users.push(user);
    counterInfoEl.innerText = users.length;
  }
}

function init() {
  ComfyJS.onChat = (user, message, flags, self, extra) => {
    messageHandler(user, message);
  };

  ComfyJS.onCommand = (user, command, message, flags, extra) => {
    if (flags.broadcaster || flags.mod || user == "declider") {
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
  votes = []; // Очистка
  users = [];
  score = 0.0;
  timerToTime();
}

function finish() {
  timer && (typeof timer === 'number' ? clearTimeout(timer) : clearInterval(timer));

  let result;
  if (votes.length) {
    result = (score / votes.length).toFixed(2);
    scoreEl.textContent = `Итог (среднее): ${result} / 25`;

    // Отображение списка голосов
    votesListEl.innerHTML = ""; // Очистка
    votes.forEach(vote => {
      const li = document.createElement("li");
      li.textContent = `${vote.user}: ${vote.rating}`;
      votesListEl.appendChild(li);
    });

    // Опционально: топ категории (counts)
    const counts = {};
    votes.forEach(v => counts[v.rating] = (counts[v.rating] || 0) + 1);
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
    let topText = "\nТоп категории: " + top.map(([cat, cnt]) => `${cat} (${cnt})`).join(", ");
    scoreEl.textContent += topText;
  } else {
    scoreEl.textContent = `Нет оценок`;
  }

  counterResultEl.textContent = votes.length;

  infoEl.style.opacity = 0;
  resultEl.style.opacity = 1;

  state = 2;
  timer = setTimeout(stop, 10000); // 10 сек на результат
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
