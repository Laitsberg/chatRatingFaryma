const timerInputEl = document.getElementById("timer"); // Для ввода минут
const counterEl = document.getElementById("counter");
const scoreEl = document.getElementById("score");
const infoTextEl = document.getElementById("info-text");
const mainEl = document.getElementById("main");
const btnEl = document.getElementById("start-button");

let timer = null;
let started = false;
let timerValue = 0;
let users = [];
let votes = []; // Для хранения {user, rating, value}
let score = 0.0;

const params = (new URL(document.location)).searchParams;
const channel = params.get("channel") || null;

if (channel) {
    document.getElementById("channel")?.remove(); // Удаляем предупреждение о канале
    btnEl.disabled = false;
    init(); // Инициализируем ComfyJS
}

// Категории с значениями
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

function init() {
    ComfyJS.onChat = (user, message, flags, self, extra) => {
        messageHandler(user, message);
    };
    ComfyJS.Init(channel);
}

function messageHandler(user, message) {
    if (!started) return;
    if (users.includes(user)) return;

    message = message.trim().toLowerCase().replace(/[\uD800-\uDFFF]/gi, ''); // Очистка

    if (categories.hasOwnProperty(message)) {
        const value = categories[message];
        const rating = message.charAt(0).toUpperCase() + message.slice(1); // Для display
        score += value;
        votes.push({ user, rating, value });
        users.push(user);
        counterEl.innerText = users.length;

        // Цвет по значению (от красного к зелёному)
        let color = `hsl(${Math.floor((value / 25) * 120)}, 100%, 50%)`; // Зеленый (120) для высоких, красный (0) для низких
        showNewScore(user, rating, color); // Показываем строку вместо числа
    }
}

function start() {
    document.querySelector("#obs-widget")?.remove(); // Убираем инфо для OBS

    if (started) {
        stop();
        return;
    }

    timerInputEl.disabled = true;
    mainEl.style.visibility = "visible";
    btnEl.innerText = "СТОП";
    btnEl.style.backgroundColor = "rgb(129, 93, 93)";

    timerValue = (timerInputEl.valueAsNumber || 1) * 60; // Минуты в секунды

    infoTextEl.innerHTML = "Голосование в чате!<br>Напишите одну из оценок:<br>Кринж-контент, Кринж-контент+, Ну такое --, Ну такое -, Ну такое, Ну такое +, Ну такое ++, Нормас --, Нормас -, Нормас, Нормас +, Нормас ++, Хорошечно --, Хорошечно -, Хорошечно, Хорошечно +, Хорошечно ++, Атлична --, Атлична -, Атлична, Атлична +, Атлична ++, Гениально --, Гениально -, Гениально";

    started = true;

    if (timerValue > 0) {
        timer = setInterval(onTimer, 1000);
        timerToTime();
    }
}

function stop() {
    clearInterval(timer);

    btnEl.innerText = "СТАРТ"; // Но для перезапуска нужен рефреш, как в оригинале
    btnEl.style.backgroundColor = "rgb(93, 129, 93)";
    infoTextEl.innerHTML = "Голосование окончено!<br>";
    btnEl.disabled = false; // Разрешаем перезапуск (но без полного сброса — добавьте reset() если нужно)

    if (users.length > 0) {
        let average = (score / users.length).toFixed(2);
        let text = `Итог (среднее): ${average} / 25`;

        // Топ категории
        const counts = {};
        votes.forEach(v => counts[v.rating] = (counts[v.rating] || 0) + 1);
        const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
        text += `<br>Топ категории: ${top.map(([cat, cnt]) => `${cat} (${cnt})`).join(", ")}`;

        scoreEl.innerHTML = text;
    } else {
        scoreEl.innerText = "Никто не проголосовал :(";
    }

    started = false;
}

function onTimer() {
    timerValue -= 1;
    if (timerValue > 0) {
        timerToTime();
    } else {
        stop();
    }
}

function timerToTime() {
    let minutes = Math.floor(timerValue / 60);
    let seconds = timerValue % 60;
    minutes = minutes.toString().padStart(2, "0");
    seconds = seconds.toString().padStart(2, "0");
    scoreEl.innerText = `${minutes}:${seconds}`;
}

function showNewScore(user, rating, color) {
    let el = document.createElement("div");
    el.className = "new-score";
    el.innerText = `${user} - ${rating}`;

    let y = Math.floor(Math.random() * (window.innerHeight / 3 * 2)) + 100;
    let x = Math.floor(Math.random() * (window.innerWidth / 3 * 2)) + 80;

    el.style.top = `${y}px`;
    el.style.left = `${x}px`;
    el.style.color = color;

    document.body.appendChild(el);

    setTimeout(() => {
        document.body.removeChild(el);
    }, 1000);
}
