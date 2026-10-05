// ================================================================
// ChaoDown Poki — shared script for every page
// ================================================================

// SOCIAL LINKS: every Facebook / Instagram / TikTok button on the site uses these
const SOCIAL_LINKS = {
  facebook:  "https://www.facebook.com/ChaoDownPoki/",
  instagram: "https://www.instagram.com/chaodown.poki/",
  tiktok:    "https://www.tiktok.com/@chaodownpoki",
};

const ICONS = {
  facebook: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 12.07C24 5.41 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.5h-2.8V24C19.62 23.1 24 18.1 24 12.07z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/><circle cx="12" cy="12" r="4.3"/><circle cx="17.6" cy="6.4" r="1.1" fill="currentColor" stroke="none"/></svg>',
  tiktok: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M19.6 6.7a4.8 4.8 0 0 1-3.8-4.2V2h-3.4v13.4a2.9 2.9 0 0 1-5.2 1.7 2.9 2.9 0 0 1 3.2-4.5V9.1a6.3 6.3 0 0 0-5.4 10.7 6.3 6.3 0 0 0 10.8-4.4V8.6a8.2 8.2 0 0 0 4.8 1.5V6.7h-1z"/></svg>',
};
const NAMES = { facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok" };

document.querySelectorAll("[data-social]").forEach(a => {
  const key = a.dataset.social;
  a.href = SOCIAL_LINKS[key];
  a.target = "_blank";
  a.rel = "noopener";
  a.setAttribute("aria-label", NAMES[key]);
  a.innerHTML = ICONS[key] + (a.hasAttribute("data-icon-only") ? "" : "<span>" + NAMES[key] + "</span>");
});

// Spice level: <span class="spice" data-level="1|2|3"></span>
const SPICE_NAMES = { 1: "Mild", 2: "Spicy", 3: "Extra hot" };
const CHILI = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 7.2c-2.7-.4-4.6 1.6-6 4.7-1.5 3.3-3.6 6-8 7.1 4.6 3 11.6 1.6 14.6-3.2 1.8-2.9 1.9-6.4-.6-8.6z" fill="#d63b2a"/><path d="M16.6 7.4c.2-1.6 1.2-3 2.9-3.6" fill="none" stroke="#2f8a3a" stroke-width="2" stroke-linecap="round"/><path d="M14.6 8.1c1-.9 2.8-1 4 .1" fill="none" stroke="#2f8a3a" stroke-width="2" stroke-linecap="round"/></svg>';
document.querySelectorAll(".spice").forEach(el => {
  const level = Number(el.dataset.level) || 1;
  el.innerHTML = CHILI.repeat(level);
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", SPICE_NAMES[level]);
  el.title = SPICE_NAMES[level];
});

// Diet badges: <span class="diet vg"></span>, .gf, .sf
const DIETS = { vg: ["VG", "Vegan"], gf: ["GF", "Gluten free"], sf: ["SF", "Sugar free"] };
document.querySelectorAll(".diet").forEach(el => {
  const key = Object.keys(DIETS).find(k => el.classList.contains(k));
  if (!key) return;
  el.textContent = DIETS[key][0];
  el.title = DIETS[key][1];
  el.setAttribute("aria-label", DIETS[key][1]);
});

// Mobile menu
const toggle = document.querySelector(".menu-toggle");
const links = document.querySelector(".nav-links");
if (toggle && links) {
  toggle.addEventListener("click", () => {
    const open = links.classList.toggle("open");
    toggle.setAttribute("aria-expanded", open);
  });
  links.querySelectorAll("a").forEach(a => a.addEventListener("click", () => {
    links.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  }));
}

document.querySelectorAll(".year").forEach(el => el.textContent = new Date().getFullYear());

// Photo preview mode: add ?edit to the page address, then click any picture
if (new URLSearchParams(location.search).has("edit")) {
  document.body.classList.add("edit-mode");
  const banner = document.createElement("div");
  banner.className = "edit-banner";
  banner.textContent = "Photo preview mode: click any picture to try a photo (not saved)";
  document.body.appendChild(banner);

  const picker = document.createElement("input");
  picker.type = "file";
  picker.accept = "image/*";
  let target = null;
  picker.addEventListener("change", () => {
    const file = picker.files[0];
    if (!file || !target) return;
    const img = target.querySelector("img");
    img.onerror = null;
    img.src = URL.createObjectURL(file);
    target.classList.remove("empty");
    picker.value = "";
  });
  document.querySelectorAll(".img-slot").forEach(slot => {
    slot.addEventListener("click", e => {
      e.preventDefault();
      target = slot;
      picker.click();
    });
  });
}
