const stages = [
  ["Idea", "A single unsettling image. We follow it until it becomes a scene."],
  ["Generation", "Thousands of frames summoned, discarded, summoned again."],
  ["Direction", "We shape light, weather, silence. The machine renders; we direct."],
  ["Edit", "Rhythm, restraint, and the cuts that decide what you are allowed to see."],
  ["Film", "It exits as cinema. Nothing about it was ever filmed."],
];

const filmList = document.querySelector("#film-list");
const filmCount = document.querySelector("#film-count");
const filmPlayer = document.querySelector("#film-player");
const filmPlayerPlaceholder = document.querySelector("#film-player-placeholder");
const selectedFilmTitle = document.querySelector("#selected-film-title");
const selectedFilmDescription = document.querySelector("#selected-film-description");
const processList = document.querySelector("#process-list");
const root = document.documentElement;
const body = document.body;
const hero = document.querySelector(".hero");
const siteNav = document.querySelector(".site-nav");
const mainContent = document.querySelector("#main-content");
const introVideo = document.querySelector("#intro-video");
const beginButton = document.querySelector("#begin-cinematic");
const enterButton = document.querySelector("#enter-site");
const ENTER_REVEAL_DELAY = 4000;
const HERO_EXIT_DURATION = 2300;

let enterRevealTimer;
let cinematicStarted = false;
let selectedFilmId = null;
let playerHasSource = false;

function getWorkerBaseUrl() {
  const configuredUrl = window.PaceBrosConfig?.workerBaseUrl;
  if (
    typeof configuredUrl !== "string" ||
    !configuredUrl.trim() ||
    configuredUrl.includes("YOUR-WORKERS-SUBDOMAIN")
  ) {
    return "";
  }

  try {
    const parsedUrl = new URL(configuredUrl);
    if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") return "";
    return parsedUrl.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function getMediaUrl(objectKey) {
  const workerBaseUrl = getWorkerBaseUrl();
  if (!workerBaseUrl || typeof objectKey !== "string") return "";

  const encodedKey = objectKey
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return encodedKey ? `${workerBaseUrl}/media/${encodedKey}` : "";
}

function setPlayerPlaceholder(message) {
  filmPlayerPlaceholder.querySelector("span").textContent = message;
  filmPlayerPlaceholder.hidden = false;
}

function clearPlayer(message) {
  playerHasSource = false;
  filmPlayer.pause();
  filmPlayer.removeAttribute("src");
  filmPlayer.removeAttribute("poster");
  filmPlayer.removeAttribute("aria-label");
  filmPlayer.load();
  filmPlayer.hidden = true;
  setPlayerPlaceholder(message);
}

function selectFilm(film) {
  selectedFilmId = String(film.id);

  filmList.querySelectorAll(".film-select").forEach((button) => {
    const isSelected = button.dataset.filmId === selectedFilmId;
    button.classList.toggle("is-selected", isSelected);
    button.setAttribute("aria-pressed", String(isSelected));
  });

  selectedFilmTitle.textContent = film.title;
  selectedFilmDescription.textContent =
    film.description?.trim() || "A Pace Bros Visuals production.";

  const videoUrl = getMediaUrl(film.video_key);
  if (!videoUrl) {
    clearPlayer(getWorkerBaseUrl() ? "Film media is not available." : "Media service awaiting configuration.");
    return;
  }

  filmPlayer.pause();
  filmPlayer.removeAttribute("poster");
  const posterUrl = getMediaUrl(film.poster_key);
  if (posterUrl) filmPlayer.poster = posterUrl;
  filmPlayer.src = videoUrl;
  playerHasSource = true;
  filmPlayer.setAttribute("aria-label", `Play ${film.title}`);
  filmPlayer.hidden = false;
  filmPlayerPlaceholder.hidden = true;
  filmPlayer.load();
}

function showFilmListMessage(message) {
  const status = document.createElement("p");
  status.className = "film-list-status";
  status.setAttribute("role", "status");
  status.textContent = message;
  filmList.replaceChildren(status);
  filmList.setAttribute("aria-busy", "false");
  filmCount.textContent = "";
}

function renderFilms(films) {
  const fragment = document.createDocumentFragment();

  films.forEach((film, index) => {
    const item = document.createElement("div");
    item.className = "film-list-item";
    item.setAttribute("role", "listitem");

    const button = document.createElement("button");
    button.className = "film-select";
    button.type = "button";
    button.dataset.filmId = String(film.id);
    button.setAttribute("aria-controls", "film-player");
    button.setAttribute("aria-pressed", "false");

    const number = document.createElement("span");
    number.className = "film-select-index";
    number.setAttribute("aria-hidden", "true");
    number.textContent = String(index + 1).padStart(2, "0");

    const title = document.createElement("span");
    title.className = "film-select-title";
    title.textContent = film.title;

    button.append(number, title);
    button.addEventListener("click", () => selectFilm(film));
    item.append(button);
    fragment.append(item);
  });

  filmList.replaceChildren(fragment);
  filmList.setAttribute("aria-busy", "false");
  filmCount.textContent = `${String(films.length).padStart(2, "0")} ${films.length === 1 ? "film" : "films"}`;
}

async function loadPublishedFilms() {
  if (!window.PaceSupabase) {
    showFilmListMessage("Selected works are temporarily unavailable.");
    clearPlayer("Film catalogue unavailable.");
    return;
  }

  const { data, error } = await window.PaceSupabase
    .from("films")
    .select("id,title,description,video_key,poster_key,sort_order,created_at")
    .eq("published", true)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Unable to load published films", error);
    showFilmListMessage("Selected works are temporarily unavailable.");
    clearPlayer("Film catalogue unavailable.");
    return;
  }

  const films = Array.isArray(data) ? data : [];
  if (!films.length) {
    showFilmListMessage("No films are published yet.");
    selectedFilmTitle.textContent = "Selected Works";
    selectedFilmDescription.textContent = "New releases will appear here.";
    clearPlayer("No films available");
    return;
  }

  renderFilms(films);
  selectFilm(films[0]);
}

function renderStages() {
  processList.innerHTML = stages
    .map(
      ([label, note], index) => `
        <li class="process-stage${index === 0 ? " is-active" : ""}" tabindex="0">
          <span class="eyebrow stage-number">${String(index + 1).padStart(2, "0")}</span>
          <h3 class="title-card">${label}</h3>
          <p>${note}</p>
          <i aria-hidden="true"></i>
        </li>`,
    )
    .join("");
}

function setActiveStage(stage) {
  document.querySelectorAll(".process-stage").forEach((item) => {
    item.classList.toggle("is-active", item === stage);
  });
}

function prepareReveals() {
  const observer = new IntersectionObserver(
    (entries, currentObserver) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const delay = Number(entry.target.dataset.delay || 0);
        window.setTimeout(() => entry.target.classList.add("is-revealed"), delay);
        currentObserver.unobserve(entry.target);
      });
    },
    { threshold: 0.2, rootMargin: "-8% 0px" },
  );
  document.querySelectorAll(".reveal").forEach((element) => observer.observe(element));
}

