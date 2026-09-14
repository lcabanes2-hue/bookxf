const views = {
  login: document.getElementById("view-login"),
  changePassword: document.getElementById("view-change-password"),
  dashboard: document.getElementById("view-dashboard"),
};

function showView(name) {
  for (const key of Object.keys(views)) {
    views[key].hidden = key !== name;
  }
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
    credentials: "same-origin",
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    // sense cos JSON
  }
  if (!res.ok) {
    throw new Error(body?.error || `Error ${res.status}`);
  }
  return body;
}

async function loadCurrentUser() {
  try {
    const user = await api("/api/auth/me");
    if (user.mustChangePassword) {
      showView("changePassword");
    } else {
      document.getElementById("dashboard-user").textContent = `Hola, ${user.name}`;
      showView("dashboard");
      loadDashboard();
    }
  } catch {
    showView("login");
  }
}

// weekday: 0=diumenge ... 6=dissabte (igual que Date.getDay()).
// Es mostren en ordre dilluns->diumenge.
const DAY_NAMES = [
  { weekday: 1, label: "Dilluns" },
  { weekday: 2, label: "Dimarts" },
  { weekday: 3, label: "Dimecres" },
  { weekday: 4, label: "Dijous" },
  { weekday: 5, label: "Divendres" },
  { weekday: 6, label: "Dissabte" },
  { weekday: 0, label: "Diumenge" },
];

async function loadDashboard() {
  const summaryCard = document.getElementById("card-aimharder-summary");
  const formCard = document.getElementById("card-aimharder-form");
  const weekCard = document.getElementById("card-week");
  const historyCard = document.getElementById("card-history");

  let status;
  try {
    status = await api("/api/aimharder/credentials");
  } catch {
    status = { configured: false };
  }

  if (status.configured) {
    document.getElementById("aimharder-email").textContent = status.email;
    summaryCard.hidden = false;
    formCard.hidden = true;
    weekCard.hidden = false;
    historyCard.hidden = false;
    loadWeek();
    loadTodayBanner();
    loadHistory();
  } else {
    summaryCard.hidden = true;
    formCard.hidden = false;
    weekCard.hidden = true;
    historyCard.hidden = true;
  }
}

const STATUS_ICON = {
  RESERVADA: "🟢",
  LLISTA_ESPERA: "🟡",
  ERROR: "🔴",
  CANCELLADA: "⚪",
};
const STATUS_LABEL = {
  RESERVADA: "Reservada",
  LLISTA_ESPERA: "Llista d'espera",
  ERROR: "Error",
  CANCELLADA: "Cancel·lada",
};

async function loadHistory() {
  const list = document.getElementById("history-list");
  list.innerHTML = "";

  let history;
  try {
    history = await api("/api/booking/history");
  } catch {
    return;
  }

  if (history.length === 0) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "Encara no hi ha cap reserva feta.";
    list.appendChild(empty);
    return;
  }

  for (const item of history) {
    const row = document.createElement("div");
    row.className = "history-row";

    const icon = document.createElement("span");
    icon.className = "history-icon";
    icon.textContent = STATUS_ICON[item.status] ?? "⚪";

    const main = document.createElement("div");
    main.className = "history-main";

    const className = document.createElement("div");
    className.className = "history-class";
    className.textContent = item.className ?? "Classe";

    const date = document.createElement("div");
    date.className = "history-date";
    date.textContent = `${item.targetClassDate} · ${item.targetClassTime} · ${STATUS_LABEL[item.status] ?? item.status}`;

    main.append(className, date);

    if (item.resultMessage && item.status === "ERROR") {
      const msg = document.createElement("div");
      msg.className = "history-msg";
      msg.textContent = item.resultMessage;
      main.appendChild(msg);
    }

    row.append(icon, main);
    list.appendChild(row);
  }
}

