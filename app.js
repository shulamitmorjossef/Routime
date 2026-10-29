import { CalendarDate, GregorianCalendar, HebrewCalendar, toCalendar } from "@internationalized/date";
import "./styles.css";

const STORAGE_KEY = "zmanit-data-v1";
const COLORS = ["lavender", "coral", "sage", "blue", "gold"];
const COLOR_LABELS = { lavender: "סגול עדין", coral: "קורל", sage: "ירוק מרווה", blue: "כחול", gold: "זהב" };
const HEBREW_CALENDAR = new HebrewCalendar();
const GREGORIAN_CALENDAR = new GregorianCalendar();
const hebrewMonthFormatter = new Intl.DateTimeFormat("he-IL-u-ca-hebrew", { month: "long", timeZone: "UTC" });
const state = loadState();
let activeView = "list";
let selectedCalendar = "all";
let editingEventId = null;
let visibleMonth = null;
let showPastFirst = false;
let installPrompt = null;
let toastTimer;

const $ = (selector) => document.querySelector(selector);
const eventsView = $("#events-view");
const eventDialog = $("#event-dialog");
const calendarDialog = $("#calendar-dialog");

function createId() {
  return window.crypto && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function loadState() {
  const fallback = { calendars: [{ id: "personal", name: "אישי", color: "lavender" }, { id: "family", name: "משפחה", color: "coral" }, { id: "work", name: "עבודה", color: "sage" }], events: [], notified: [] };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved || !Array.isArray(saved.calendars) || !Array.isArray(saved.events)) return fallback;
    return { calendars: saved.calendars, events: saved.events.map(migrateEvent), notified: Array.isArray(saved.notified) ? saved.notified : [] };
  } catch (error) {
    console.error("Could not read saved events.", error);
    return fallback;
  }
}

function migrateEvent(event) {
  if (event.hebrewMonth && event.hebrewDay) return { repeatYearly: false, ...event };
  if (!event.dateISO) return event;
  const parts = hebrewParts(utcDateForISO(event.dateISO));
  const { dateISO, notified, ...rest } = event;
  return { ...rest, hebrewYear: parts.year, hebrewMonth: parts.month, hebrewDay: parts.day, repeatYearly: false };
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.error("Could not save events.", error);
    showToast("לא הצלחנו לשמור. בדקי שהאחסון במכשיר זמין.", true);
    return false;
  }
  return true;
}

