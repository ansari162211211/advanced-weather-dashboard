/**
 * SkyCast — Real-time Weather Dashboard
 * Fetch API + async/await, nested JSON parsing, comprehensive error handling
 */

const API_KEY = "REPLACE_WITH_YOUR_OPENWEATHERMAP_API_KEY";
const STORAGE = {
  apiKey: "wx_api_key",
  favs: "wx_favs",
  last: "wx_last",
  recent: "wx_recent",
};

const $ = (sel) => document.querySelector(sel);
const $all = (sel) => Array.from(document.querySelectorAll(sel));

let localTimeTimer = null;
let autoRefreshTimer = null;
let lastPayload = null;

/* ——— UI helpers ——— */

function showToast(msg, timeout = 3200) {
  const t = $("#toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.remove("hidden");
  t.classList.add("show");
  clearTimeout(showToast._tid);
  showToast._tid = setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.classList.add("hidden"), 300);
  }, timeout);
}

function setLoading(on) {
  $("#loader")?.classList.toggle("hidden", !on);
}

function showError(message) {
  const el = $("#errorMessage");
  if (!el) return;
  if (!message) {
    el.classList.add("hidden");
    el.innerHTML = "";
    return;
  }
  el.innerHTML = `<i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i>${message}`;
  el.classList.remove("hidden");
}

function setResultsVisible(visible) {
  $("#weatherResults")?.classList.toggle("hidden", !visible);
  $("#emptyState")?.classList.toggle("hidden", visible);
}

function getUnits() {
  return $("#unitToggle")?.checked ? "F" : "C";
}

/* ——— API key (localStorage) ——— */

function getStoredApiKey() {
  try {
    const stored = localStorage.getItem(STORAGE.apiKey);
    if (stored) return stored;
    if (API_KEY && !API_KEY.includes("REPLACE")) return API_KEY;
    return null;
  } catch {
    return null;
  }
}

/* ——— Fetch with error handling ——— */

function mapHttpError(status, body) {
  const code = body?.cod;
  const msg = body?.message;
  if (status === 401 || code === 401)
    return "Invalid API key. Open Settings and paste a valid OpenWeatherMap key.";
  if (status === 404 || code === "404")
    return "City not found. Check spelling or try another name.";
  if (status === 429) return "Too many requests. Wait a moment and try again.";
  if (status >= 500) return "Weather service is temporarily unavailable. Try again later.";
  if (msg) return msg;
  return `Request failed (HTTP ${status}).`;
}

async function fetchJSON(url) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new Error(
      "Network error — check your internet connection and try again.",
    );
  }

  let data;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Invalid response from weather service (not JSON).");
  }

  if (!res.ok) {
    throw new Error(mapHttpError(res.status, data));
  }

  if (data.cod && Number(data.cod) >= 400) {
    throw new Error(mapHttpError(Number(data.cod), data));
  }

  return data;
}

async function fetchWeatherByQuery(query) {
  const key = getStoredApiKey();
  if (!key) {
    throw new Error(
      "Missing API key — click the gear icon and add your free OpenWeatherMap key.",
    );
  }

  const q = encodeURIComponent(query);
  const base = "https://api.openweathermap.org/data/2.5";
  const curUrl = `${base}/weather?q=${q}&units=metric&appid=${key}`;
  const fcastUrl = `${base}/forecast?q=${q}&units=metric&appid=${key}`;

  setLoading(true);
  showError("");
  try {
    const [cur, fcast] = await Promise.all([
      fetchJSON(curUrl),
      fetchJSON(fcastUrl),
    ]);
    return { cur, fcast };
  } finally {
    setLoading(false);
  }
}

async function fetchWeatherByCoords(lat, lon) {
  const key = getStoredApiKey();
  if (!key) {
    throw new Error(
      "Missing API key — click the gear icon and add your OpenWeatherMap key.",
    );
  }

  const base = "https://api.openweathermap.org/data/2.5";
  const curUrl = `${base}/weather?lat=${lat}&lon=${lon}&units=metric&appid=${key}`;
  const fcastUrl = `${base}/forecast?lat=${lat}&lon=${lon}&units=metric&appid=${key}`;

  setLoading(true);
  showError("");
  try {
    const [cur, fcast] = await Promise.all([
      fetchJSON(curUrl),
      fetchJSON(fcastUrl),
    ]);
    return { cur, fcast };
  } finally {
    setLoading(false);
  }
}

