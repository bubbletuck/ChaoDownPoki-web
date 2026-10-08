// ================================================================
// ChaoDown Poki — online ordering (order.html)
// ================================================================

// SQUARE SETTINGS. These two IDs are public and safe to have in the page.
// The access token is secret and lives only in Cloudflare (SQUARE_ACCESS_TOKEN).
// Going live: put your Production Application ID + Location ID here, change the
// square.js URL in order.html, and switch the Cloudflare variables to production.
const SQUARE_APP_ID = "sandbox-sq0idb-MlG1nF-JwifC3IhEuEXERA";
const SQUARE_LOCATION_ID = "LYAR7RYESXPHA";
const SANDBOX = SQUARE_APP_ID.startsWith("sandbox-");

const CART_KEY = "chaodown-cart";

const $ = sel => document.querySelector(sel);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = cents => "$" + (cents / 100).toFixed(2);
const byId = list => Object.fromEntries(list.map(x => [x.id, x]));

let MENU, SIZES, BASES, PROTEINS, SAUCES, TOPPINGS, BOWL_SIDES, SAUCE_PLACEMENTS, PROTEIN_PREP, EXTRAS;
let bowl;              // the bowl being built
let cart = [];         // bowls, plus extras marked { kind: "extra" }
let quote = null;      // exact totals from Square for the current cart
let quoteSeq = 0;
let quoteTimer;
let card = null;       // Square card form
let busy = false;
let attemptKey = null; // reused only if a checkout request never got an answer
let hours = { open: false, message: "" };
let CATEGORIES;
let category = null;   // the sidebar category being shown
const drafts = {};     // in-progress bowl per bowl category, kept while browsing others

// ---------- Sidebar categories ----------

function renderCategories() {
  $("#cat-nav").innerHTML = `<ul>${MENU.categories.map(c => `
    <li><button type="button" class="cat-btn" data-cat="${c.id}">
      <strong>${esc(c.name)}</strong><small>${esc(c.blurb)}</small>
    </button></li>`).join("")}</ul>`;
  $("#cat-nav").addEventListener("click", e => {
    const btn = e.target.closest("[data-cat]");
    if (!btn) return;
    showCategory(btn.dataset.cat);
    // On small screens, jump up to the top of the newly shown items
    const main = $("#order-main");
    if (main.getBoundingClientRect().top < 0) main.scrollIntoView({ behavior: "smooth" });
  });
}

function showCategory(id) {
  const cat = CATEGORIES[id] || MENU.categories[0];
  if (CATEGORIES[category]?.bowls) drafts[category] = bowl;
  category = cat.id;

  $("#cat-nav").querySelectorAll("[data-cat]").forEach(b => b.setAttribute("aria-current", b.dataset.cat === cat.id ? "true" : "false"));
  $("#builder").hidden = !cat.bowls;
  $("#extras").hidden = !cat.extras;
  if (cat.bowls) {
    bowl = drafts[cat.id] || newBowl(MENU.sizes.find(s => s.group === cat.bowls).id);
    builderMessage("");
    syncBuilder();
  } else {
    renderExtras(cat);
  }
  try { history.replaceState(null, "", "#" + cat.id); } catch {}
}

// ---------- Ordering hours ----------

// Same rules as orderingStatus() in src/menu.js, which the Worker enforces
function orderingStatus(now = new Date()) {
  const h = MENU.hours;
  if (!h.enforced) return { open: true, message: "" };
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: h.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map(p => [p.type, p.value])
  );
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const toMinutes = t => t.split(":").reduce((hh, mm) => Number(hh) * 60 + Number(mm));
  const label = m => `${(Math.floor(m / 60) + 11) % 12 + 1}:${String(m % 60).padStart(2, "0")} ${m < 720 ? "AM" : "PM"}`;
  const open = toMinutes(h.open);
  const lastOrder = toMinutes(h.close) - h.lastOrderMinutes;

  if (h.closedDates.includes(today)) {
    return { open: false, message: "We're closed today, so online ordering is off. Please check back tomorrow." };
  }
  if (minutes < open) {
    return { open: false, message: `Online ordering opens today at ${label(open)}. You can build your order now and check out then.` };
  }
  if (minutes >= lastOrder) {
    return { open: false, message: `Online ordering is closed for today (last orders at ${label(lastOrder)}). We start taking orders again at ${label(open)}.` };
  }
  return { open: true, message: `Taking online orders until ${label(lastOrder)} today.` };
}

function checkHours() {
  hours = orderingStatus();
  const el = $("#hours-notice");
  el.textContent = hours.message;
  el.classList.toggle("closed", !hours.open);
  el.hidden = !hours.message;
  updateTotals();
}

// ---------- Bowl helpers ----------

function newBowl(size = "regular") {
  return { size, base: null, halves: [], side: null, sideAddOns: [], proteins: {}, prep: {}, sauces: [], sauceOn: [], toppings: [], note: "", quantity: 1 };
}

function scoopCount(b) {
  return Object.values(b.proteins).reduce((a, n) => a + n, 0);
}

// Scoops included in the price (cooked bowls come with their protein)
const includedScoops = size => size.scoops || 0;

function bowlUnitPrice(b) {
  const size = SIZES[b.size];
  const extra = Math.max(0, scoopCount(b) - includedScoops(size));
  const toppings = b.toppings.reduce((a, id) => a + (TOPPINGS[id]?.price || 0), 0);
  return size.price + extra * MENU.extraScoopPrice + toppings;
}

const bowlPrice = b => bowlUnitPrice(b) * b.quantity;