function localDateFromISO(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function toISO(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function utcDateForISO(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function utcDateToISO(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function dateOnly(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function hebrewParts(date) {
  const gregorianDate = new CalendarDate(
    GREGORIAN_CALENDAR,
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  );
  const hebrewDate = toCalendar(gregorianDate, HEBREW_CALENDAR);
  return { day: hebrewDate.day, year: hebrewDate.year, month: hebrewDate.month };
}

function hebrewNumber(value, isYear = false) {
  let number = Number(value);
  if (isYear) number %= 1000;
  if (!Number.isInteger(number) || number < 1) return "";
  const letters = [];
  if (number === 15) return "ט״ו";
  if (number === 16) return "ט״ז";
  for (const [amount, letter] of [[400, "ת"], [300, "ש"], [200, "ר"], [100, "ק"], [90, "צ"], [80, "פ"], [70, "ע"], [60, "ס"], [50, "נ"], [40, "מ"], [30, "ל"], [20, "כ"], [10, "י"], [9, "ט"], [8, "ח"], [7, "ז"], [6, "ו"], [5, "ה"], [4, "ד"], [3, "ג"], [2, "ב"], [1, "א"]]) {
    while (number >= amount) {
      letters.push(letter);
      number -= amount;
    }
  }
  if (letters.length === 1) return `${letters[0]}׳`;
  return `${letters.slice(0, -1).join("")}״${letters[letters.length - 1]}`;
}

function parseHebrewYear(value) {
  const letters = value.trim().replace(/[׳״'\s]/g, "");
  const values = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ל: 30, מ: 40, נ: 50, ס: 60, ע: 70, פ: 80, צ: 90, ק: 100, ר: 200, ש: 300, ת: 400 };
  if (!letters || [...letters].some((letter) => !values[letter])) return NaN;
  const number = [...letters].reduce((total, letter) => total + values[letter], 0);
  const year = number >= 5700 && number <= 5900 ? number : number + 5000;
  return year >= 5700 && year <= 5900 ? year : NaN;
}

function hebrewMonthName(month, year) {
  return hebrewMonthFormatter.format(new CalendarDate(HEBREW_CALENDAR, year, month, 1).toDate("UTC"));
}

function hebrewMonthLabel(date) {
  const parts = hebrewParts(date);
  return `${hebrewMonthName(parts.month, parts.year)} ${hebrewNumber(parts.year, true)}`;
}

function hebrewMonthOptions(year) {
  const target = Number(year);
  if (!Number.isInteger(target) || target < 5700 || target > 5900) return [];
  const firstMonth = new CalendarDate(HEBREW_CALENDAR, target, 1, 1);
  return Array.from({ length: HEBREW_CALENDAR.getMonthsInYear(firstMonth) }, (_, index) => index + 1);
}

function findGregorianDate(hebrewYear, hebrewMonth, hebrewDay) {
  const year = Number(hebrewYear);
  const month = Number(hebrewMonth);
  const day = Number(hebrewDay);
  const monthsInYear = hebrewMonthOptions(year);
  if (!monthsInYear.includes(month) || !Number.isInteger(day) || day < 1) return null;
  const firstMonth = new CalendarDate(HEBREW_CALENDAR, year, month, 1);
  if (day > HEBREW_CALENDAR.getDaysInMonth(firstMonth)) return null;
  const hebrewDate = new CalendarDate(HEBREW_CALENDAR, year, month, day);
  return utcDateForISO(utcDateToISO(hebrewDate.toDate("UTC")));
}

function nextHebrewMonthStart(start, direction) {
  const { year, month } = hebrewParts(start);
  const firstDay = new CalendarDate(HEBREW_CALENDAR, year, month, 1);
  const nextMonth = firstDay.add({ months: direction });
  return findGregorianDate(nextMonth.year, nextMonth.month, 1);
}

function currentHebrewDate() {
  const date = new Date();
  const gregorianDate = new CalendarDate(GREGORIAN_CALENDAR, date.getFullYear(), date.getMonth() + 1, date.getDate());
  const hebrewDate = toCalendar(gregorianDate, HEBREW_CALENDAR);
  return { year: hebrewDate.year, month: hebrewDate.month, day: hebrewDate.day };
}

function isHebrewLeapYear(year) {
  return HEBREW_CALENDAR.getMonthsInYear(new CalendarDate(HEBREW_CALENDAR, year, 1, 1)) === 13;
}

function adjustHebrewMonth(originalMonth, originalYear, targetYear) {
  const originalLeap = isHebrewLeapYear(originalYear);
  const targetLeap = isHebrewLeapYear(targetYear);
  if (originalLeap === targetLeap) return originalMonth;
  if (originalLeap && !targetLeap) {
    if (originalMonth === 6 || originalMonth === 7) return 6;
    if (originalMonth > 7) return originalMonth - 1;
    return originalMonth;
  }
  if (originalMonth === 6) return 7;
  if (originalMonth > 6) return originalMonth + 1;
  return originalMonth;
}

function occurrenceDate(event, hebrewYear) {
  const month = adjustHebrewMonth(event.hebrewMonth, event.hebrewYear, hebrewYear);
  const monthsInYear = hebrewMonthOptions(hebrewYear);
  if (!monthsInYear.includes(month)) return null;
  const firstDay = new CalendarDate(HEBREW_CALENDAR, hebrewYear, month, 1);
  const daysInMonth = HEBREW_CALENDAR.getDaysInMonth(firstDay);
  const day = Math.min(event.hebrewDay, daysInMonth);
  return findGregorianDate(hebrewYear, month, day);
}

function nextOccurrenceDate(event) {
  if (!event.repeatYearly) return occurrenceDate(event, event.hebrewYear);
  const todayIso = toISO(new Date());
  const today = currentHebrewDate();
  for (let offset = 0; offset <= 2; offset += 1) {
    const date = occurrenceDate(event, today.year + offset);
    if (date && utcDateToISO(date) >= todayIso) return date;
  }
  return occurrenceDate(event, today.year);
}

function nextOccurrenceISO(event) {
  const date = nextOccurrenceDate(event);
  return date ? utcDateToISO(date) : null;
}

function occurrenceISOInYear(event, hebrewYear) {
  if (!event.repeatYearly && event.hebrewYear !== hebrewYear) return null;
  const date = occurrenceDate(event, hebrewYear);
  return date ? utcDateToISO(date) : null;
}

function dateLabel(event) {
  const monthName = hebrewMonthName(event.hebrewMonth, event.hebrewYear);
  if (event.repeatYearly) return `${hebrewNumber(event.hebrewDay)} ב${monthName} · כל שנה`;
  return `${hebrewNumber(event.hebrewDay)} ב${monthName}, ${hebrewNumber(event.hebrewYear, true)}`;
}

function daysUntil(date) {
  return Math.round((dateOnly(date).getTime() - dateOnly(new Date()).getTime()) / 86400000);
}

function relativeDate(date) {
  const difference = daysUntil(date);
  if (difference === 0) return "היום";
  if (difference === 1) return "מחר";
  if (difference === -1) return "אתמול";
  if (difference > 1 && difference < 7) return `בעוד ${difference} ימים`;
  if (difference < -1 && difference > -7) return `לפני ${Math.abs(difference)} ימים`;
  const parts = hebrewParts(utcDateForISO(toISO(date)));
  return `${hebrewNumber(parts.day)} ב${hebrewMonthName(parts.month, parts.year)}`;
}

function calendarFor(event) {
  return state.calendars.find((calendar) => calendar.id === event.calendarId) || { name: "לוח שנמחק", color: "lavender" };
}

function reminderLabel(minutes) {
  const value = Number(minutes);
  if (!value) return "";
  if (value === 60) return "תזכורת שעה לפני";
  if (value === 1440) return "תזכורת יום לפני";
  if (value === 10080) return "תזכורת שבוע לפני";
  if (value === 43200) return "תזכורת חודש לפני";
  return "תזכורת";
}

function sortEvents(events) {
  return [...events].sort((a, b) => {
    const aIso = nextOccurrenceISO(a);
    const bIso = nextOccurrenceISO(b);
    if (!aIso) return 1;
    if (!bIso) return -1;
    return aIso.localeCompare(bIso);
  });
}

function showToast(message, isError = false) {
  const region = $("#toast-region");
  region.replaceChildren();
  const toast = document.createElement("div");
  toast.className = `toast${isError ? " error" : ""}`;
  toast.textContent = message;
  region.append(toast);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.remove(), 3600);
}

function setView(view) {
  activeView = view;
  document.querySelectorAll("[data-view]").forEach((button) => {
    const isActive = button.dataset.view === view;
    button.classList.toggle("active", isActive);
    if (button.matches('[role="tab"]')) button.setAttribute("aria-selected", String(isActive));
  });
  const titles = {
    list: ["האירועים שלי", "כל מה שחשוב לך, במקום אחד."],
    calendar: ["לוח השנה שלי", "מבט אחד על כל מה שמחכה לך."],
    upcoming: ["בקרוב אצלך", "האירועים הבאים שלך, ממש מעבר לפינה."],
  };
  $("#page-title").innerHTML = `${titles[view][0]}<span class="title-period">.</span>`;
  $("#page-subtitle").textContent = titles[view][1];
  render();
}

function renderCalendars() {
  const container = $("#calendar-filters");
  container.innerHTML = `<button class="calendar-filter${selectedCalendar === "all" ? " selected" : ""}" data-calendar-id="all" aria-pressed="${selectedCalendar === "all"}"><span class="calendar-dot lavender"></span><span>כל הלוחות</span></button>${state.calendars.map((calendar) => `<button class="calendar-filter${selectedCalendar === calendar.id ? " selected" : ""}" data-calendar-id="${escapeHTML(calendar.id)}" aria-pressed="${selectedCalendar === calendar.id}"><span class="calendar-dot ${calendar.color}"></span><span>${escapeHTML(calendar.name)}</span></button>`).join("")}`;
  container.querySelectorAll("[data-calendar-id]").forEach((button) => button.addEventListener("click", () => {
    selectedCalendar = button.dataset.calendarId === "all" || selectedCalendar === button.dataset.calendarId ? "all" : button.dataset.calendarId;
    render();
  }));
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function filteredEvents() {
  const query = $("#search-input").value.trim().toLocaleLowerCase("he");
  const today = toISO(new Date());
  return sortEvents(state.events).filter((event) => {
    const calendarMatch = selectedCalendar === "all" || event.calendarId === selectedCalendar;
    const queryMatch = !query || `${event.name} ${event.notes || ""} ${calendarFor(event).name}`.toLocaleLowerCase("he").includes(query);
    const nextIso = nextOccurrenceISO(event);
    const upcomingMatch = activeView !== "upcoming" || (nextIso && nextIso >= today);
    return calendarMatch && queryMatch && upcomingMatch;
  });
}

function renderStats() {
  const today = toISO(new Date());
  const upcoming = sortEvents(state.events.filter((event) => {
    const iso = nextOccurrenceISO(event);
    return iso && iso >= today;
  }));
  $("#stat-total").textContent = String(state.events.length);
  $("#event-count").textContent = String(state.events.length);
  $("#stat-next").textContent = upcoming.length ? upcoming[0].name : "עוד אין אירועים";
  const todayHebrew = currentHebrewDate();
  const monthStart = findGregorianDate(todayHebrew.year, todayHebrew.month, 1);
  const monthEnd = nextHebrewMonthStart(monthStart, 1);
  const monthCount = upcoming.filter((event) => {
    const date = nextOccurrenceDate(event);
    return date && date >= monthStart && date < monthEnd;
  }).length;
  $("#stat-month").textContent = `${monthCount} ${monthCount === 1 ? "אירוע" : "אירועים"}`;
  const hebrewToday = currentHebrewDate();
  const weekday = new Intl.DateTimeFormat("he-IL", { weekday: "long" }).format(new Date());
  $("#today-label").textContent = `${weekday}, ${hebrewNumber(hebrewToday.day)} ב${hebrewMonthName(hebrewToday.month, hebrewToday.year)} ${hebrewNumber(hebrewToday.year, true)}`;
  const hour = new Date().getHours();
  $("#greeting").textContent = hour < 12 ? "בוקר טוב, בואי נתכנן משהו יפה" : hour < 18 ? "אחר צהריים טובים, קצת סדר והרבה שקט" : "ערב טוב, הדברים הטובים מחכים לך";
}

function groupTitle(date) {
  if (date.toDateString() === dateOnly(new Date()).toDateString()) return "היום";
  const startOfWeek = dateOnly(new Date());
  startOfWeek.setDate(startOfWeek.getDate() + (7 - startOfWeek.getDay()));
  if (date < startOfWeek) return "השבוע";
  const startOfNextWeek = new Date(startOfWeek);
  startOfNextWeek.setDate(startOfNextWeek.getDate() + 7);
  if (date < startOfNextWeek) return "שבוע הבא";
  return hebrewMonthLabel(utcDateForISO(toISO(date)));
}

function renderList(events) {
  eventsView.className = "";
  if (!events.length) {
    const searched = $("#search-input").value.trim();
    const heading = searched ? "לא מצאנו אירועים כאלה" : activeView === "upcoming" ? "אין אירועים באופק" : "היומן שלך מתחיל כאן";
    const text = searched ? "נסי לחפש בשם אחר או להסיר את החיפוש." : activeView === "upcoming" ? "כשתוסיפי אירועים, הם יופיעו כאן." : "ימי הולדת, פגישות, חגים וכל רגע שתרצי לזכור — כולם מחכים למקום משלהם.";
    eventsView.innerHTML = `<div class="empty-state"><div class="empty-illustration">✳</div><h3>${heading}</h3><p>${text}</p>${searched ? "" : '<button class="primary-button" data-empty-add>＋ הוספת אירוע ראשון</button>'}</div>`;
    const button = eventsView.querySelector("[data-empty-add]");
    if (button) button.addEventListener("click", () => openEventForm());
    return;
  }
  const groups = new Map();
  events.forEach((event) => {
    const iso = nextOccurrenceISO(event);
    if (!iso) return;
    const date = localDateFromISO(iso);
    const key = showPastFirst && date < dateOnly(new Date()) ? "אירועים קודמים" : groupTitle(date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
  });
  eventsView.innerHTML = [...groups].map(([heading, items]) => `
    <div class="event-group-heading">${escapeHTML(heading)}</div>
    <div class="event-list">${items.map((event) => eventRow(event)).join("")}</div>`).join("");
  eventsView.querySelectorAll("[data-event-id]").forEach((row) => {
    row.addEventListener("click", () => openEventForm(row.dataset.eventId));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openEventForm(row.dataset.eventId);
      }
    });
  });
}

function eventRow(event) {
  const iso = nextOccurrenceISO(event);
  const date = iso ? localDateFromISO(iso) : new Date();
  const hebrewDate = iso ? hebrewParts(utcDateForISO(iso)) : { day: event.hebrewDay, month: event.hebrewMonth, year: event.hebrewYear };
  const calendar = calendarFor(event);
  const color = COLORS.includes(event.color) ? event.color : calendar.color;
  return `<article class="event-row" data-event-id="${escapeHTML(event.id)}" tabindex="0" role="button" aria-label="עריכת ${escapeHTML(event.name)}">
    <div class="event-date-badge ${color}"><span class="badge-day">${hebrewNumber(hebrewDate.day)}</span><span class="badge-month">${escapeHTML(hebrewMonthName(hebrewDate.month, hebrewDate.year))}</span></div>
    <div class="event-main"><h3 class="event-title">${escapeHTML(event.name)}</h3><div class="event-meta"><span>${escapeHTML(dateLabel(event))}</span><span>·</span><span class="calendar-tag"><i class="calendar-dot ${calendar.color}"></i>${escapeHTML(calendar.name)}</span>${event.reminder ? `<span class="reminder-tag">· ${reminderLabel(event.reminder)}</span>` : ""}</div></div>
    <div class="row-trailing">${iso ? escapeHTML(relativeDate(date)) : ""}<span class="row-arrow">‹</span></div>
  </article>`;
}

function renderCalendar(events) {
  const monthParts = hebrewParts(visibleMonth);
  const firstDay = new CalendarDate(HEBREW_CALENDAR, monthParts.year, monthParts.month, 1);
  const firstWeekday = firstDay.toDate("UTC").getUTCDay();
  const daysInMonth = HEBREW_CALENDAR.getDaysInMonth(firstDay);
  const totalCells = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;
  const weekdays = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
  const todayIso = toISO(new Date());
  const days = Array.from({ length: totalCells }, (_, index) => {
    const dayIndex = index - firstWeekday;
    if (dayIndex < 0 || dayIndex >= daysInMonth) return '<div class="calendar-day blank" aria-hidden="true"></div>';
    const hebrewDate = new CalendarDate(HEBREW_CALENDAR, monthParts.year, monthParts.month, dayIndex + 1);
    const iso = utcDateToISO(hebrewDate.toDate("UTC"));
    const matching = events.filter((event) => occurrenceISOInYear(event, monthParts.year) === iso);
    const day = hebrewDate.day;
    const label = `${hebrewNumber(day)} ב${hebrewMonthName(monthParts.month, monthParts.year)} ${hebrewNumber(monthParts.year, true)}`;
    return `<div class="calendar-day${iso === todayIso ? " today" : ""}" data-calendar-date="${iso}" tabindex="0" role="button" aria-label="${label}${matching.length ? `, ${matching.length} אירועים` : ""}">
      <span class="day-number">${hebrewNumber(day)}</span>
      <div class="day-events">${matching.slice(0, 2).map((event) => `<span class="day-event ${COLORS.includes(event.color) ? event.color : calendarFor(event).color}" title="${escapeHTML(event.name)}">${escapeHTML(event.name)}</span>`).join("")}${matching.length > 2 ? `<span class="day-more">+${matching.length - 2} נוספים</span>` : ""}</div>
    </div>`;
  }).join("");
  const calendars = selectedCalendar === "all" ? state.calendars : state.calendars.filter((calendar) => calendar.id === selectedCalendar);
  eventsView.className = "calendar-view";
  eventsView.innerHTML = `<div class="calendar-month-toolbar"><div class="calendar-month-title">${hebrewMonthLabel(visibleMonth)}</div><div class="month-nav"><button data-month-prev aria-label="חודש קודם">›</button><button class="today-button" data-month-today>היום</button><button data-month-next aria-label="חודש הבא">‹</button></div></div><div class="calendar-grid">${weekdays.map((day) => `<div class="weekday">${day}</div>`).join("")}${days}</div><div class="calendar-legend">${calendars.map((calendar) => `<span class="legend-item"><i class="legend-dot ${calendar.color}"></i>${escapeHTML(calendar.name)}</span>`).join("")}</div>`;
  eventsView.querySelector("[data-month-prev]").addEventListener("click", () => { visibleMonth = nextHebrewMonthStart(visibleMonth, -1); render(); });
  eventsView.querySelector("[data-month-next]").addEventListener("click", () => { visibleMonth = nextHebrewMonthStart(visibleMonth, 1); render(); });
  eventsView.querySelector("[data-month-today]").addEventListener("click", () => {
    const today = currentHebrewDate();
    visibleMonth = findGregorianDate(today.year, today.month, 1);
    render();
  });
  eventsView.querySelectorAll("[data-calendar-date]").forEach((cell) => {
    const openDate = () => {
      const iso = cell.dataset.calendarDate;
      const event = events.find((item) => occurrenceISOInYear(item, monthParts.year) === iso);
      if (event) openEventForm(event.id);
      else openEventForm(null, iso);
    };
    cell.addEventListener("dblclick", openDate);
    cell.addEventListener("keydown", (keyEvent) => { if (keyEvent.key === "Enter") openDate(); });
  });
}

function render() {
  renderCalendars();
  renderStats();
  const filtered = filteredEvents();
  const filter = $("#active-filter");
  if (selectedCalendar !== "all") {
    filter.hidden = false;
    filter.textContent = `מוצגים אירועים בלוח ${calendarFor({ calendarId: selectedCalendar }).name}`;
  } else {
    filter.hidden = true;
    filter.textContent = "";
  }
  if (activeView === "calendar") renderCalendar(filtered);
  else renderList(showPastFirst ? [...filtered].reverse() : filtered);
  checkReminders();
  updateNotificationButton();
}

function updateNotificationButton() {
  const supported = "Notification" in window;
  const granted = supported && Notification.permission === "granted";
  $("#notification-dot").classList.toggle("enabled", granted);
  $("#notification-button").title = granted ? "ההתראות מופעלות" : "הפעלת התראות";
  $("#notification-button").setAttribute("aria-label", granted ? "ההתראות מופעלות" : "הפעלת התראות");
}

function openEventForm(id = null, presetISO = null) {
  editingEventId = id;
  const event = id ? state.events.find((item) => item.id === id) : null;
  $("#event-form").reset();
  $("#form-error").textContent = "";
  $("#form-title").innerHTML = event ? "עריכת אירוע<span class=\"title-period\">.</span>" : "אירוע חדש<span class=\"title-period\">.</span>";
  $("#delete-event").hidden = !event;
  $("#event-calendar").replaceChildren(...state.calendars.map((calendar) => new Option(calendar.name, calendar.id)));
  const defaultCalendar = selectedCalendar !== "all" && state.calendars.some((calendar) => calendar.id === selectedCalendar)
    ? selectedCalendar
    : state.calendars[0]?.id;
  $("#event-calendar").value = event?.calendarId || defaultCalendar;
  if (event) {
    $("#event-name").value = event.name;
    $("#event-calendar").value = event.calendarId;
    $("#event-color").value = event.color || "lavender";
    $("#event-reminder").value = String(event.reminder || 0);
    $("#event-notes").value = event.notes || "";
    $("#event-repeat").checked = !!event.repeatYearly;
  }
  if (!event) {
    $("#event-color").value = calendarFor({ calendarId: $("#event-calendar").value }).color;
    $("#event-repeat").checked = true;
  }
  const hdate = event
    ? { year: event.hebrewYear, month: event.hebrewMonth, day: event.hebrewDay }
    : presetISO ? hebrewParts(utcDateForISO(presetISO)) : currentHebrewDate();
  $("#hebrew-year").value = hebrewNumber(hdate.year, true);
  populateHebrewMonths(hdate.month, hdate.day);
  eventDialog.showModal();
  $("#event-name").focus();
}

function populateHebrewMonths(selectedMonth, selectedDay = 1) {
  const year = parseHebrewYear($("#hebrew-year").value);
  const select = $("#hebrew-month");
  if (!Number.isInteger(year)) {
    select.replaceChildren();
    $("#hebrew-day").replaceChildren();
    return;
  }
  const months = hebrewMonthOptions(year);
  select.replaceChildren(...months.map((month) => new Option(hebrewMonthName(month, year), String(month))));
  if (months.includes(Number(selectedMonth))) select.value = String(selectedMonth);
  populateHebrewDays(selectedDay);
}

function populateHebrewDays(preferredDay = 1) {
  const year = parseHebrewYear($("#hebrew-year").value);
  const month = Number($("#hebrew-month").value);
  const firstDay = hebrewMonthOptions(year).includes(month) ? new CalendarDate(HEBREW_CALENDAR, year, month, 1) : null;
  const count = firstDay ? HEBREW_CALENDAR.getDaysInMonth(firstDay) : 0;
  const days = Array.from({ length: count }, (_, index) => index + 1);
  $("#hebrew-day").replaceChildren(...days.map((day) => new Option(hebrewNumber(day), String(day))));
  if (days.includes(preferredDay)) $("#hebrew-day").value = String(preferredDay);
}

function closeDialog(dialog) {
  if (dialog.open) dialog.close();
}

function handleEventSubmit(formEvent) {
  formEvent.preventDefault();
  const name = $("#event-name").value.trim();
  const error = $("#form-error");
  error.textContent = "";
  if (!name) {
    error.textContent = "תני לאירוע שם קטן, כדי שנדע מה לחגוג.";
    $("#event-name").focus();
    return;
  }
  const hebrewYear = parseHebrewYear($("#hebrew-year").value);
  if (!Number.isInteger(hebrewYear)) {
    error.textContent = "כתבי שנה עברית באותיות, למשל תשפ״ז.";
    $("#hebrew-year").focus();
    return;
  }
  const hebrewMonth = Number($("#hebrew-month").value);
  const hebrewDay = Number($("#hebrew-day").value);
  const date = findGregorianDate(hebrewYear, hebrewMonth, hebrewDay);
  if (!date) {
    error.textContent = "לא הצלחנו למצוא את התאריך העברי הזה. בדקי את היום והחודש.";
    return;
  }
  const old = editingEventId && state.events.find((item) => item.id === editingEventId);
  const event = {
    id: old?.id || createId(),
    name,
    hebrewYear,
    hebrewMonth,
    hebrewDay,
    repeatYearly: $("#event-repeat").checked,
    dateKind: "hebrew",
    calendarId: $("#event-calendar").value,
    color: $("#event-color").value,
    reminder: Number($("#event-reminder").value),
    notes: $("#event-notes").value.trim(),
  };
  const previousEvents = [...state.events];
  const previousNotified = [...state.notified];
  if (old) {
    state.events = state.events.map((item) => item.id === old.id ? event : item);
    const anchorChanged = old.hebrewMonth !== hebrewMonth || old.hebrewDay !== hebrewDay || old.hebrewYear !== hebrewYear || old.repeatYearly !== event.repeatYearly;
    if (anchorChanged) state.notified = state.notified.filter((id) => !id.startsWith(`${old.id}:`));
  } else {
    state.events.push(event);
  }
  if (!saveState()) {
    state.events = previousEvents;
    state.notified = previousNotified;
    return;
  }
  const anchorIso = nextOccurrenceISO(event);
  const anchor = anchorIso ? hebrewParts(utcDateForISO(anchorIso)) : { year: hebrewYear, month: hebrewMonth };
  visibleMonth = findGregorianDate(anchor.year, anchor.month, 1);
  if (selectedCalendar !== "all" && selectedCalendar !== event.calendarId) {
    selectedCalendar = event.calendarId;
  }
  closeDialog(eventDialog);
  render();
  showToast(old ? "האירוע עודכן בהצלחה ✳" : "האירוע נשמר ביומן ✳");
  if (event.reminder && "Notification" in window && Notification.permission === "default") {
    enableNotifications(false);
  }
}

function deleteEvent() {
  if (!editingEventId) return;
  const previousEvents = [...state.events];
  const previousNotified = [...state.notified];
  state.events = state.events.filter((event) => event.id !== editingEventId);
  state.notified = state.notified.filter((id) => !id.startsWith(`${editingEventId}:`));
  if (!saveState()) {
    state.events = previousEvents;
    state.notified = previousNotified;
    return;
  }
  closeDialog(eventDialog);
  render();
  showToast("האירוע הוסר מהיומן.");
}

async function enableNotifications(announce = true) {
  if (!("Notification" in window)) {
    showToast("הדפדפן הזה לא תומך בהתראות.", true);
    return;
  }
  if (!window.isSecureContext) {
    showToast("כדי לקבל התראות, צריך לפתוח את האתר בחיבור מאובטח (HTTPS).", true);
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    updateNotificationButton();
    if (permission === "granted") {
      if (announce) showToast("ההתראות הופעלו. נעדכן אותך כשהאירוע יתקרב ✳");
      checkReminders();
    } else if (permission === "denied") {
      showToast("ההתראות חסומות בהגדרות הדפדפן. אפשר לשנות זאת בכל עת.", true);
    } else if (announce) {
      showToast("לא הופעלה הרשאה להתראות.");
    }
  } catch (error) {
    console.error("Could not request notification permission.", error);
    showToast("לא הצלחנו להפעיל התראות במכשיר הזה.", true);
  }
}

function checkReminders() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const now = Date.now();
  let changed = false;
  state.events.forEach((event) => {
    if (!event.reminder) return;
    const iso = nextOccurrenceISO(event);
    if (!iso) return;
    const occurrenceHebrewYear = hebrewParts(utcDateForISO(iso)).year;
    const reminderId = `${event.id}:${occurrenceHebrewYear}:${event.reminder}`;
    const reminderAt = localDateFromISO(iso).getTime() - Number(event.reminder) * 60000;
    if (now >= reminderAt && now < localDateFromISO(iso).getTime() + 86400000 && !state.notified.includes(reminderId)) {
      try {
        const date = localDateFromISO(iso);
        const notification = new Notification(`מתקרב: ${event.name}`, {
          body: `${relativeDate(date)} · ${dateLabel(event)}`,
          icon: "icon.svg",
          tag: reminderId,
        });
        notification.onclick = () => {
          window.focus();
          setView("list");
          openEventForm(event.id);
          notification.close();
        };
        state.notified.push(reminderId);
        changed = true;
      } catch (error) {
        console.error("Could not show event reminder.", error);
        showToast("לא הצלחנו להציג תזכורת. בדקי את הגדרות ההתראות.", true);
      }
    }
  });
  if (changed) saveState();
}

function createCalendar(formEvent) {
  formEvent.preventDefault();
  const name = $("#calendar-name").value.trim();
  const error = $("#calendar-error");
  error.textContent = "";
  if (!name) {
    error.textContent = "תני ללוח שם כדי שאפשר יהיה למצוא אותו.";
    return;
  }
  if (state.calendars.some((calendar) => calendar.name.toLocaleLowerCase("he") === name.toLocaleLowerCase("he"))) {
    error.textContent = "כבר יש לך לוח בשם הזה.";
    return;
  }
  const calendar = { id: createId(), name, color: $("#calendar-color").value };
  state.calendars.push(calendar);
  if (!saveState()) {
    state.calendars.pop();
    return;
  }
  selectedCalendar = calendar.id;
  closeDialog(calendarDialog);
  $("#calendar-form").reset();
  render();
  showToast(`הלוח "${name}" נוצר בהצלחה ✳`);
}

function handleSort() {
  showPastFirst = !showPastFirst;
  $("#sort-button").innerHTML = `${showPastFirst ? "הקודמים קודם" : "הקרובים קודם"} <span>⌄</span>`;
  render();
}

document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
$("#new-event-top").addEventListener("click", () => openEventForm());
$("#new-event-main").addEventListener("click", () => openEventForm());
$("#mobile-add").addEventListener("click", () => openEventForm());
$("#add-calendar").addEventListener("click", () => { $("#calendar-error").textContent = ""; calendarDialog.showModal(); $("#calendar-name").focus(); });
$("#event-form").addEventListener("submit", handleEventSubmit);
$("#calendar-form").addEventListener("submit", createCalendar);
$("#delete-event").addEventListener("click", deleteEvent);
$("#notification-button").addEventListener("click", () => enableNotifications(true));
$("#search-input").addEventListener("input", render);
$("#sort-button").addEventListener("click", handleSort);
$("#hebrew-year").addEventListener("input", () => populateHebrewMonths(null, 1));
$("#hebrew-month").addEventListener("change", () => populateHebrewDays(1));
$("#event-calendar").addEventListener("change", () => { if (!editingEventId) $("#event-color").value = calendarFor({ calendarId: $("#event-calendar").value }).color; });
document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => closeDialog(button.closest("dialog"))));
[eventDialog, calendarDialog].forEach((dialog) => dialog.addEventListener("click", (event) => {
  if (event.target === dialog) closeDialog(dialog);
}));
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  $("#install-app").hidden = false;
});
$("#install-app").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("#install-app").hidden = true;
});
window.addEventListener("online", () => showToast("חזרנו לרשת. היומן שלך מעודכן."));
window.addEventListener("focus", checkReminders);
document.addEventListener("visibilitychange", () => { if (!document.hidden) checkReminders(); });
setInterval(checkReminders, 30000);

if ("serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch((error) => {
    console.error("Could not register service worker.", error);
  }));
}

if (!("Notification" in window) || Notification.permission !== "granted") {
  $("#notification-dot").classList.remove("enabled");
}
const todayHebrew = currentHebrewDate();
visibleMonth = findGregorianDate(todayHebrew.year, todayHebrew.month, 1);
render();
