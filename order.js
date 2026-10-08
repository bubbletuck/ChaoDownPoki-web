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
  return { size, base: null, halves: [], side: null, proteins: {}, prep: {}, sauces: [], sauceOn: [], toppings: [], note: "", quantity: 1 };
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
    if (ids.length) return "Pick your bowl again.";
  } else if (b.side) {
    return "Pick your bowl again.";
  }
  if (ids.some(id => !PROTEINS[id] || (size.proteins && !size.proteins.includes(id)))) return "Pick your protein again.";
  const scoops = scoopCount(b);
  const included = includedScoops(size);
  if (scoops < included) return `Pick ${included - scoops} more scoop${included - scoops > 1 ? "s" : ""} of protein.`;
  if (scoops - included > MENU.maxExtraScoops) return `Up to ${MENU.maxExtraScoops} extra scoops per bowl.`;
  if (Object.entries(b.prep || {}).some(([id, how]) => !b.proteins[id] || !PROTEINS[id].cookable || !PROTEIN_PREP[how])) return "Pick how you want your fish again.";
  if (b.sauces.some(id => !SAUCES[id])) return "Pick your sauces again.";
  const sauceOn = b.sauceOn || [];
  if (sauceOn.some(id => !SAUCE_PLACEMENTS[id])) return "Choose where you want your sauce again.";
  if (b.sauces.length && !sauceOn.length) return "Choose where you want your sauce.";
  if (!b.sauces.length && sauceOn.length) return "Pick a sauce first.";
  if (b.toppings.some(id => !TOPPINGS[id])) return "Pick your toppings again.";
  return null;
}

function bowlTitle(b) {
  const size = SIZES[b.size];
  if (size.cooked) return `${size.name} Bowl${size.kids ? " (Kids)" : ""}`;
  return size.id === "vegetarian" || size.id === "kids" ? size.name : `${size.name} Poke Bowl`;
}