// Mirrors the Worker's checks so customers see problems before checkout
function bowlProblem(b) {
  const size = SIZES[b.size];
  if (!size) return "Pick a bowl size.";
  if (!BASES[b.base]) return "Choose a base.";
  const halves = b.halves || [];
  if (BASES[b.base].split) {
    if (halves.length !== 2 || halves[0] === halves[1] || halves.some(id => !BASES[id] || BASES[id].split)) {
      return "Pick both halves for your Half & Half base.";
    }
  } else if (halves.length) {
    return "Choose a base.";
  }
  const ids = Object.keys(b.proteins);
  if (size.cooked) {
    if (!BOWL_SIDES[b.side]) return "Choose your side.";
    const addOns = (BOWL_SIDES[b.side].addOns || []).map(a => a.id);
    if ((b.sideAddOns || []).some(id => !addOns.includes(id))) return "Choose your side again.";
  } else if (b.side) {
    return "Pick your bowl again.";
  }
  if (ids.some(id => !PROTEINS[id] || (size.proteins && !size.proteins.includes(id)))) return "Pick your protein again.";
  const scoops = scoopCount(b);
  const included = includedScoops(size);
  if (scoops < included) return `Pick ${included - scoops} more scoop${included - scoops > 1 ? "s" : ""} of protein.`;
  if (scoops - included > MENU.maxExtraScoops) return `Up to ${MENU.maxExtraScoops} extra scoops per bowl.`;
  if (Object.entries(b.prep || {}).some(([id, list]) =>
    !b.proteins[id] || !PROTEINS[id].prep || !Array.isArray(list) || list.length !== b.proteins[id] || list.some(h => !PROTEINS[id].prep.includes(h))
  )) return "Pick how you want your protein again.";
  if (b.sauces.some(id => !SAUCES[id])) return "Pick your sauces again.";
  const sauceOn = b.sauceOn || [];
  if (sauceOn.some(id => !SAUCE_PLACEMENTS[id])) return "Choose where you want your sauce again.";
  if (b.sauces.length && !sauceOn.length) return "Choose where you want your sauce.";
  if (!b.sauces.length && sauceOn.length) return "Pick a sauce first.";
  if (b.toppings.some(id => !TOPPINGS[id])) return "Pick your toppings again.";
  if (size.maxToppings && b.toppings.length > size.maxToppings) return `Kids bowls come with up to ${size.maxToppings} toppings.`;
  return null;
}

// "Seaweed, Green Onions" for the side's add-ons, or ""
function sideAddOns(b) {
  const addOns = BOWL_SIDES[b.side]?.addOns || [];
  return (b.sideAddOns || []).map(id => addOns.find(a => a.id === id)?.name).filter(Boolean);
}
const sideAddOnNames = b => sideAddOns(b).join(", ");

// Same as prepNote() in src/menu.js: " (Seared)" or " (1 Raw, 2 Seared)"
function prepNote(protein, list) {
  if (!protein.prep || !Array.isArray(list) || !list.length) return "";
  const counts = protein.prep.map(h => [h, list.filter(x => x === h).length]).filter(([, n]) => n);
  if (counts.length === 1) return counts[0][0] === protein.prep[0] ? "" : ` (${PROTEIN_PREP[counts[0][0]].name})`;
  return ` (${counts.map(([h, n]) => `${n} ${PROTEIN_PREP[h].name}`).join(", ")})`;
}

function bowlTitle(b) {
  const size = SIZES[b.size];
  if (size.cooked) return `${size.name} Bowl${size.kids ? " (Kids)" : ""}`;
  if (size.proteins) return `${size.name} (${size.detail})`;  // e.g. "Vegetarian Bowl (2 scoops tofu)"
  return size.id === "kids" ? size.name : `${size.name} Poke Bowl`;
}

function bowlDetail(b) {
  const parts = [
    BASES[b.base].split
      ? `${BASES[b.base].name} (${b.halves.map(id => BASES[id].name).join(" / ")})`
      : BASES[b.base].name,
    b.side ? `with ${BOWL_SIDES[b.side].name}${sideAddOnNames(b) ? ` (${sideAddOnNames(b).toLowerCase()})` : ""}` : "",
    (SIZES[b.size].cooked && scoopCount(b) ? "Extra protein: " : "") +
    Object.entries(b.proteins).map(([id, n]) =>
      PROTEINS[id].name + (n > 1 ? ` ×${n}` : "") + prepNote(PROTEINS[id], b.prep?.[id])
    ).join(", "),
    b.sauces.length ? b.sauces.map(id => SAUCES[id].name).join(", ") + ` (${b.sauceOn.map(id => SAUCE_PLACEMENTS[id].name.toLowerCase()).join(", ")})` : "",
    b.toppings.map(id => TOPPINGS[id].name).join(", "),
  ].filter(Boolean);
  return parts.join(" · ");
}

// ---------- Extras (sides, drinks, dessert) ----------

const isExtra = x => x.kind === "extra";
const orderable = item => Number.isInteger(item.price) || (item.options || []).some(o => Number.isInteger(o.price));

function extraUnitPrice(x) {
  const item = EXTRAS[x.id];
  return item.options ? item.options.find(o => o.id === x.option).price : item.price;
}

// The options in one of an extra's choice groups (same as choiceItems() in src/menu.js)
const choiceItems = group => group.from === "sauces" ? MENU.sauces : group.items;

// Mirrors extraToLineItem() in src/menu.js
function extraProblem(x) {
  const item = EXTRAS[x.id];
  if (!item || !Number.isInteger(x.quantity) || x.quantity < 1) return "Unknown item.";
  if (item.options ? !item.options.some(o => o.id === x.option && Number.isInteger(o.price)) : (x.option || !Number.isInteger(item.price))) return `Choose a size for ${item.name}.`;
  const picks = x.picks || {};
  const groups = item.choices || [];
  if (Object.keys(picks).some(g => !groups.some(c => c.id === g))) return `Choose again for ${item.name}.`;
  for (const group of groups) {
    const chosen = picks[group.id] || [];
    const options = byId(choiceItems(group));
    if (!Array.isArray(chosen) || chosen.some(id => !options[id]) || (group.single && chosen.length > 1)) return `Choose again for ${item.name}.`;
    if (group.max && chosen.length > group.max) return `Up to ${group.max} ${group.name.toLowerCase()} for ${item.name}.`;
    if (group.required && !chosen.length) return `Choose a ${group.name.toLowerCase()}.`;
    if (group.needs && chosen.length && !(picks[group.needs] || []).length) return "Pick a sauce first.";
  }
  return null;
}

function extraTitle(x) {
  const item = EXTRAS[x.id];
  const option = item.options && item.options.find(o => o.id === x.option);
  return item.name + (option ? ` (${option.name})` : "");
}