/* ——— Formatting ——— */

function formatTemp(celsius, units) {
  if (celsius == null || Number.isNaN(celsius)) return "--";
  if (units === "F") return `${((celsius * 9) / 5 + 32).toFixed(1)}°F`;
  return `${Number(celsius).toFixed(1)}°C`;
}

function formatTime(unixSec, tzOffsetSec) {
  if (!unixSec) return "--";
  const utcMs = unixSec * 1000;
  const local = new Date(utcMs + (tzOffsetSec || 0) * 1000);
  return local.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function windDirection(deg) {
  if (deg == null) return "";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

function capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ——— Background by condition ——— */

const BG_CLASSES = [
  "bg_Clear",
  "bg_Clouds",
  "bg_Rain",
  "bg_Snow",
  "bg_Drizzle",
  "bg_Thunderstorm",
  "bg_Mist",
  "bg_Fog",
  "bg_Haze",
];

function setWeatherBackground(main) {
  document.body.classList.remove(...BG_CLASSES);
  if (!main) return;
  const safe = String(main).replace(/\s+/g, "");
  document.body.classList.add(`bg_${safe}`);
}

/* ——— Local city time ——— */

function updateLocalTime(tzOffsetSec) {
  if (localTimeTimer) clearInterval(localTimeTimer);
  const el = $("#localTime");
  if (!el) return;

  function tick() {
    const now = Date.now();
    const utc =
      new Date(now).getTime() + new Date().getTimezoneOffset() * 60000;
    const local = new Date(utc + (tzOffsetSec || 0) * 1000);
    el.textContent = local.toLocaleString([], {
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      month: "short",
      day: "numeric",
    });
  }
  tick();
  localTimeTimer = setInterval(tick, 1000);
}

/* ——— Render nested JSON ——— */

function renderCurrent(cur, units) {
  if (!cur) return;

  const w = cur.weather?.[0] || {};
  const main = cur.main || {};
  const wind = cur.wind || {};
  const sys = cur.sys || {};

  $("#cityName").textContent = `${cur.name || "Unknown"}${sys.country ? `, ${sys.country}` : ""}`;
  $("#coords").textContent =
    cur.coord != null
      ? `${cur.coord.lat?.toFixed(2)}° lat · ${cur.coord.lon?.toFixed(2)}° lon`
      : "";
  $("#weatherDescription").textContent = capitalize(w.description || w.main || "—");
  $("#weatherIcon").src = `https://openweathermap.org/img/wn/${w.icon || "01d"}@2x.png`;
  $("#weatherIcon").alt = w.description || "Weather icon";
  $("#temperature").textContent = formatTemp(main.temp, units);
  $("#tempRange").textContent = `Low ${formatTemp(main.temp_min, units)} · High ${formatTemp(main.temp_max, units)}`;

  $("#humidity").textContent = main.humidity != null ? `${main.humidity}%` : "--";
  $("#windSpeed").textContent =
    wind.speed != null ? `${wind.speed} m/s` : "--";
  $("#windDir").textContent =
    wind.deg != null ? windDirection(wind.deg) : "";
  $("#feelsLike").textContent = formatTemp(main.feels_like, units);
  $("#visibility").textContent =
    cur.visibility != null ? `${(cur.visibility / 1000).toFixed(1)} km` : "--";
  $("#pressure").textContent =
    main.pressure != null ? `${main.pressure} hPa` : "--";
  $("#cloudiness").textContent =
    cur.clouds?.all != null ? `${cur.clouds.all}%` : "--";
  $("#tempMin").textContent = formatTemp(main.temp_min, units);
  $("#tempMax").textContent = formatTemp(main.temp_max, units);
  $("#sunrise").textContent = formatTime(sys.sunrise, cur.timezone);
  $("#sunset").textContent = formatTime(sys.sunset, cur.timezone);

  const updated = new Date();
  $("#lastUpdated").textContent = updated.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  setWeatherBackground(w.main);
  updateLocalTime(cur.timezone);
}

function renderHourlyForecast(fcast, units) {
  const row = $("#forecastRow");
  if (!row) return;
  row.innerHTML = "";
  if (!fcast?.list?.length) return;

  fcast.list.slice(0, 8).forEach((item) => {
    const w = item.weather?.[0] || {};
    const d = new Date(item.dt * 1000);
    const el = document.createElement("article");
    el.className = "forecast-item";
    el.innerHTML = `
      <div class="time">${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
      <img src="https://openweathermap.org/img/wn/${w.icon}@2x.png" alt="${w.description || ""}" width="56" height="56" />
      <div class="t">${formatTemp(item.main?.temp, units)}</div>
      <div class="desc">${w.main || ""}</div>
    `;
    row.appendChild(el);
  });
}

function renderDailyForecast(fcast, units) {
  const grid = $("#dailyForecast");
  if (!grid) return;
  grid.innerHTML = "";
  if (!fcast?.list?.length) return;

  const byDay = {};
  fcast.list.forEach((item) => {
    const dayKey = new Date(item.dt * 1000).toLocaleDateString();
    if (!byDay[dayKey]) {
      byDay[dayKey] = {
        date: new Date(item.dt * 1000),
        temps: [],
        icon: item.weather?.[0]?.icon,
        main: item.weather?.[0]?.main,
      };
    }
    byDay[dayKey].temps.push(item.main?.temp);
    const hour = new Date(item.dt * 1000).getHours();
    if (hour >= 11 && hour <= 14) {
      byDay[dayKey].icon = item.weather?.[0]?.icon;
      byDay[dayKey].main = item.weather?.[0]?.main;
    }
  });

  Object.values(byDay)
    .slice(0, 5)
    .forEach((day) => {
      const min = Math.min(...day.temps.filter((t) => t != null));
      const max = Math.max(...day.temps.filter((t) => t != null));
      const label =
        day.date.toDateString() === new Date().toDateString()
          ? "Today"
          : day.date.toLocaleDateString([], { weekday: "short" });

      const card = document.createElement("article");
      card.className = "daily-card";
      card.innerHTML = `
        <div class="day">${label}</div>
        <img src="https://openweathermap.org/img/wn/${day.icon || "01d"}@2x.png" alt="${day.main || ""}" width="48" height="48" />
        <div class="range">
          <strong>${formatTemp(max, units)}</strong> / ${formatTemp(min, units)}
        </div>
      `;
      grid.appendChild(card);
    });
}

function bindResultActions(data) {
  const { cur, fcast } = data;
  $("#favBtn").onclick = () => addFavorite(cur.name);
  $("#copyBtn").onclick = () =>
    copyJSON({ current: cur, forecast: fcast });
  $("#downloadBtn").onclick = () =>
    downloadJSON(
      { current: cur, forecast: fcast },
      `${(cur.name || "weather").replace(/\s+/g, "_")}_weather.json`,
    );

  const shareBtn = $("#shareBtn");
  if (navigator.share && shareBtn) {
    shareBtn.classList.remove("hidden");
    shareBtn.onclick = () =>
      navigator
        .share({
          title: `Weather: ${cur.name}`,
          text: `${cur.name}: ${cur.weather?.[0]?.description}, ${formatTemp(cur.main?.temp, getUnits())}`,
          url: location.href,
        })
        .catch(() => showToast("Share cancelled"));
  } else {
    shareBtn?.classList.add("hidden");
  }
}

function displayWeather(data) {
  const units = getUnits();
  lastPayload = data;
  renderCurrent(data.cur, units);
  renderHourlyForecast(data.fcast, units);
  renderDailyForecast(data.fcast, units);
  bindResultActions(data);
  setResultsVisible(true);

  const city = data.cur.name;
  localStorage.setItem(STORAGE.last, city);
  addRecentSearch(city);
  updateFavButtonState(city);
}

function updateFavButtonState(city) {
  const favs = loadFavorites();
  const btn = $("#favBtn");
  if (!btn) return;
  const icon = btn.querySelector("i");
  const isFav = favs.includes(city);
  if (icon) {
    icon.className = isFav ? "fa-solid fa-star" : "fa-regular fa-star";
  }
  btn.setAttribute("aria-pressed", String(isFav));
}

/* ——— Recent searches ——— */

function loadRecent() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE.recent) || "[]");
  } catch {
    return [];
  }
}