function bowlDetail(b) {
  const parts = [
    BASES[b.base].split
      ? `${BASES[b.base].name} (${b.halves.map(id => BASES[id].name).join(" / ")})`
      : BASES[b.base].name,
    b.side ? `with ${BOWL_SIDES[b.side].name}` : "",
    Object.entries(b.proteins).map(([id, n]) =>
      PROTEINS[id].name + (n > 1 ? ` ×${n}` : "") + (b.prep?.[id] ? ` (${PROTEIN_PREP[b.prep[id]].name.toLowerCase()})` : "")
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

// Mirrors extraToLineItem() in src/menu.js
function extraProblem(x) {
  const item = EXTRAS[x.id];
  if (!item || !Number.isInteger(x.quantity) || x.quantity < 1) return "Unknown item.";
  if (item.options ? !item.options.some(o => o.id === x.option && Number.isInteger(o.price)) : (x.option || !Number.isInteger(item.price))) return `Choose a size for ${item.name}.`;
  if (item.choiceOf === "sauces" ? !SAUCES[x.choice] : x.choice) return `Choose which sauce for ${item.name}.`;
  return null;
}

function extraTitle(x) {
  const item = EXTRAS[x.id];
  const option = item.options && item.options.find(o => o.id === x.option);
  return item.name + (option ? ` (${option.name})` : "");
}

function extraDetail(x) {
  const item = EXTRAS[x.id];
  return x.choice ? SAUCES[x.choice].name : item.detail || "";
}

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
  const sizeGroups = [...new Set(MENU.sizes.map(s => s.group))];
  $("#opt-size").innerHTML = sizeGroups.map(g => `
    <h4>${esc(g)}</h4>
    <div class="pick-grid" role="radiogroup" aria-label="${esc(g)}">${MENU.sizes.filter(s => s.group === g).map(s =>
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
          ${esc(p.name)}${p.raw ? "*" : ""}${p.detail ? ` <small>${esc(p.detail)}</small>` : ""}${badges(p)} <b class="cc-count"></b>
        </button>
        <button type="button" class="cc-remove" data-remove="${p.id}" aria-label="Remove a scoop of ${esc(p.name)}">−</button>
      </span>`).join("")}
    </div>`).join("");

  // One Raw / Seared / Cooked row per cookable fish, shown once it's in the bowl
  $("#opt-prep").innerHTML = MENU.proteins.filter(p => p.cookable).map(p => `
    <div class="prep-row" data-prep-row="${p.id}" hidden>
      <span class="prep-name">${esc(p.name)}</span>
      <div class="pick-row" role="radiogroup" aria-label="How to prepare ${esc(p.name)}">${MENU.proteinPrep.map(h =>
        `<label class="pick"><input type="radio" name="prep-${p.id}" value="${h.id}"><span>${esc(h.name)}</span></label>`
      ).join("")}</div>
    </div>`).join("");

  $("#opt-sauce").innerHTML = MENU.sauces.map(s => pick("checkbox", "sauce", s)).join("");
  $("#opt-sauce-on").innerHTML = MENU.saucePlacements.map(p => pick("checkbox", "sauce-on", p)).join("");
  $("#opt-topping").innerHTML = MENU.toppings.map(t => pick("checkbox", "topping", t)).join("");
  decorateBadges($("#builder"));
}

function renderExtras() {
  const items = MENU.extras.filter(orderable);
  $("#extras").hidden = items.length === 0;
  const groups = [...new Set(items.map(x => x.group))];
  $("#opt-extras").innerHTML = groups.map(g => `
    <h4>${esc(g)}</h4>
    <ul class="extra-list">${items.filter(x => x.group === g).map(x => {
      const options = (x.options || []).filter(o => Number.isInteger(o.price));
      const price = options.length ? options.map(o => fmt(o.price)).join(" / ") : fmt(x.price);
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
          ${x.choiceOf === "sauces" ? `<select data-choice aria-label="Which sauce"><option value="">Which sauce?</option>${MENU.sauces.map(s =>
            `<option value="${s.id}">${esc(s.name)}</option>`).join("")}</select>` : ""}
          <button type="button" class="btn btn-ghost btn-sm" data-add-extra="${x.id}">Add</button>
        </div>
      </li>`;
    }).join("")}</ul>`).join("");
  decorateBadges($("#extras"));
}

function wireExtras() {
  $("#opt-extras").addEventListener("click", e => {
    const btn = e.target.closest("[data-add-extra]");
    if (!btn) return;
    const row = btn.closest(".extra-row");
    const choiceSelect = row.querySelector("[data-choice]");
    const extra = {
      kind: "extra",
      id: btn.dataset.addExtra,
      option: row.querySelector("[data-option]")?.value || null,
      choice: choiceSelect?.value || null,
      quantity: 1,
    };
    if (choiceSelect && !extra.choice) {
      choiceSelect.focus();
      return flashButton(btn, "Pick a sauce");
    }
    if (extraProblem(extra)) return flashButton(btn, "Unavailable");

    // Same item again just bumps the quantity
    const same = cart.find(x => isExtra(x) && x.id === extra.id && x.option === extra.option && x.choice === extra.choice);
    if (same) {
      same.quantity = Math.min(MENU.maxBowlQuantity, same.quantity + 1);
    } else {
      if (cart.length >= MENU.maxBowlsPerOrder) return flashButton(btn, "Order full");
      cart.push(extra);
    }
    cartChanged();
    flashButton(btn, "Added ✓");
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
  form.querySelectorAll('input[name="size"]').forEach(i => i.checked = i.value === bowl.size);
  form.querySelectorAll('input[name="base"]').forEach(i => i.checked = i.value === bowl.base);
  form.querySelectorAll('input[name="side"]').forEach(i => i.checked = i.value === bowl.side);
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

  // Cooked bowls swap the protein step for the included side
  $("#step-side").hidden = !size.cooked;
  $("#step-protein").hidden = !!size.cooked;

  const scoops = scoopCount(bowl);
  const extra = Math.max(0, scoops - includedScoops(size));
  form.querySelectorAll(".counter-chip").forEach(chip => {
    const id = chip.dataset.protein;
    const n = bowl.proteins[id] || 0;
    const locked = size.proteins && !size.proteins.includes(id);
    chip.classList.toggle("has", n > 0);
    chip.querySelector(".cc-count").textContent = n || "";
    chip.querySelector(".cc-add").disabled = locked || extra >= MENU.maxExtraScoops;
    chip.querySelector(".cc-remove").disabled = locked;
  });

  let anyPrep = false;
  form.querySelectorAll(".prep-row").forEach(row => {
    const id = row.dataset.prepRow;
    row.hidden = !bowl.proteins[id];
    anyPrep = anyPrep || !row.hidden;
    const how = bowl.prep[id] || MENU.proteinPrep[0].id;
    row.querySelectorAll("input").forEach(i => i.checked = i.value === how);
  });
  $("#prep-picker").hidden = !anyPrep;

  const status = $("#scoop-status");
  if (size.proteins) {
    status.textContent = `${size.name} comes with ${size.scoops} scoops of ${size.proteins.map(id => PROTEINS[id].name).join(", ")}. Extra scoops are ${fmt(MENU.extraScoopPrice)} each.`;
  } else if (scoops < size.scoops) {
    status.textContent = `${scoops} of ${size.scoops} scoops chosen. Tap a protein to add a scoop. Pick one twice for a double scoop.`;
  } else {
    status.textContent = `${size.scoops} of ${size.scoops} scoops chosen` + (extra ? ` + ${extra} extra (${fmt(extra * MENU.extraScoopPrice)}).` : `. Extra scoops are ${fmt(MENU.extraScoopPrice)} each.`);
  }
  status.classList.toggle("done", scoops >= size.scoops);

  $("#qty-value").textContent = bowl.quantity;
  $("#qty-minus").disabled = bowl.quantity <= 1;
  $("#qty-plus").disabled = bowl.quantity >= MENU.maxBowlQuantity;
  $("#bowl-note").value = bowl.note;
  $("#add-btn").textContent = `Add to order · ${fmt(bowlPrice(bowl))}`;
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
      bowl.prep = {};
      if (size.cooked) {
        bowl.proteins = {};
      } else {
        bowl.side = null;
        if (size.proteins) bowl.proteins = { [size.proteins[0]]: size.scoops };
        else if (wasLocked) bowl.proteins = {};
      }
    } else if (name === "base") {
      bowl.base = value;
      if (!BASES[value].split) bowl.halves = [];
    } else if (name === "half") {
      // Keep the two most recent picks, so a third tap swaps out the oldest
      bowl.halves = checked ? [...bowl.halves, value].slice(-2) : bowl.halves.filter(id => id !== value);
    } else if (name === "side") {
      bowl.side = value;
    } else if (name.startsWith("prep-")) {
      const id = name.slice(5);
      if (value === MENU.proteinPrep[0].id) delete bowl.prep[id];
      else bowl.prep[id] = value;
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
    } else if (remove) {
      const id = remove.dataset.remove;
      if (!bowl.proteins[id]) return;
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

function loadCart() {
  try {
    const saved = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
    if (!Array.isArray(saved)) return [];
    const extras = saved.filter(x => x && isExtra(x) && !extraProblem(x));
    // Fill in fields added after a cart may have been saved
    const bowls = saved
      .filter(b => b && !isExtra(b) && SIZES[b.size] && b.proteins && Array.isArray(b.sauces) && Array.isArray(b.toppings))
      .map(b => ({ ...b, prep: b.prep || {}, halves: b.halves || [], sauceOn: b.sauceOn || (b.sauces.length ? ["protein"] : []) }))
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
    extras: cart.filter(isExtra).map(({ id, option, choice, quantity }) => ({ id, option, choice, quantity })),
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

  $("#checkout-form").addEventListener("submit", async e => {
    e.preventDefault();
    if (busy) return;
    checkoutError("");

    const name = $("#c-name").value.trim();
    const phone = $("#c-phone").value.trim();
    const pickupNote = $("#c-notes").value.trim();
    if (cart.length === 0) return checkoutError("Your order is empty.");
    if (!name) { $("#c-name").focus(); return checkoutError("Please enter a name for pickup."); }
    if (phone.replace(/\D/g, "").length < 10) { $("#c-phone").focus(); return checkoutError("Please enter a phone number we can reach you at."); }
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

  bowl = newBowl();
  cart = loadCart();
  renderBuilder();
  renderExtras();
  syncBuilder();
  wireBuilder();
  wireExtras();
  wireCheckout();
  $("#order-layout").hidden = false;
  renderCart();
  requestQuote();
  initCard();
  checkHours();
  setInterval(checkHours, 30000);
}

init();