async function loadTodayBanner() {
  const banner = document.getElementById("card-today-banner");
  let upcoming;
  try {
    upcoming = await api("/api/booking/upcoming");
  } catch {
    return;
  }

  const todayISO = new Date().toISOString().slice(0, 10);
  const todaysOpenings = upcoming.filter((a) => {
    const openDate = new Date(a.openAt).toISOString().slice(0, 10);
    return openDate === todayISO;
  });

  if (todaysOpenings.length === 0) {
    banner.hidden = true;
    return;
  }

  const list = todaysOpenings
    .map((a) => `"${a.className}" del ${a.targetClassDate} a les ${a.targetClassTime}`)
    .join(", ");
  document.getElementById("today-banner-title").textContent = "Avui es reserva una classe";
  document.getElementById("today-banner-body").textContent =
    `Avui intentarem reservar-te ${list} en el moment que obri. Si vols canviar-ho, entra al pla setmanal abans que arribi l'hora.`;
  banner.hidden = false;
}

document.getElementById("today-banner-ok").addEventListener("click", () => {
  document.getElementById("card-today-banner").hidden = true;
});

document.getElementById("aimharder-change-btn").addEventListener("click", () => {
  document.getElementById("card-aimharder-summary").hidden = true;
  document.getElementById("card-aimharder-form").hidden = false;
  document.getElementById("card-week").hidden = true;
});