function saveRecent(list) {
  localStorage.setItem(STORAGE.recent, JSON.stringify(list.slice(0, 8)));
}

function addRecentSearch(city) {
  if (!city) return;
  let list = loadRecent().filter((c) => c.toLowerCase() !== city.toLowerCase());
  list.unshift(city);
  saveRecent(list);
  renderRecent();
}

function renderRecent() {
  const list = loadRecent();
  const wrap = $("#recentSearches");
  const inner = $("#recentList");
  if (!wrap || !inner) return;

  if (!list.length) {
    wrap.classList.add("hidden");
    return;
  }

  wrap.classList.remove("hidden");
  inner.innerHTML = "";
  list.forEach((city) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip";
    btn.textContent = city;
    btn.addEventListener("click", () => {
      $("#cityInput").value = city;
      doSearch(city);
    });
    inner.appendChild(btn);
  });
}

/* ——— Favorites ——— */

function loadFavorites() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE.favs) || "[]");
  } catch {
    return [];
  }
}

function saveFavorites(list) {
  localStorage.setItem(STORAGE.favs, JSON.stringify(list));
}

function addFavorite(city) {
  const favs = loadFavorites();
  const idx = favs.indexOf(city);
  if (idx > -1) {
    favs.splice(idx, 1);
    saveFavorites(favs);
    showToast(`${city} removed from favorites`);
  } else {
    favs.push(city);
    saveFavorites(favs);
    showToast(`${city} added to favorites`);
  }
  renderFavoritesPanel();
  updateFavButtonState(city);
}