function extraDetail(x) {
  const item = EXTRAS[x.id];
  const picked = (item.choices || [])
    .map(group => {
      const options = byId(choiceItems(group));
      return (x.picks?.[group.id] || []).map(id => group.needs ? `${group.name} ${options[id].name.toLowerCase()}` : options[id].name).join(", ");
    })
    .filter(Boolean);
  return [item.detail, ...picked].filter(Boolean).join(" · ");
}

// Same item, size, and add-ons? Then it's one cart line with a bigger quantity.
const sameExtra = (a, b) => a.id === b.id && a.option === b.option && JSON.stringify(a.picks || {}) === JSON.stringify(b.picks || {});

// Works for both bowls and extras
const itemPrice = x => (isExtra(x) ? extraUnitPrice(x) : bowlUnitPrice(x)) * x.quantity;
const itemTitle = x => isExtra(x) ? extraTitle(x) : bowlTitle(x);
const itemDetail = x => isExtra(x) ? extraDetail(x) : bowlDetail(x);

// ---------- Builder ----------

function badges(item) {
  return (item.spice ? ` <span class="spice" data-level="${item.spice}"></span>` : "") +
    (item.diet || []).map(d => ` <span class="diet ${d}"></span>`).join("");
}

function pick(type, name, item) {
  const extra = [item.detail, item.price ? "+" + fmt(item.price) : ""].filter(Boolean).map(t => ` <small>${esc(t)}</small>`).join("");
  return `<label class="pick"><input type="${type}" name="${name}" value="${item.id}"><span>${esc(item.name)}${item.raw ? "*" : ""}${extra}${badges(item)}</span></label>`;
}

function renderBuilder() {
  // One grid per bowl group; only the current sidebar category's grid is shown
  const sizeGroups = [...new Set(MENU.sizes.map(s => s.group))];
  $("#opt-size").innerHTML = sizeGroups.map(g => `
    <div class="pick-grid" data-size-group="${esc(g)}" role="radiogroup" aria-label="${esc(g)}">${MENU.sizes.filter(s => s.group === g).map(s =>
      `<label class="pick pick-card"><input type="radio" name="size" value="${s.id}"><span><strong>${esc(s.name)}${badges(s)}</strong><small>${esc(s.detail)}</small><em>${fmt(s.price)}</em></span></label>`
    ).join("")}</div>`).join("");
  $("#opt-base").innerHTML = MENU.bases.map(b => pick("radio", "base", b)).join("");
  $("#opt-halves").innerHTML = MENU.bases.filter(b => !b.split).map(b => pick("checkbox", "half", b)).join("");
  $("#opt-side").innerHTML = MENU.bowlSides.map(s => pick("radio", "side", s)).join("");

  const groups = [...new Set(MENU.proteins.map(p => p.group))];
  $("#opt-protein").innerHTML = groups.map(g => `
    <h4>${esc(g)}</h4>
    <div class="pick-row">${MENU.proteins.filter(p => p.group === g).map(p => `
      <span class="counter-chip" data-protein="${p.id}">
        <button type="button" class="cc-add" data-add="${p.id}" aria-label="Add a scoop of ${esc(p.name)}">
          ${esc(p.name)}${p.raw ? "*" : ""}${p.detail ? ` <small>${esc(p.detail)}</small>` : ""}${badges(p)} <small class="cc-price">+${fmt(MENU.extraScoopPrice)}</small> <b class="cc-count"></b>
        </button>
        <button type="button" class="cc-remove" data-remove="${p.id}" aria-label="Remove a scoop of ${esc(p.name)}">−</button>
      </span>`).join("")}
    </div>`).join("");

  $("#opt-sauce").innerHTML = MENU.sauces.map(s => pick("checkbox", "sauce", s)).join("");
  $("#opt-sauce-on").innerHTML = MENU.saucePlacements.map(p => pick("checkbox", "sauce-on", p)).join("");
  $("#opt-topping").innerHTML = MENU.toppings.map(t => pick("checkbox", "topping", t)).join("");
  decorateBadges($("#builder"));
}

// Sauces get a dropdown (pick one, or tick several); short lists stay as chips
function choiceControl(x, group) {
  const label = `${esc(x.name)} ${esc(group.name.toLowerCase())}`;
  if (group.from === "sauces" && group.single) {
    return `<select data-group="${group.id}" aria-label="${label}">
      <option value="">Choose a sauce</option>
      ${MENU.sauces.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join("")}
    </select>`;
  }
  if (group.from === "sauces") {
    return `<details class="multi-select" data-ms="${group.id}">
      <summary aria-label="${label}"><span class="ms-summary">${saucePrompt(group)}</span></summary>
      <div class="ms-panel">
        ${group.max ? `<p class="ms-hint" aria-live="polite"></p>` : ""}
        ${MENU.sauces.map(s =>
          `<label class="ms-option"><input type="checkbox" data-group="${group.id}" value="${s.id}"><span>${esc(s.name)}${badges(s)}</span></label>`
        ).join("")}
        <button type="button" class="btn btn-primary btn-sm ms-done">Done</button>
      </div>
    </details>`;
  }
  return choiceItems(group).map(c =>
    `<label class="pick"><input type="${group.single ? "radio" : "checkbox"}" name="pick-${x.id}-${group.id}" data-group="${group.id}" value="${c.id}"><span>${esc(c.name)}${badges(c)}</span></label>`
  ).join("");
}

const saucePrompt = group => group.max ? `Choose up to ${group.max} sauces` : "Choose sauces";

// Updates a side's dropdown labels, locks the rest once the sauce limit is hit,
// and shows "Sauce on the side" only once a sauce is picked
function syncExtraRow(row) {
  const item = EXTRAS[row.dataset.extra];
  row.querySelectorAll("details[data-ms]").forEach(d => {
    const group = item.choices.find(g => g.id === d.dataset.ms);
    const names = [...d.querySelectorAll("input:checked")].map(i => SAUCES[i.value].name);
    d.querySelector(".ms-summary").textContent = names.length ? names.join(", ") : saucePrompt(group);
    d.classList.toggle("has", names.length > 0);
    if (group.max) {
      const full = names.length >= group.max;
      d.querySelectorAll("input").forEach(i => i.disabled = full && !i.checked);
      d.querySelector(".ms-hint").textContent = full
        ? `That's ${group.max}, the most for one order. Untick one to swap.`
        : `Pick up to ${group.max}. ${names.length} chosen.`;
    }
  });
  row.querySelectorAll("[data-needs]").forEach(label => {
    const has = [...row.querySelectorAll(`[data-group="${label.dataset.needs}"]`)].some(el => el.tagName === "SELECT" ? el.value : el.checked);
    label.hidden = !has;
    if (!has) label.querySelector("input").checked = false;
  });
}

