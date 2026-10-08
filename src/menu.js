// ================================================================
// Online ordering menu — the single source of truth for prices.
// The order page loads this through GET /api/menu, and the Worker
// uses it to price every order, so the browser never sets a price.
// Prices are in cents.
// ================================================================

export const MENU = {
  currency: "USD",

  // Sales tax added to every online order. Confirm this rate for your
  // location (Roseville, CA) before going live.
  taxName: "Sales Tax",
  taxPercent: "7.75",

  // Online ordering hours, in the shop's time zone. Orders stop
  // `lastOrderMinutes` before closing so there's time to make them.
  // Add dates you're closed as "YYYY-MM-DD", e.g. "2026-11-26".
  hours: {
    timeZone: "America/Los_Angeles",
    open: "11:00",
    close: "20:00",
    lastOrderMinutes: 15,
    closedDates: [],
  },

  extraScoopPrice: 400,
  maxExtraScoops: 5,
  maxBowlQuantity: 20,
  maxBowlsPerOrder: 30,

  // Every bowl you can order. Poke bowls pick their own protein scoops.
  // Cooked bowls come with their protein, so customers only pick a base,
  // sauces, toppings, and the included side.
  sizes: [
    { id: "regular",    group: "Poke bowls", name: "Regular",         detail: "2 scoops",      scoops: 2, price: 1650 },
    { id: "large",      group: "Poke bowls", name: "Large",           detail: "3 scoops",      scoops: 3, price: 1850 },
    { id: "xlarge",     group: "Poke bowls", name: "XLarge",          detail: "5 scoops",      scoops: 5, price: 2150 },
    { id: "vegetarian", group: "Poke bowls", name: "Vegetarian Bowl", detail: "3 scoops tofu", scoops: 3, price: 1650, proteins: ["tofu"] },
    { id: "kids",       group: "Poke bowls", name: "Kids Bowl",       detail: "1 scoop",       scoops: 1, price: 1100 },

    { id: "teriyaki-chicken",      group: "Teriyaki & chicken bowls", cooked: true, name: "Teriyaki Chicken",     detail: "Comes with a side", price: 1650 },
    { id: "teriyaki-chicken-kids", group: "Teriyaki & chicken bowls", cooked: true, name: "Teriyaki Chicken",     detail: "Kids size", kids: true, price: 1100 },
    { id: "teriyaki-salmon",       group: "Teriyaki & chicken bowls", cooked: true, name: "Teriyaki Salmon",      detail: "Comes with a side", price: 1750 },
    { id: "korean-spicy-chicken",  group: "Teriyaki & chicken bowls", cooked: true, name: "Korean Spicy Chicken", detail: "Comes with a side", spice: 2, price: 1650 },
    { id: "chao-chicken",          group: "Teriyaki & chicken bowls", cooked: true, name: "Chao Chicken",         detail: "Comes with a side", price: 1650 },
  ],

  // The side included with every cooked bowl
  bowlSides: [
    { id: "egg-roll",      name: "Egg Roll" },
    { id: "cheese-wonton", name: "Cheese Wonton" },
    { id: "pot-sticker",   name: "Pot Sticker" },
  ],

  bases: [
    { id: "white-rice",  name: "White Rice" },
    { id: "brown-rice",  name: "Brown Rice" },
    { id: "spring-mix",  name: "Organic Spring Mix" },
    { id: "wonton-chips", name: "Wonton Chips" },
    { id: "half-half",   name: "Half & Half" },
  ],

  proteins: [
    { id: "spicy-tuna",     name: "Spicy Tuna",     group: "Raw", raw: true, spice: 2 },
    { id: "chaodown-mix",   name: "ChaoDown Mix",   group: "Raw", raw: true, spice: 1, detail: "tuna & salmon, spicy-sweet sauce" },
    { id: "salmon",         name: "Salmon",         group: "Raw", raw: true },
    { id: "tuna",           name: "Tuna",           group: "Raw", raw: true },
    { id: "yellowtail",     name: "Yellowtail",     group: "Raw", raw: true },
    { id: "scallops",       name: "Scallops",       group: "Raw", raw: true },
    { id: "octopus-salad",  name: "Octopus Salad",  group: "Cooked" },
    { id: "shrimp",         name: "Shrimp",         group: "Cooked" },
    { id: "tofu",           name: "Tofu",           group: "Cooked" },
    { id: "tempura-shrimp", name: "Tempura Shrimp", group: "Cooked" },
    { id: "chicken",        name: "Chicken",        group: "Cooked" },
    { id: "crab-salad",     name: "Crab Salad",     group: "Cooked" },
  ],

  sauces: [
    { id: "chaodown",          name: "Chaodown Sauce", detail: "sweet", diet: ["gf"] },
    { id: "house",             name: "House Sauce" },
    { id: "spicy-sweet-mayo",  name: "Spicy & Sweet Mayo", spice: 1 },
    { id: "sweet-chili",       name: "Sweet Chili", spice: 1, diet: ["vg"] },
    { id: "korean-spicy",      name: "Korean Spicy Sauce", spice: 2 },
    { id: "wasabi-cream",      name: "Wasabi Cream", spice: 2, diet: ["gf", "sf"] },
    { id: "ponzu",             name: "Ponzu", diet: ["sf"] },
    { id: "sweet-unagi",       name: "Sweet Unagi", diet: ["vg"] },
    { id: "sweet-sesame-shoyu", name: "Sweet Sesame Shoyu", diet: ["vg"] },
    { id: "salty-sesame-shoyu", name: "Salty Sesame Shoyu", diet: ["vg", "sf"] },
    { id: "teriyaki",          name: "Teriyaki Sauce", diet: ["vg"] },
  ],

  toppings: [
    { id: "avocado",        name: "Avocado", price: 225 },
    { id: "green-onions",   name: "Green Onions" },
    { id: "cucumber",       name: "Cucumber" },
    { id: "edamame",        name: "Edamame" },
    { id: "broccoli",       name: "Broccoli" },
    { id: "pineapple",      name: "Pineapple" },
    { id: "corn",           name: "Corn" },
    { id: "carrot",         name: "Carrot" },
    { id: "sweet-pickle",   name: "Sweet Pickle" },
    { id: "seaweed-salad",  name: "Seaweed Salad" },
    { id: "crab-salad",     name: "Crab Salad" },
    { id: "eggs",           name: "Eggs" },
    { id: "ginger",         name: "Ginger" },
    { id: "masago",         name: "Masago" },
    { id: "habanero-masago", name: "Habanero-Infused Masago", spice: 3 },
    { id: "kimchi",         name: "Kimchi", spice: 1 },
    { id: "jalapenos",      name: "Jalapeños", spice: 2 },
    { id: "wasabi",         name: "Wasabi", spice: 2 },
    { id: "chili-oil",      name: "Chili Oil", spice: 2 },
    { id: "chili-flakes",   name: "Chili Flakes", spice: 2 },
    { id: "furikake",       name: "Furikake" },
    { id: "crispy-onion",   name: "Crispy Onion" },
    { id: "crushed-peanuts", name: "Crushed Peanuts" },
    { id: "wonton-strips",  name: "Wonton Strips" },
    { id: "sesame-seeds",   name: "Sesame Seeds" },
  ],
};