function renderFavoritesPanel() {
  const wrap = $("#favorites-list-inner");
  if (!wrap) return;
  const favs = loadFavorites();
  wrap.innerHTML = "";

  if (!favs.length) {
    wrap.innerHTML = '<p class="empty-favs">No favorites yet. Search a city and tap Favorite.</p>';
    return;
  }

  favs.forEach((city) => {
    const div = document.createElement("div");
    div.className = "fav-entry";
    div.innerHTML = `<span>${city}</span><div><button type="button" class="open-fav">Open</button><button type="button" class="remove-fav" aria-label="Remove">✕</button></div>`;
    wrap.appendChild(div);
    div.querySelector(".open-fav").addEventListener("click", () => {
      $("#cityInput").value = city;
      doSearch(city);
      $("#favoritesList").classList.add("hidden");
    });
    div.querySelector(".remove-fav").addEventListener("click", () => {
      const next = loadFavorites().filter((c) => c !== city);
      saveFavorites(next);
      renderFavoritesPanel();
      showToast(`Removed ${city}`);
    });
  });
}

/* ——— Clipboard & download ——— */

function copyJSON(obj) {
  const text = JSON.stringify(obj, null, 2);
  if (!navigator.clipboard) {
    showToast("Clipboard not available in this browser");
    return;
  }
  navigator.clipboard
    .writeText(text)
    .then(() => showToast("Weather JSON copied to clipboard"))
    .catch(() => showToast("Copy failed"));
}

function downloadJSON(obj, name = "weather.json") {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Download started");
}

/* ——— Search ——— */

async function doSearch(cityOverride) {
  const city = (cityOverride || $("#cityInput")?.value || "").trim();
  if (!city) {
    showToast("Please enter a city name");
    $("#cityInput")?.focus();
    return;
  }

  $("#cityInput").value = city;

  try {
    const data = await fetchWeatherByQuery(city);
    displayWeather(data);
  } catch (err) {
    console.error(err);
    setResultsVisible(false);
    showError(err.message || "Failed to load weather data.");
    showToast(err.message || "Request failed");
  }
}