// Lists one sidebar category's extras, each with its sizes, add-ons, and Add button
function renderExtras(cat) {
  const items = MENU.extras.filter(x => x.group === cat.extras && orderable(x));
  $("#extras-title").textContent = cat.name;
  $("#extras-note").textContent = items.length
    ? "Tap Add for each one you'd like. Change quantities in your order."
    : "Not available for online ordering yet. Grab one at the counter when you pick up!";
  $("#opt-extras").innerHTML = items.map(x => {
    const options = (x.options || []).filter(o => Number.isInteger(o.price));
    const price = options.length ? options.map(o => fmt(o.price)).join(" / ") : fmt(x.price);
    // A group that `needs` another (like "Sauce on the side") sits in that group's row
    const groups = x.choices || [];
    const choices = groups.filter(g => !g.needs).map(group => `
      <div class="choice-group" role="group" aria-label="${esc(x.name)} ${esc(group.name)}">
        <span class="choice-label">${esc(group.name)}${group.required ? "" : " <small>(optional)</small>"}</span>
        ${choiceControl(x, group)}
        ${groups.filter(c => c.needs === group.id).map(child => child.items.map(c =>
          `<label class="pick" data-needs="${group.id}" hidden><input type="checkbox" data-group="${child.id}" value="${c.id}"><span>${esc(child.name)} ${esc(c.name.toLowerCase())}</span></label>`
        ).join("")).join("")}
      </div>`).join("");
    return `
    <li class="extra-row" data-extra="${x.id}">
      <div class="extra-info">
        <strong>${esc(x.name)}</strong>${badges(x)}
        ${x.detail ? `<small>${esc(x.detail)}</small>` : ""}
        <span class="price">${price}</span>
      </div>
      <div class="extra-controls">
        ${options.length ? `<select data-option aria-label="${esc(x.name)} size">${options.map(o =>
          `<option value="${esc(o.id)}">${esc(o.name)} · ${fmt(o.price)}</option>`).join("")}</select>` : ""}
        <button type="button" class="btn btn-primary btn-sm" data-add-extra="${x.id}">Add</button>
      </div>
      ${choices ? `<div class="extra-choices">${choices}</div>` : ""}
    </li>`;
  }).join("");
  decorateBadges($("#extras"));
  $("#opt-extras").querySelectorAll(".extra-row").forEach(syncExtraRow);
}

function wireExtras() {
  $("#opt-extras").addEventListener("click", e => {
    const btn = e.target.closest("[data-add-extra]");
    if (!btn) return;
    const row = btn.closest(".extra-row");
    const item = EXTRAS[btn.dataset.addExtra];

    // Picked add-ons, in menu order so identical picks match
    const picks = {};
    for (const group of item.choices || []) {
      const chosen = [...row.querySelectorAll(`[data-group="${group.id}"]`)]
        .flatMap(el => el.tagName === "SELECT" ? (el.value ? [el.value] : []) : (el.checked ? [el.value] : []));
      if (chosen.length) picks[group.id] = chosen;
    }
    const extra = {
      kind: "extra",
      id: item.id,
      option: row.querySelector("[data-option]")?.value || null,
      picks,
      quantity: 1,
    };
    if (extraProblem(extra)) {
      const missing = (item.choices || []).find(g => g.required && !picks[g.id]);
      if (missing) row.querySelector(`[data-group="${missing.id}"]`)?.focus();
      return flashButton(btn, missing ? `Pick a ${missing.name.toLowerCase()}` : "Unavailable");
    }

    // Same item again just bumps the quantity
    const same = cart.find(x => isExtra(x) && sameExtra(x, extra));
    if (same) {
      same.quantity = Math.min(MENU.maxBowlQuantity, same.quantity + 1);
    } else {
      if (cart.length >= MENU.maxBowlsPerOrder) return flashButton(btn, "Order full");
      cart.push(extra);
    }
    // Clear the add-ons so the next one starts fresh
    row.querySelectorAll(".extra-choices input").forEach(i => i.checked = false);
    row.querySelectorAll(".extra-choices select").forEach(s => s.value = "");
    row.querySelectorAll("details[open]").forEach(d => d.open = false);
    syncExtraRow(row);
    cartChanged();
    flashButton(btn, "Added ✓");
  });

  $("#opt-extras").addEventListener("change", e => {
    const row = e.target.closest(".extra-row");
    if (row) syncExtraRow(row);
  });
  $("#opt-extras").addEventListener("click", e => {
    const done = e.target.closest(".ms-done");
    if (done) done.closest("details").open = false;
  });
  // Close an open sauce dropdown when tapping elsewhere or pressing Escape
  document.addEventListener("click", e => {
    document.querySelectorAll("details.multi-select[open]").forEach(d => { if (!d.contains(e.target)) d.open = false; });
  });
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    document.querySelectorAll("details.multi-select[open]").forEach(d => {
      d.open = false;
      d.querySelector("summary").focus();
    });
  });
}

function flashButton(btn, text) {
  clearTimeout(btn._flash);
  btn.textContent = text;
  btn._flash = setTimeout(() => btn.textContent = "Add", 1400);
}