const byId = list => Object.fromEntries(list.map(x => [x.id, x]));
const SIZES = byId(MENU.sizes);
const BASES = byId(MENU.bases);
const PROTEINS = byId(MENU.proteins);
const SAUCES = byId(MENU.sauces);
const TOPPINGS = byId(MENU.toppings);
const BOWL_SIDES = byId(MENU.bowlSides);

// Is online ordering open right now? Returns { open, message }.
// order.js has a copy of this so the page can show the same message.
export function orderingStatus(now = new Date()) {
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

const money = amount => ({ amount, currency: MENU.currency });
const modifier = (name, amount = 0) => ({ name, base_price_money: money(amount) });

// Turns one bowl from the browser into a Square line item, priced from MENU.
// Returns { lineItem } or { error }.
export function bowlToLineItem(bowl) {
  if (!bowl || typeof bowl !== "object") return { error: "Invalid bowl" };

  const size = SIZES[bowl.size];
  if (!size) return { error: "Pick a bowl size" };

  const base = BASES[bowl.base];
  if (!base) return { error: "Pick a base" };

  const quantity = Number(bowl.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MENU.maxBowlQuantity) {
    return { error: "Invalid quantity" };
  }

  // Proteins: { proteinId: scoops }. Cooked bowls come with theirs.
  const proteinEntries = Object.entries(bowl.proteins || {});
  if (size.cooked && proteinEntries.length) return { error: `${size.name} comes with its protein` };

  // The included side, only on cooked bowls
  const side = size.cooked ? BOWL_SIDES[bowl.side] : null;
  if (size.cooked && !side) return { error: "Choose your side" };
  if (!size.cooked && bowl.side) return { error: "Poke bowls don't come with a side" };

  let scoops = 0;
  for (const [id, count] of proteinEntries) {
    if (!PROTEINS[id]) return { error: "Unknown protein" };
    if (size.proteins && !size.proteins.includes(id)) return { error: `${size.name} only comes with ${size.proteins.join(", ")}` };
    if (!Number.isInteger(count) || count < 1) return { error: "Invalid protein scoops" };
    scoops += count;
  }
  const included = size.scoops || 0;
  if (scoops < included) return { error: `Pick ${included} scoop${included > 1 ? "s" : ""} of protein` };
  const extraScoops = scoops - included;
  if (extraScoops > MENU.maxExtraScoops) return { error: `Up to ${MENU.maxExtraScoops} extra scoops per bowl` };

  const sauces = Array.isArray(bowl.sauces) ? bowl.sauces : [];
  if (new Set(sauces).size !== sauces.length || sauces.some(id => !SAUCES[id])) return { error: "Invalid sauce" };

  const toppings = Array.isArray(bowl.toppings) ? bowl.toppings : [];
  if (new Set(toppings).size !== toppings.length || toppings.some(id => !TOPPINGS[id])) return { error: "Invalid topping" };

  const modifiers = [modifier(`Base: ${base.name}`)];
  if (side) modifiers.push(modifier(`Side: ${side.name}`));
  for (const [id, count] of proteinEntries) {
    modifiers.push(modifier(`Protein: ${PROTEINS[id].name}${count > 1 ? ` ×${count}` : ""}`));
  }
  if (extraScoops > 0) {
    modifiers.push(modifier(`Extra protein scoop${extraScoops > 1 ? `s ×${extraScoops}` : ""}`, extraScoops * MENU.extraScoopPrice));
  }
  for (const id of sauces) modifiers.push(modifier(`Sauce: ${SAUCES[id].name}`));
  for (const id of toppings) modifiers.push(modifier(TOPPINGS[id].name, TOPPINGS[id].price || 0));

  const lineItem = size.cooked ? {
    name: `${size.name} Bowl`,
    variation_name: size.kids ? "Kids" : "Regular",
  } : {
    name: size.id === "vegetarian" || size.id === "kids" ? size.name : "Poke Bowl",
    variation_name: `${size.name} (${size.detail})`,
  };
  Object.assign(lineItem, {
    quantity: String(quantity),
    base_price_money: money(size.price),
    modifiers,
  });
  if (typeof bowl.note === "string" && bowl.note.trim()) {
    lineItem.note = bowl.note.trim().slice(0, 200);
  }
  return { lineItem };
}
