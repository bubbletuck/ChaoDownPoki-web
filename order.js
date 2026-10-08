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

let MENU, SIZES, BASES, PROTEINS, SAUCES, TOPPINGS, BOWL_SIDES;
let bowl;              // the bowl being built
let cart = [];         // bowls added to the order
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
  el.hidden = false;
  updateTotals();
}

// ---------- Bowl helpers ----------

function newBowl(size = "regular") {
  return { size, base: null, side: null, proteins: {}, sauces: [], toppings: [], note: "", quantity: 1 };
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
  if (b.sauces.some(id => !SAUCES[id])) return "Pick your sauces again.";
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
    BASES[b.base].name,
    b.side ? `with ${BOWL_SIDES[b.side].name}` : "",
    Object.entries(b.proteins).map(([id, n]) => PROTEINS[id].name + (n > 1 ? ` ×${n}` : "")).join(", "),
    b.sauces.map(id => SAUCES[id].name).join(", "),
    b.toppings.map(id => TOPPINGS[id].name).join(", "),
  ].filter(Boolean);
  return parts.join(" · ");
}

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

  $("#opt-sauce").innerHTML = MENU.sauces.map(s => pick("checkbox", "sauce", s)).join("");
  $("#opt-topping").innerHTML = MENU.toppings.map(t => pick("checkbox", "topping", t)).join("");
  decorateBadges($("#builder"));
}

function syncBuilder() {
  const size = SIZES[bowl.size];
  const form = $("#builder");
  form.querySelectorAll('input[name="size"]').forEach(i => i.checked = i.value === bowl.size);
  form.querySelectorAll('input[name="base"]').forEach(i => i.checked = i.value === bowl.base);
  form.querySelectorAll('input[name="side"]').forEach(i => i.checked = i.value === bowl.side);
  form.querySelectorAll('input[name="sauce"]').forEach(i => i.checked = bowl.sauces.includes(i.value));
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
      if (size.cooked) {
        bowl.proteins = {};
      } else {
        bowl.side = null;
        if (size.proteins) bowl.proteins = { [size.proteins[0]]: size.scoops };
        else if (wasLocked) bowl.proteins = {};
      }
    } else if (name === "base") {
      bowl.base = value;
    } else if (name === "side") {
      bowl.side = value;
    } else if (name === "sauce") {
      bowl.sauces = checked ? [...bowl.sauces, value] : bowl.sauces.filter(id => id !== value);
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
      if (--bowl.proteins[id] <= 0) delete bowl.proteins[id];
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
    return Array.isArray(saved) ? saved.filter(b => b && SIZES[b.size] && b.proteins && Array.isArray(b.sauces) && Array.isArray(b.toppings) && !bowlProblem(b)) : [];
  } catch {
    return [];
  }
}

function cartItemsHtml(items, removable) {
  return items.map((b, i) => `
    <li>
      <span class="ci-title">${b.quantity > 1 ? `${b.quantity} × ` : ""}${esc(bowlTitle(b))}</span>
      <span class="ci-price">${fmt(bowlPrice(b))}</span>
      <span class="ci-detail">${esc(bowlDetail(b))}${b.note ? `<br><em>“${esc(b.note)}”</em>` : ""}</span>
      ${removable ? `<button type="button" class="ci-remove" data-index="${i}">Remove</button>` : ""}
    </li>`).join("");
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
  const subtotal = cart.reduce((a, b) => a + bowlPrice(b), 0);
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
        body: JSON.stringify({ bowls: cart }),
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
    const btn = e.target.closest(".ci-remove");
    if (!btn) return;
    cart.splice(Number(btn.dataset.index), 1);
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
            bowls: cart,
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

  bowl = newBowl();
  cart = loadCart();
  renderBuilder();
  syncBuilder();
  wireBuilder();
  wireCheckout();
  $("#order-layout").hidden = false;
  renderCart();
  requestQuote();
  initCard();
  checkHours();
  setInterval(checkHours, 30000);
}

init();