function syncBuilder() {
  const size = SIZES[bowl.size];
  const form = $("#builder");
  form.querySelectorAll("[data-size-group]").forEach(g => g.hidden = g.dataset.sizeGroup !== size.group);
  $("#size-title").textContent = MENU.sizes.filter(s => s.group === size.group).every(s => s.cooked) ? "Pick your bowl" : "Pick a size";
  form.querySelectorAll('input[name="size"]').forEach(i => i.checked = i.value === bowl.size);
  form.querySelectorAll('input[name="base"]').forEach(i => i.checked = i.value === bowl.base);
  form.querySelectorAll('input[name="side"]').forEach(i => i.checked = i.value === bowl.side);
  syncSideAddOns();
  form.querySelectorAll('input[name="half"]').forEach(i => i.checked = bowl.halves.includes(i.value));

  const split = BASES[bowl.base]?.split;
  $("#half-picker").hidden = !split;
  $("#half-status").textContent = bowl.halves.length === 2
    ? `${bowl.halves.map(id => BASES[id].name).join(" + ")}. Tap another to swap.`
    : `${bowl.halves.length} of 2 chosen.`;
  $("#half-status").classList.toggle("done", bowl.halves.length === 2);
  form.querySelectorAll('input[name="sauce"]').forEach(i => i.checked = bowl.sauces.includes(i.value));
  form.querySelectorAll('input[name="sauce-on"]').forEach(i => i.checked = bowl.sauceOn.includes(i.value));
  $("#sauce-on-picker").hidden = bowl.sauces.length === 0;
  form.querySelectorAll('input[name="topping"]').forEach(i => i.checked = bowl.toppings.includes(i.value));

  // Kids bowls: up to 4 toppings, so the rest lock once the limit is reached
  const maxTop = size.maxToppings;
  const full = maxTop && bowl.toppings.length >= maxTop;
  form.querySelectorAll('input[name="topping"]').forEach(i => i.disabled = full && !i.checked);
  $("#topping-note").textContent = maxTop
    ? `Kids bowls come with up to ${maxTop} toppings. ${bowl.toppings.length} of ${maxTop} chosen.`
    : "As many as you like.";
  $("#topping-note").classList.toggle("done", !!full);

  // Cooked bowls add the included side; protein becomes optional, paid extras
  $("#step-side").hidden = !size.cooked;
  $("#protein-num").textContent = size.cooked ? "+" : "3";
  $("#protein-title").textContent = size.cooked ? "Add extra protein (optional)" : "Pick your protein";

  const scoops = scoopCount(bowl);
  const extra = Math.max(0, scoops - includedScoops(size));
  // Show "+$4.00" on every protein once the next scoop would cost extra
  $("#step-protein").classList.toggle("paid", scoops >= includedScoops(size));
  form.querySelectorAll(".counter-chip").forEach(chip => {
    const id = chip.dataset.protein;
    const n = bowl.proteins[id] || 0;
    const locked = size.proteins && !size.proteins.includes(id);
    chip.classList.toggle("has", n > 0);
    chip.querySelector(".cc-count").textContent = n || "";
    chip.querySelector(".cc-add").disabled = locked || extra >= MENU.maxExtraScoops;
    chip.querySelector(".cc-remove").disabled = locked;
  });

  syncPrep();

  const status = $("#scoop-status");
  status.classList.toggle("paid", !!size.cooked);
  if (size.cooked) {
    status.textContent = `Your ${size.name.toLowerCase()} is already included. Want more? Add any protein for an extra ${fmt(MENU.extraScoopPrice)} per scoop.` +
      (scoops ? ` You've added ${scoops} (+${fmt(extra * MENU.extraScoopPrice)}).` : "");
  } else if (size.proteins) {
    status.textContent = `${size.name} comes with ${size.scoops} scoop${size.scoops > 1 ? "s" : ""} of ${size.proteins.map(id => PROTEINS[id].name).join(", ")}. Extra scoops are ${fmt(MENU.extraScoopPrice)} each.`;
  } else if (scoops < size.scoops) {
    status.textContent = `${scoops} of ${size.scoops} scoops chosen. Tap a protein to add a scoop. Pick one twice for a double scoop.`;
  } else {
    status.textContent = `${size.scoops} of ${size.scoops} scoops chosen` + (extra ? ` + ${extra} extra (${fmt(extra * MENU.extraScoopPrice)}).` : `. Extra scoops are ${fmt(MENU.extraScoopPrice)} each.`);
  }
  status.classList.toggle("done", !size.cooked && scoops >= size.scoops);

  $("#qty-value").textContent = bowl.quantity;
  $("#qty-minus").disabled = bowl.quantity <= 1;
  $("#qty-plus").disabled = bowl.quantity >= MENU.maxBowlQuantity;
  $("#bowl-note").value = bowl.note;
  $("#add-btn").textContent = `Add to order · ${fmt(bowlPrice(bowl))}`;
}

// Free add-ons for the chosen side, e.g. seaweed and green onions in miso soup
let sideAddOnLayout = null;
function syncSideAddOns() {
  const side = SIZES[bowl.size].cooked ? BOWL_SIDES[bowl.side] : null;
  const addOns = side?.addOns || [];
  // Only rebuild when the side changes, so ticking a box doesn't lose keyboard focus
  if (sideAddOnLayout !== (side?.id || "")) {
    sideAddOnLayout = side?.id || "";
    $("#side-addon-title").textContent = side ? `Add to your ${side.name.toLowerCase()}` : "";
    $("#opt-side-addons").innerHTML = addOns.map(a => pick("checkbox", "side-addon", a)).join("");
  }
  $("#opt-side-addons").querySelectorAll("input").forEach(i => i.checked = bowl.sideAddOns.includes(i.value));
  $("#side-addon-picker").hidden = addOns.length === 0;
}

// "How do you want it?": one Raw / Seared / Cooked (or As is / Warmed up) row per
// scoop, so 3 scoops of salmon can be 1 raw, 1 seared, 1 cooked
let prepLayout = "";
function syncPrep() {
  bowl.prep = normalizePrep(bowl);
  const ids = Object.keys(bowl.prep).filter(id => bowl.proteins[id]);
  // Only rebuild when scoops change, so picking a prep doesn't lose keyboard focus
  const layout = ids.map(id => `${id}:${bowl.prep[id].length}`).join(",");
  if (layout !== prepLayout) {
    prepLayout = layout;
    $("#opt-prep").innerHTML = ids.map(id => {
      const p = PROTEINS[id];
      return bowl.prep[id].map((_, i) => `
        <div class="prep-row">
          <span class="prep-name">${esc(p.name)}${bowl.prep[id].length > 1 ? ` <small>scoop ${i + 1}</small>` : ""}</span>
          <div class="pick-row" role="radiogroup" aria-label="How to prepare ${esc(p.name)}${bowl.prep[id].length > 1 ? `, scoop ${i + 1}` : ""}">${p.prep.map(h =>
            `<label class="pick"><input type="radio" name="prep-${id}-${i}" data-prep-id="${id}" data-prep-idx="${i}" value="${h}"><span>${esc(PROTEIN_PREP[h].name)}</span></label>`
          ).join("")}</div>
        </div>`).join("");
    }).join("");
  }
  $("#opt-prep").querySelectorAll("input").forEach(i => i.checked = bowl.prep[i.dataset.prepId][Number(i.dataset.prepIdx)] === i.value);
  $("#prep-picker").hidden = ids.length === 0;
}