function createParticles() {
  const particleLayer = document.querySelector(".particle-layer");
  particleLayer.innerHTML = Array.from({ length: 18 }, (_, index) => {
    const left = (index * 53) % 100;
    const duration = 28 + (index % 7) * 6;
    const delay = index * 1.7;
    return `<span style="left:${left}%;animation-duration:${duration}s;animation-delay:${delay}s"></span>`;
  }).join("");
}

function revealEnter() {
  enterButton.disabled = false;
  enterButton.removeAttribute("aria-hidden");
  enterButton.classList.add("is-visible");
}

function resetBegin() {
  cinematicStarted = false;
  beginButton.disabled = false;
  beginButton.classList.remove("is-hidden");
}

async function beginCinematic() {
  if (cinematicStarted) return;

  cinematicStarted = true;
  beginButton.disabled = true;
  beginButton.classList.add("is-hidden");
  introVideo.pause();
  introVideo.currentTime = 0;
  introVideo.muted = false;
  introVideo.defaultMuted = false;
  introVideo.volume = 1;
  enterRevealTimer = window.setTimeout(revealEnter, ENTER_REVEAL_DELAY);

  try {
    await introVideo.play();
  } catch {
    window.clearTimeout(enterRevealTimer);
    resetBegin();
  }
}

function enterSite() {
  if (enterButton.disabled) return;

  window.clearTimeout(enterRevealTimer);
  root.classList.remove("intro-active");
  body.classList.remove("intro-active");
  body.classList.add("entered");
  siteNav.removeAttribute("aria-hidden");
  siteNav.removeAttribute("inert");
  mainContent.removeAttribute("aria-hidden");
  mainContent.removeAttribute("inert");
  window.setTimeout(() => document.querySelector("#films").scrollIntoView({ behavior: "smooth" }), 1400);
  window.setTimeout(() => {
    introVideo.pause();
    hero.hidden = true;
  }, HERO_EXIT_DURATION);
}

renderStages();
createParticles();
prepareReveals();
loadPublishedFilms();

beginButton.addEventListener("click", beginCinematic);
enterButton.addEventListener("click", enterSite);
filmPlayer.addEventListener("error", () => {
  if (!selectedFilmId || !playerHasSource) return;
  playerHasSource = false;
  filmPlayer.hidden = true;
  setPlayerPlaceholder("This film could not be loaded.");
});
document.querySelectorAll(".process-stage").forEach((stage) => {
  stage.addEventListener("pointerenter", () => setActiveStage(stage));
  stage.addEventListener("focus", () => setActiveStage(stage));
  stage.addEventListener("click", () => setActiveStage(stage));
});