async function useGeolocation() {
  if (!navigator.geolocation) {
    showToast("Geolocation is not supported in this browser");
    return;
  }

  setLoading(true);
  navigator.geolocation.getCurrentPosition(
    async (pos) => {
      try {
        const data = await fetchWeatherByCoords(
          pos.coords.latitude,
          pos.coords.longitude,
        );
        $("#cityInput").value = data.cur.name || "";
        displayWeather(data);
        showToast(`Loaded weather for ${data.cur.name}`);
      } catch (err) {
        setResultsVisible(false);
        showError(err.message);
        showToast(err.message);
      }
    },
    (err) => {
      setLoading(false);
      const msg =
        err.code === 1
          ? "Location permission denied."
          : "Could not detect your location.";
      showError(msg);
      showToast(msg);
    },
    { timeout: 12000, maximumAge: 60000 },
  );
}

/* ——— Auto refresh ——— */

function startAutoRefresh() {
  if (autoRefreshTimer) return;
  autoRefreshTimer = setInterval(() => {
    const last = localStorage.getItem(STORAGE.last);
    if (last) {
      $("#cityInput").value = last;
      doSearch(last);
    }
  }, 10 * 60 * 1000);
  $("#autoRefreshBtn")?.classList.add("active");
  $("#autoRefreshBtn")?.setAttribute("aria-pressed", "true");
  showToast("Auto-refresh on (every 10 minutes)");
}

function stopAutoRefresh() {
  if (!autoRefreshTimer) return;
  clearInterval(autoRefreshTimer);
  autoRefreshTimer = null;
  $("#autoRefreshBtn")?.classList.remove("active");
  $("#autoRefreshBtn")?.setAttribute("aria-pressed", "false");
  showToast("Auto-refresh off");
}

/* ——— Init ——— */

function init() {
  $("#searchForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    doSearch();
  });

  $("#geoBtn")?.addEventListener("click", useGeolocation);

  $all(".sample-city").forEach((btn) => {
    btn.addEventListener("click", () => {
      $("#cityInput").value = btn.textContent.trim();
      doSearch();
    });
  });

  $("#open-favs")?.addEventListener("click", () => {
    $("#favoritesList")?.classList.toggle("hidden");
    renderFavoritesPanel();
  });

  $("#close-favs")?.addEventListener("click", () => {
    $("#favoritesList")?.classList.add("hidden");
  });

  $("#unitToggle")?.addEventListener("change", () => {
    if (lastPayload) displayWeather(lastPayload);
    else {
      const last = localStorage.getItem(STORAGE.last);
      if (last) {
        $("#cityInput").value = last;
        doSearch(last);
      }
    }
  });

  $("#autoRefreshBtn")?.addEventListener("click", () => {
    if (autoRefreshTimer) stopAutoRefresh();
    else startAutoRefresh();
  });

  $("#settingsBtn")?.addEventListener("click", () => {
    $("#settingsPanel")?.classList.remove("hidden");
    const inp = $("#apiKeyInput");
    if (inp) {
      inp.value = localStorage.getItem(STORAGE.apiKey) || "";
      inp.focus();
    }
  });

  $("#closeSettings")?.addEventListener("click", () => {
    $("#settingsPanel")?.classList.add("hidden");
  });

  $("#saveApiKey")?.addEventListener("click", () => {
    const k = ($("#apiKeyInput")?.value || "").trim();
    if (!k) {
      showToast("Enter a valid API key");
      return;
    }
    localStorage.setItem(STORAGE.apiKey, k);
    showToast("API key saved locally");
    $("#settingsPanel")?.classList.add("hidden");
  });

  $("#clearApiKey")?.addEventListener("click", () => {
    localStorage.removeItem(STORAGE.apiKey);
    const inp = $("#apiKeyInput");
    if (inp) inp.value = "";
    showToast("API key cleared");
  });

  $("#settingsPanel")?.addEventListener("click", (e) => {
    if (e.target.id === "settingsPanel") {
      $("#settingsPanel").classList.add("hidden");
    }
  });

  const last = localStorage.getItem(STORAGE.last);
  if (last) $("#cityInput").value = last;

  renderRecent();
  setResultsVisible(false);
}

document.addEventListener("DOMContentLoaded", init);