function builderMessage(text, kind) {
  const el = $("#builder-msg");
  el.textContent = text;
  el.className = "form-msg " + (kind || "");
  el.hidden = !text;
}

function wireBuilder() {
  const form = $("#builder");

  form.addEventListener("change", e => {
    const { name, value, checked } = e.target;
    if (name === "size") {
      const wasLocked = SIZES[bowl.size].proteins;
      const size = SIZES[value];
      bowl.size = value;
      if (size.cooked) {
        bowl.proteins = {};
      } else {
        bowl.side = null;
        bowl.sideAddOns = [];
        if (size.proteins) bowl.proteins = { [size.proteins[0]]: size.scoops };
        else if (wasLocked) bowl.proteins = {};
      }
      // Kids bowls have a topping limit: keep the first ones picked
      if (size.maxToppings && bowl.toppings.length > size.maxToppings) {
        bowl.toppings = bowl.toppings.slice(0, size.maxToppings);
        syncBuilder();
        return builderMessage(`Kids bowls come with up to ${size.maxToppings} toppings, so we kept your first ${size.maxToppings}.`, "error");
      }
    } else if (name === "base") {
      bowl.base = value;
      if (!BASES[value].split) bowl.halves = [];
    } else if (name === "half") {
      // Keep the two most recent picks, so a third tap swaps out the oldest
      bowl.halves = checked ? [...bowl.halves, value].slice(-2) : bowl.halves.filter(id => id !== value);
    } else if (name === "side-addon") {
      bowl.sideAddOns = checked ? [...bowl.sideAddOns, value] : bowl.sideAddOns.filter(id => id !== value);
    } else if (name === "side") {
      bowl.sideAddOns = [];
      bowl.side = value;
    } else if (e.target.dataset.prepId) {
      // One scoop's prep, e.g. the 2nd scoop of salmon → seared
      bowl.prep[e.target.dataset.prepId][Number(e.target.dataset.prepIdx)] = value;
    } else if (name === "sauce") {
      bowl.sauces = checked ? [...bowl.sauces, value] : bowl.sauces.filter(id => id !== value);
      // Start with "mixed with protein"; clear placement when no sauce is left
      if (bowl.sauces.length && !bowl.sauceOn.length) bowl.sauceOn = ["protein"];
      if (!bowl.sauces.length) bowl.sauceOn = [];
    } else if (name === "sauce-on") {
      bowl.sauceOn = checked ? [...bowl.sauceOn, value] : bowl.sauceOn.filter(id => id !== value);
    } else if (name === "topping") {
      bowl.toppings = checked ? [...bowl.toppings, value] : bowl.toppings.filter(id => id !== value);
    } else {
      return;
    }
    builderMessage("");
    syncBuilder();
  });

  form.addEventListener("click", e => {
    const add = e.target.closest("[data-add]");
    const remove = e.target.closest("[data-remove]");
    if (add) {
      const id = add.dataset.add;
      bowl.proteins[id] = (bowl.proteins[id] || 0) + 1;
      // Each new scoop starts with the default prep (raw fish, shrimp as is)
      if (PROTEINS[id].prep) (bowl.prep[id] ||= []).push(PROTEINS[id].prep[0]);
    } else if (remove) {
      const id = remove.dataset.remove;
      if (!bowl.proteins[id]) return;
      bowl.prep[id]?.pop();
      if (--bowl.proteins[id] <= 0) {
        delete bowl.proteins[id];
        delete bowl.prep[id];
      }
    } else {
      return;
    }
    builderMessage("");
    syncBuilder();
  });

  $("#bowl-note").addEventListener("input", e => bowl.note = e.target.value);
  $("#qty-minus").addEventListener("click", () => { bowl.quantity = Math.max(1, bowl.quantity - 1); syncBuilder(); });
  $("#qty-plus").addEventListener("click", () => { bowl.quantity = Math.min(MENU.maxBowlQuantity, bowl.quantity + 1); syncBuilder(); });

  form.addEventListener("submit", e => {
    e.preventDefault();
    const problem = bowlProblem(bowl);
    if (problem) return builderMessage(problem, "error");
    if (cart.length >= MENU.maxBowlsPerOrder) return builderMessage("That's a big order! Please call us for catering.", "error");

    bowl.note = bowl.note.trim();
    cart.push(bowl);
    bowl = newBowl(bowl.size);
    if (SIZES[bowl.size].proteins) bowl.proteins = { [SIZES[bowl.size].proteins[0]]: SIZES[bowl.size].scoops };
    syncBuilder();
    cartChanged();
    builderMessage("Added to your order! Build another bowl or check out.", "ok");
  });
}

// ---------- Cart + totals ----------

function saveCart() {
  try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch {}
}

// One prep entry per scoop for every protein that has prep choices. Also upgrades
// carts saved before per-scoop prep (one "seared" per protein, or none).
function normalizePrep(b) {
  const prep = {};
  for (const [id, n] of Object.entries(b.proteins)) {
    const p = PROTEINS[id];
    if (!p?.prep) continue;
    const old = b.prep?.[id];
    const list = Array.isArray(old) ? old.slice(0, n) : [];
    const fill = typeof old === "string" ? old : p.prep[0];
    while (list.length < n) list.push(fill);
    prep[id] = list;
  }
  return prep;
}

function loadCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    if (!Array.isArray(saved)) return [];
    const extras = saved.filter(x => x && isExtra(x) && !extraProblem(x));
    // Fill in fields added after a cart may have been saved
    const bowls = saved
      .filter(b => b && !isExtra(b) && SIZES[b.size] && b.proteins && Array.isArray(b.sauces) && Array.isArray(b.toppings))
      .map(b => ({ ...b, prep: normalizePrep(b), halves: b.halves || [], sideAddOns: b.sideAddOns || [], sauceOn: b.sauceOn || (b.sauces.length ? ["protein"] : []) }))
      .filter(b => !bowlProblem(b));
    return [...bowls, ...extras];
  } catch {
    return [];
  }
}

