const films = [
  {
    id: "signal",
    title: "The Signal",
    line: "A transmission that was never meant to be received.",
    year: "2026",
    runtime: "07:12",
    format: "Generative / 2.39:1",
    image: "assets/images/film-signal.jpg",
  },
  {
    id: "null",
    title: "Null",
    line: "Something exists where nothing should.",
    year: "2026",
    runtime: "04:48",
    format: "Generative / 1.85:1",
    image: "assets/images/film-null.jpg",
  },
  {
    id: "last-frame",
    title: "The Last Frame",
    line: "The camera recorded something nobody saw.",
    year: "2025",
    runtime: "09:03",
    format: "Generative / 2.39:1",
    image: "assets/images/film-lastframe.jpg",
  },
];

const stages = [
  ["Idea", "A single unsettling image. We follow it until it becomes a scene."],
  ["Generation", "Thousands of frames summoned, discarded, summoned again."],
  ["Direction", "We shape light, weather, silence. The machine renders; we direct."],
  ["Edit", "Rhythm, restraint, and the cuts that decide what you are allowed to see."],
  ["Film", "It exits as cinema. Nothing about it was ever filmed."],
];

const filmList = document.querySelector("#film-list");
const processList = document.querySelector("#process-list");

function renderFilms() {
  filmList.innerHTML = films
    .map(
      (film, index) => `
        <article class="film-card reveal${index % 2 ? " is-flipped" : ""}" data-delay="${index * 80}">
          <div class="film-visual">
            <img src="${film.image}" alt="Still frame from ${film.title}" width="1280" height="1600" loading="lazy" />
            <div class="film-vignette" aria-hidden="true"></div>
            <div class="film-overlay" aria-hidden="true"></div>
            <div class="film-title-row"><h3 class="title-card">${film.title}</h3><span class="eyebrow">${film.year}</span></div>
          </div>
          <div class="film-copy">
            <p>${film.line}</p>
            <div class="film-details">
              <div class="hairline" aria-hidden="true"></div>
              <dl>
                <div><dt class="eyebrow">Runtime</dt><dd class="eyebrow">${film.runtime}</dd></div>
                <div><dt class="eyebrow">Format</dt><dd class="eyebrow">${film.format}</dd></div>
              </dl>
            </div>
          </div>
        </article>`,
    )
    .join("");
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

function enterSite() {
  document.body.classList.remove("intro-active");
  document.body.classList.add("entered");
  document.querySelector("#main-content").removeAttribute("aria-hidden");
  window.setTimeout(() => document.querySelector("#films").scrollIntoView({ behavior: "smooth" }), 1400);
}

renderFilms();
renderStages();
createParticles();
prepareReveals();

document.querySelector("#enter-site").addEventListener("click", enterSite);
document.querySelectorAll(".process-stage").forEach((stage) => {
  stage.addEventListener("pointerenter", () => setActiveStage(stage));
  stage.addEventListener("focus", () => setActiveStage(stage));
  stage.addEventListener("click", () => setActiveStage(stage));
});