document.getElementById("ah-submit").addEventListener("click", async () => {
  const email = document.getElementById("ah-email").value.trim();
  const password = document.getElementById("ah-password").value;
  const errorEl = document.getElementById("ah-error");
  errorEl.textContent = "";
  try {
    await api("/api/aimharder/credentials", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    document.getElementById("ah-password").value = "";
    await loadDashboard();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

// Codi de colors de les classes a la pantalla de detall: OPEN BOX neutre,
// OPEN BOX EXT. gris, WOD vermell fluix, la resta (classes especials) verd
// fluix.
function classCategoryClass(className) {
  const n = className.toUpperCase();
  if (n.includes("EXT")) return " class-option--ext";
  if (n === "OPEN BOX") return "";
  if (n === "WOD") return " class-option--wod";
  return " class-option--special";
}

const DAY_SHORT = { 1: "Dl", 2: "Dt", 3: "Dc", 4: "Dj", 5: "Dv", 6: "Ds", 0: "Dg" };
const MONTH_NAMES = [
  "gener", "febrer", "març", "abril", "maig", "juny",
  "juliol", "agost", "setembre", "octubre", "novembre", "desembre",
];

let weekScheduleByWeekday = new Map();

function upcomingWeekDates() {
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (let i = 0; i < 7; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    days.push({ date, weekday: date.getDay(), isToday: i === 0 });
  }
  return days;
}

async function loadWeek() {
  const statusEl = document.getElementById("week-status");
  statusEl.textContent = "";

  let week;
  try {
    week = await api("/api/schedule/week");
  } catch (err) {
    statusEl.textContent = err.message;
    return;
  }
  weekScheduleByWeekday = new Map(week.map((s) => [s.weekday, s]));
  renderWeekStrip();
}

function renderWeekStrip() {
  const strip = document.getElementById("week-strip");
  strip.innerHTML = "";

  const days = upcomingWeekDates();
  const monthLabel = document.getElementById("week-month-label");
  const months = new Set(days.map((d) => d.date.getMonth()));
  monthLabel.textContent =
    months.size === 1
      ? `${MONTH_NAMES[[...months][0]]} ${days[0].date.getFullYear()}`
      : `${MONTH_NAMES[days[0].date.getMonth()]} / ${MONTH_NAMES[days[days.length - 1].date.getMonth()]} ${days[days.length - 1].date.getFullYear()}`;

  for (const { date, weekday, isToday } of days) {
    const slot = weekScheduleByWeekday.get(weekday);
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "day-chip" + (slot?.time ? " is-set" : "") + (isToday ? " is-today" : "");

    const dow = document.createElement("span");
    dow.className = "dow";
    dow.textContent = isToday ? "Avui" : DAY_SHORT[weekday];

    const dom = document.createElement("span");
    dom.className = "dom";
    dom.textContent = String(date.getDate());

    const indicator = document.createElement("span");
    indicator.className = "indicator";

    chip.append(dow, dom, indicator);
    chip.addEventListener("click", () => openDayDetail(weekday, date));
    strip.appendChild(chip);
  }
}

function formatDayTitle(date) {
  const label = DAY_NAMES.find((d) => d.weekday === date.getDay())?.label ?? "";
  return `${label} ${date.getDate()} de ${MONTH_NAMES[date.getMonth()]}`;
}

async function openDayDetail(weekday, date) {
  document.getElementById("week-strip-view").hidden = true;
  document.getElementById("day-detail-view").hidden = false;
  document.getElementById("day-detail-title").textContent = formatDayTitle(date);

  const list = document.getElementById("day-detail-list");
  list.innerHTML = "";
  const loading = document.createElement("p");
  loading.className = "hint";
  loading.textContent = "Carregant classes reals des d'AimHarder...";
  list.appendChild(loading);

  const currentSlot = weekScheduleByWeekday.get(weekday);

  let classes;
  try {
    ({ classes } = await api(`/api/aimharder/classes?weekday=${weekday}`));
  } catch (err) {
    list.innerHTML = "";
    const errEl = document.createElement("p");
    errEl.className = "error";
    errEl.textContent = err.message;
    list.appendChild(errEl);
    return;
  }

  list.innerHTML = "";

  const noneBtn = document.createElement("button");
  noneBtn.type = "button";
  noneBtn.className = "class-option none-option" + (!currentSlot?.time ? " selected" : "");
  noneBtn.textContent = "No entrenar aquest dia";
  noneBtn.addEventListener("click", () => saveDaySelection(weekday, null, null));
  list.appendChild(noneBtn);

  const seen = new Set();
  for (const cls of classes) {
    const time = cls.time.split(" ")[0];
    const key = `${time}|${cls.className}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const isSelected = currentSlot?.time === time && currentSlot?.className === cls.className;
    const isFull = cls.occupation >= cls.limit;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className =
      "class-option" +
      classCategoryClass(cls.className) +
      (isSelected ? " selected" : "");

    const left = document.createElement("span");
    const timeSpan = document.createElement("span");
    timeSpan.className = "time";
    timeSpan.textContent = time;
    left.append(timeSpan, cls.className);

    btn.appendChild(left);

    {
      const badge = document.createElement("span");
      badge.className = "badge" + (isFull ? " full" : "");
      badge.textContent = `${cls.occupation}/${cls.limit}`;
      btn.appendChild(badge);
    }

    btn.addEventListener("click", () => saveDaySelection(weekday, time, cls.className));
    list.appendChild(btn);
  }
}

async function saveDaySelection(weekday, time, className) {
  const statusEl = document.getElementById("week-status");
  statusEl.textContent = "Guardant...";
  try {
    await api(`/api/schedule/week/${weekday}`, {
      method: "PUT",
      body: JSON.stringify({ time, className }),
    });
    weekScheduleByWeekday.set(weekday, { weekday, time, className });
    statusEl.textContent = "Desat ✓";
  } catch (err) {
    statusEl.textContent = err.message;
    return;
  }

  const dayLabel = DAY_NAMES.find((d) => d.weekday === weekday)?.label ?? "";
  const banner = document.getElementById("plan-confirm-banner");
  const text = document.getElementById("plan-confirm-text");
  if (time) {
    text.textContent = `Planificat! Cada ${dayLabel.toLowerCase()} a les ${time} es reservarà "${className}" automàticament, fins que ho canviïs.`;
  } else {
    text.textContent = `Fet, ${dayLabel} ja no té cap classe planificada.`;
  }
  banner.hidden = false;

  backToWeekStrip();
}

document.getElementById("plan-confirm-banner").addEventListener("click", () => {
  document.getElementById("plan-confirm-banner").hidden = true;
});

function backToWeekStrip() {
  document.getElementById("day-detail-view").hidden = true;
  document.getElementById("week-strip-view").hidden = false;
  renderWeekStrip();
}

document.getElementById("day-detail-back").addEventListener("click", backToWeekStrip);

document.getElementById("login-submit").addEventListener("click", async () => {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errorEl = document.getElementById("login-error");
  errorEl.textContent = "";
  try {
    await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    await loadCurrentUser();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById("cp-submit").addEventListener("click", async () => {
  const currentPassword = document.getElementById("cp-current").value;
  const newPassword = document.getElementById("cp-new").value;
  const errorEl = document.getElementById("cp-error");
  errorEl.textContent = "";
  try {
    await api("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    await loadCurrentUser();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" });
  showView("login");
});

loadCurrentUser();