function cartItemsHtml(items, editable) {
  return items.map((x, i) => {
    const detail = itemDetail(x);
    return `
    <li>
      <span class="ci-title">${!editable && x.quantity > 1 ? `${x.quantity} × ` : ""}${esc(itemTitle(x))}</span>
      <span class="ci-price">${fmt(itemPrice(x))}</span>
      ${detail || x.note ? `<span class="ci-detail">${esc(detail)}${x.note ? `<br><em>“${esc(x.note)}”</em>` : ""}</span>` : ""}
      ${editable ? `
      <div class="ci-actions">
        <div class="qty qty-sm" role="group" aria-label="Quantity of ${esc(itemTitle(x))}">
          <button type="button" data-dec="${i}" aria-label="One fewer" ${x.quantity <= 1 ? "disabled" : ""}>−</button>
          <output>${x.quantity}</output>
          <button type="button" data-inc="${i}" aria-label="One more" ${x.quantity >= MENU.maxBowlQuantity ? "disabled" : ""}>+</button>
        </div>
        <button type="button" class="ci-remove" data-index="${i}">Remove</button>
      </div>` : ""}
    </li>`;
  }).join("");
}

// What the Worker expects: bowls and extras in separate lists
function orderPayload() {
  return {
    bowls: cart.filter(x => !isExtra(x)),
    extras: cart.filter(isExtra).map(({ id, option, picks, quantity }) => ({ id, option, picks, quantity })),
  };
}

function renderCart() {
  $("#cart-list").innerHTML = cartItemsHtml(cart, true);
  $("#cart-empty").hidden = cart.length > 0;
  $("#totals").hidden = cart.length === 0;

  const count = cart.reduce((a, b) => a + b.quantity, 0);
  $("#bar-count").textContent = count;
  $("#order-bar").hidden = count === 0;
  updateTotals();
}

function updateTotals() {
  const subtotal = cart.reduce((a, x) => a + itemPrice(x), 0);
  $("#t-subtotal").textContent = fmt(subtotal);
  $("#t-tax").textContent = quote ? fmt(quote.tax) : "…";
  $("#t-total").textContent = quote ? fmt(quote.total) : "…";
  $("#bar-total").textContent = quote ? fmt(quote.total) : fmt(subtotal);

  const pay = $("#pay-btn");
  pay.disabled = busy || !hours.open || !card || !quote || cart.length === 0;
  pay.textContent = busy ? "Placing your order…" : !hours.open ? "Online ordering is closed" : quote ? `Pay ${fmt(quote.total)}` : "Pay";
}

function cartChanged() {
  saveCart();
  renderCart();
  requestQuote();
}

function requestQuote() {
  quote = null;
  updateTotals();
  clearTimeout(quoteTimer);
  if (cart.length === 0) return;

  const seq = ++quoteSeq;
  quoteTimer = setTimeout(async () => {
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(orderPayload()),
      });
      const data = await res.json();
      if (seq !== quoteSeq) return;
      if (!res.ok) throw new Error(data.error);
      quote = data;
      checkoutError("");
    } catch (err) {
      if (seq !== quoteSeq) return;
      checkoutError((err && err.message) || "We couldn't get your total. Please refresh and try again.");
    }
    updateTotals();
  }, 250);
}

// ---------- Phone number ----------

// Same as normalizePhone() in src/menu.js: a real 10-digit US number → "+19165550123"
function normalizePhone(input) {
  let digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") digits = digits.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return "+1" + digits;
}

function checkPhone(showError) {
  const input = $("#c-phone");
  const phone = normalizePhone(input.value);
  if (phone) input.value = `(${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}`;
  const bad = !phone && (showError || input.value.trim() !== "");
  $("#phone-msg").textContent = bad ? "Please enter a 10-digit phone number, like (916) 555-0123." : "";
  $("#phone-msg").classList.toggle("error", bad);
  input.setAttribute("aria-invalid", bad ? "true" : "false");
  return phone;
}

// ---------- Pickup time ----------

let pickupStatus = null;  // { earliest, busy, choices } from /api/status
let pickupMinutes = null; // the customer's pick

const pickupLabel = m => m < 60 ? `${m} min` : m === 60 ? "1 hr" : m === 90 ? "1½ hr" : `${m / 60} hr`;
const clockIn = m => new Intl.DateTimeFormat("en-US", { timeZone: MENU.hours.timeZone, hour: "numeric", minute: "2-digit" })
  .format(new Date(Date.now() + m * 60000));

async function loadPickupStatus() {
  try {
    const res = await fetch("/api/status", { cache: "no-store" });
    if (!res.ok) throw new Error();
    pickupStatus = await res.json();
  } catch {
    // Couldn't check how busy we are: offer the usual times; the Worker still checks
    if (!pickupStatus) pickupStatus = { earliest: MENU.pickup.minMinutes, busy: false, choices: MENU.pickup.choices };
  }
  renderPickup();
}

// Pickup choices with their clock time; times too soon for a busy kitchen are greyed out
function renderPickup() {
  if (!pickupStatus) return;
  const { busy: isBusy, choices } = pickupStatus;
  if (!choices.includes(pickupMinutes)) pickupMinutes = null;

  $("#pickup-choices").innerHTML = MENU.pickup.choices.map(m => `
    <label class="pick pick-card">
      <input type="radio" name="pickup" value="${m}" ${m === pickupMinutes ? "checked" : ""} ${choices.includes(m) ? "" : "disabled"}>
      <span><strong>${pickupLabel(m)}</strong><small>${clockIn(m)}</small></span>
    </label>`).join("");

  const notice = $("#busy-notice");
  if (!choices.length) {
    notice.textContent = "It's too close to closing time for online orders. Please call us at (916) 918-2936.";
  } else if (isBusy) {
    notice.textContent = `We're busy right now, so the earliest pickup is about ${choices[0]} minutes. Wait times might vary. Thanks for your patience!`;
  }
  notice.hidden = !(isBusy || !choices.length);
}

// ---------- Checkout ----------

function checkoutError(text) {
  const el = $("#checkout-error");
  el.textContent = text;
  el.hidden = !text;
}

async function initCard() {
  if (!window.Square) {
    checkoutError("Card payments couldn't load. Please check your connection, or call us to order.");
    return;
  }
  try {
    const payments = window.Square.payments(SQUARE_APP_ID, SQUARE_LOCATION_ID);
    card = await payments.card();
    await card.attach("#card-container");
  } catch (err) {
    console.error(err);
    card = null;
    checkoutError("Card payments couldn't load. Please refresh the page, or call us to order.");
  }
  updateTotals();
}

function wireCheckout() {
  $("#cart-list").addEventListener("click", e => {
    const remove = e.target.closest(".ci-remove");
    const inc = e.target.closest("[data-inc]");
    const dec = e.target.closest("[data-dec]");
    if (remove) {
      cart.splice(Number(remove.dataset.index), 1);
    } else if (inc) {
      const x = cart[Number(inc.dataset.inc)];
      x.quantity = Math.min(MENU.maxBowlQuantity, x.quantity + 1);
    } else if (dec) {
      const x = cart[Number(dec.dataset.dec)];
      x.quantity = Math.max(1, x.quantity - 1);
    } else {
      return;
    }
    cartChanged();
  });

  $("#c-phone").addEventListener("blur", () => checkPhone(false));
  $("#pickup-choices").addEventListener("change", e => {
    pickupMinutes = Number(e.target.value);
    checkoutError("");
  });

  $("#checkout-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (busy) return;
    checkoutError("");

    const name = $("#c-name").value.trim();
    const pickupNote = $("#c-notes").value.trim();
    if (cart.length === 0) return checkoutError("Your order is empty.");
    if (!name) { $("#c-name").focus(); return checkoutError("Please enter a name for pickup."); }
    const phone = checkPhone(true);
    if (!phone) { $("#c-phone").focus(); return checkoutError("Please enter a valid 10-digit phone number."); }
    if (!pickupMinutes) {
      $("#pickup-choices input:not(:disabled)")?.focus();
      return checkoutError("Please choose when you'll pick up your order.");
    }
    if (!hours.open) return checkoutError(hours.message);
    if (!card || !quote) return;

    busy = true;
    updateTotals();
    try {
      const result = await card.tokenize();
      if (result.status !== "OK") {
        throw new Error(result.errors?.[0]?.message || "Please check your card details.");
      }

      attemptKey = attemptKey || crypto.randomUUID();
      let res;
      try {
        res = await fetch("/api/create-order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...orderPayload(),
            customer: { name, phone },
            pickupNote,
            pickupMinutes,
            sourceId: result.token,
            expectedTotal: quote.total,
            idempotencyKey: attemptKey,
          }),
        });
      } catch {
        // No answer: keep attemptKey so trying again can't charge twice
        throw new Error("Connection problem. Please try again. You won't be charged twice.");
      }
      attemptKey = null;

      const data = await res.json().catch(() => ({}));
      if (data.closed) checkHours();
      // The kitchen got busier while they were checking out: show the new times
      if (data.pickupChanged) {
        pickupStatus = { earliest: data.earliest, busy: data.busy, choices: data.choices };
        renderPickup();
      }
      if (res.status === 409 && Number.isInteger(data.total)) {
        quote = { subtotal: data.subtotal, tax: data.tax, total: data.total };
      }
      if (!res.ok) throw new Error(data.error || "Something went wrong. Your card was not charged.");

      showConfirmation(data, name);
    } catch (err) {
      checkoutError(err.message);
    } finally {
      busy = false;
      updateTotals();
    }
  });
}

function showConfirmation(data, name) {
  $("#confirm-title").textContent = `Thank you, ${name}!`;
  $("#confirm-pickup").textContent = `Your order will be ready around ${data.pickupTime} (about ${pickupLabel(data.pickupMinutes)}).`;
  $("#confirm-list").innerHTML = cartItemsHtml(cart, false);
  $("#confirm-totals").innerHTML = `
    <dt>Subtotal</dt><dd>${fmt(data.subtotal)}</dd>
    <dt>Tax</dt><dd>${fmt(data.tax)}</dd>
    <dt class="grand">Total paid</dt><dd class="grand">${fmt(data.total)}</dd>`;
  $("#confirm-meta").innerHTML =
    `Order ID: ${esc(data.orderId)}` +
    (data.receiptUrl ? ` · <a href="${esc(data.receiptUrl)}" target="_blank" rel="noopener" class="text-link">View receipt</a>` : "");

  cart = [];
  saveCart();
  $("#ordering").hidden = true;
  $("#order-bar").hidden = true;
  $("#confirmation").hidden = false;
  window.scrollTo(0, 0);
  $("#confirm-title").focus();
}

// ---------- Start ----------

async function init() {
  $("#test-banner").hidden = !SANDBOX;
  try {
    const res = await fetch("/api/menu");
    if (!res.ok) throw new Error();
    MENU = await res.json();
  } catch {
    const el = $("#page-error");
    el.innerHTML = 'Online ordering isn\'t available right now. Please call us at <a href="tel:+19169182936" class="text-link">(916) 918-2936</a> to order.';
    el.hidden = false;
    return;
  }
  SIZES = byId(MENU.sizes);
  BASES = byId(MENU.bases);
  PROTEINS = byId(MENU.proteins);
  SAUCES = byId(MENU.sauces);
  TOPPINGS = byId(MENU.toppings);
  BOWL_SIDES = byId(MENU.bowlSides);
  SAUCE_PLACEMENTS = byId(MENU.saucePlacements);
  PROTEIN_PREP = byId(MENU.proteinPrep);
  EXTRAS = byId(MENU.extras);
  CATEGORIES = byId(MENU.categories);

  bowl = newBowl();
  cart = loadCart();
  renderBuilder();
  renderCategories();
  wireBuilder();
  wireExtras();
  wireCheckout();
  // Open the category in the link (e.g. order.html#sides), or Poke Bowls
  showCategory(location.hash.slice(1));
  $("#order-layout").hidden = false;
  renderCart();
  requestQuote();
  initCard();
  checkHours();
  setInterval(checkHours, 30000);
  // Pickup times: re-check how busy we are (and refresh the clock times) every minute
  loadPickupStatus();
  setInterval(loadPickupStatus, 60000);
}

init();
