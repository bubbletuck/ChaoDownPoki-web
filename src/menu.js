// ================================================================
// Online ordering menu — the single source of truth for prices.
// The order page loads this through GET /api/menu, and the Worker
// uses it to price every order, so the browser never sets a price.
// Prices are in cents.
// ================================================================

const FISH_PREP = ["raw", "seared", "cooked"];

// "Sauce on the side" toggle for extras that come with sauces
const SAUCE_ON_SIDE = { id: "sauce-side", name: "Sauce", items: [{ id: "on-side", name: "On the side" }], needs: "sauces" };

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
    // false = take orders any time (for testing). Set to true to enforce the hours below.
    enforced: false,
    timeZone: "America/Los_Angeles",
    open: "11:00",
    close: "20:00",
    lastOrderMinutes: 0,
    closedDates: [],
  },

  // "When will you pick up?" choices, in minutes from when the order is placed.
  // When lots of paid online orders are still being made, the earliest time
  // moves back automatically and the page says we're busy:
  //   earliest = minMinutes + extraMinutesPerOrder for each order past busyAfterOrders
  pickup: {
    choices: [15, 20, 30, 45, 60, 90],
    minMinutes: 15,
    busyAfterOrders: 4,
    extraMinutesPerOrder: 5,
    maxMinutes: 90,
    countOrdersFromLastMinutes: 90,
  },

  extraScoopPrice: 400,
  maxExtraScoops: 5,
  maxBowlQuantity: 20,
  maxBowlsPerOrder: 30,

  // Every bowl you can order. Poke bowls pick their own protein scoops.
  // Cooked bowls come with their protein; customers pick a base, sauces, toppings,
  // the included side, and can add any protein as extra scoops (extraScoopPrice each).
  sizes: [
    { id: "regular",    group: "Poke bowls", name: "Regular",         detail: "2 scoops",      scoops: 2, price: 1650 },
    { id: "large",      group: "Poke bowls", name: "Large",           detail: "3 scoops",      scoops: 3, price: 1850 },
    { id: "xlarge",     group: "Poke bowls", name: "XLarge",          detail: "5 scoops",      scoops: 5, price: 2150 },
    { id: "vegetarian-2", group: "Poke bowls", name: "Vegetarian Bowl", detail: "2 scoops tofu", scoops: 2, price: 1450, proteins: ["tofu"] },
    { id: "vegetarian", group: "Poke bowls", name: "Vegetarian Bowl", detail: "3 scoops tofu", scoops: 3, price: 1650, proteins: ["tofu"] },
    { id: "kids",       group: "Poke bowls", name: "Kids Bowl",       detail: "1 scoop",       scoops: 1, price: 1100, maxToppings: 4 },

    { id: "teriyaki-chicken",      group: "Teriyaki & chicken bowls", cooked: true, name: "Teriyaki Chicken",     detail: "Comes with a side", price: 1650 },
    { id: "teriyaki-chicken-kids", group: "Teriyaki & chicken bowls", cooked: true, name: "Teriyaki Chicken",     detail: "Kids size", kids: true, price: 1100, maxToppings: 4 },
    { id: "teriyaki-salmon",       group: "Teriyaki & chicken bowls", cooked: true, name: "Teriyaki Salmon",      detail: "Comes with a side", price: 1750 },
    { id: "korean-spicy-chicken",  group: "Teriyaki & chicken bowls", cooked: true, name: "Korean Spicy Chicken", detail: "Comes with a side", spice: 2, price: 1650 },
    { id: "chao-chicken",          group: "Teriyaki & chicken bowls", cooked: true, name: "Chao Chicken",         detail: "Comes with a side", price: 1650 },
  ],

  // The side included with every cooked bowl
  bowlSides: [
    { id: "egg-roll",      name: "Egg Roll" },
    { id: "cheese-wonton", name: "Cheese Wonton" },
    { id: "pot-sticker",   name: "Pot Sticker" },
    { id: "miso-soup",     name: "Miso Soup", addOns: [{ id: "seaweed", name: "Seaweed" }, { id: "green-onions", name: "Green Onions" }] },
  ],

  bases: [
    { id: "white-rice",  name: "White Rice" },
    { id: "brown-rice",  name: "Brown Rice" },
    { id: "spring-mix",  name: "Organic Spring Mix" },
    { id: "wonton-chips", name: "Wonton Chips" },
    { id: "half-half",   name: "Half & Half", detail: "pick any two", split: true },
  ],

  proteins: [
    { id: "spicy-tuna",     name: "Spicy Tuna",     group: "Raw", raw: true, spice: 2 },
    { id: "chaodown-mix",   name: "ChaoDown Mix",   group: "Raw", raw: true, spice: 1, detail: "tuna & salmon, spicy-sweet sauce", prep: FISH_PREP },
    { id: "salmon",         name: "Salmon",         group: "Raw", raw: true, prep: FISH_PREP },
    { id: "tuna",           name: "Tuna",           group: "Raw", raw: true, prep: FISH_PREP },
    { id: "yellowtail",     name: "Yellowtail",     group: "Raw", raw: true, prep: FISH_PREP },
    { id: "scallops",       name: "Scallops",       group: "Raw", raw: true, prep: FISH_PREP },
    { id: "octopus-salad",  name: "Octopus Salad",  group: "Cooked" },
    { id: "shrimp",         name: "Shrimp",         group: "Cooked", prep: ["as-is", "warmed"] },
    { id: "tofu",           name: "Tofu",           group: "Cooked" },
    { id: "tempura-shrimp", name: "Tempura Shrimp", group: "Cooked" },
    { id: "chicken",        name: "Chicken",        group: "Cooked" },
    { id: "crab-salad",     name: "Crab Salad",     group: "Cooked" },
  ],

  // Ways a protein can be prepared. Each protein's `prep` lists the ones it
  // allows; the first in its list is the default and isn't printed on tickets.
  proteinPrep: [
    { id: "raw",    name: "Raw" },
    { id: "seared", name: "Seared" },
    { id: "cooked", name: "Cooked" },
    { id: "as-is",  name: "As is" },
    { id: "warmed", name: "Warmed up" },
  ],

  // Where the sauce goes. Customers pick any combination.
  saucePlacements: [
    { id: "base",    name: "On the rice" },
    { id: "protein", name: "Mixed with protein" },
    { id: "top",     name: "On top" },
    { id: "side",    name: "On the side" },
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

  // Sides, soup, drinks, and ice cream ordered on their own.
  //   options: sizes to pick from, each with its own price
  //   choices: free add-ons the customer can pick. Each group lists its
  //            `items`, or uses `from: "sauces"` for the whole sauce list.
  //            `single` allows one pick, `required` needs at least one,
  //            `needs` only allows picks once that other group has some.
  //   price: null hides the item from online ordering until a price is set
  extras: [
    { id: "chaodown-fries", group: "Sides", name: "Chaodown Fries", price: 569, choices: [
      { id: "sauces", name: "Sauces", from: "sauces", max: 5 },
      SAUCE_ON_SIDE,
      { id: "toppings", name: "Toppings", items: [{ id: "green-onions", name: "Green Onions" }] },
    ] },
    { id: "miso-soup",      group: "Sides", name: "Miso Soup", price: 400, choices: [
      { id: "add", name: "Add", items: [{ id: "seaweed", name: "Seaweed" }, { id: "green-onions", name: "Green Onions" }] },
    ] },
    { id: "egg-roll",       group: "Sides", name: "Egg Roll", options: [
      { id: "2", name: "2 pcs", price: 499 }, { id: "4", name: "4 pcs", price: 899 } ] },
    { id: "cheese-wonton",  group: "Sides", name: "Cheese Wonton", options: [
      { id: "2", name: "2 pcs", price: 499 }, { id: "4", name: "4 pcs", price: 899 } ] },
    { id: "pot-sticker",    group: "Sides", name: "Pot Sticker", options: [
      { id: "2", name: "2 pcs", price: 499 }, { id: "4", name: "4 pcs", price: 799 } ] },
    { id: "fried-wontons",  group: "Sides", name: "Deep Fried Wontons", price: 499 },
    { id: "tempura-shrimp", group: "Sides", name: "Tempura Shrimp", detail: "4 pcs", price: 900, choices: [
      { id: "sauces", name: "Sauces", from: "sauces", max: 5 },
      SAUCE_ON_SIDE,
    ] },
    { id: "side-sauce",     group: "Sides", name: "Side of Sauce", detail: "8 oz", price: 500, choices: [
      { id: "sauce", name: "Sauce", from: "sauces", single: true, required: true },
    ] },
    { id: "side-edamame",   group: "Sides", name: "Side of Edamame", detail: "8 oz", price: 500 },
    { id: "side-seaweed",   group: "Sides", name: "Side of Seaweed", detail: "8 oz", price: 500 },
    { id: "side-crab",      group: "Sides", name: "Side of Crab Salad", detail: "8 oz", price: 500 },
    { id: "side-kimchi",    group: "Sides", name: "Side of Kimchi", detail: "8 oz", spice: 1, price: 500 },

    // TODO: add prices to put these on the order page
    { id: "fountain-drink", group: "Drinks", name: "Fountain Drink", price: null },
    { id: "bottled-drink",  group: "Drinks", name: "Bottled Drink", detail: "pick from our cooler at pickup", price: null },
    { id: "fish-ice-cream", group: "Ice Cream", name: "Fish Ice Cream", price: null },
    { id: "mochi-ice-cream", group: "Ice Cream", name: "Mochi Ice Cream", price: null },
  ],

  // The order page's sidebar. Bowl categories show the bowl builder with
  // that group of sizes; the others list extras from that group.
  categories: [
    { id: "poke",      name: "Poke Bowls",         blurb: "Build your own",          bowls: "Poke bowls" },
    { id: "teriyaki",  name: "Teriyaki & Chicken", blurb: "Comes with a side",       bowls: "Teriyaki & chicken bowls" },
    { id: "sides",     name: "Sides & Soup",       blurb: "Fries, egg rolls, miso",  extras: "Sides" },
    { id: "drinks",    name: "Drinks",             blurb: "Fountain & bottled",      extras: "Drinks" },
    { id: "ice-cream", name: "Ice Cream",          blurb: "Fish & mochi",            extras: "Ice Cream" },
  ],
};

const byId = list => Object.fromEntries(list.map(x => [x.id, x]));
const SIZES = byId(MENU.sizes);
const BASES = byId(MENU.bases);
const PROTEINS = byId(MENU.proteins);
const SAUCES = byId(MENU.sauces);
const TOPPINGS = byId(MENU.toppings);
const BOWL_SIDES = byId(MENU.bowlSides);
const SAUCE_PLACEMENTS = byId(MENU.saucePlacements);
const PROTEIN_PREP = byId(MENU.proteinPrep);
const EXTRAS = byId(MENU.extras);

// Is online ordering open right now? Returns { open, message }.
// order.js has a copy of this so the page can show the same message.
export function orderingStatus(now = new Date()) {
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

// Minutes until closing time, or null when hours aren't enforced
export function minutesUntilClose(now = new Date()) {
  const h = MENU.hours;
  if (!h.enforced) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: h.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now).map(p => [p.type, p.value])
  );
  const [ch, cm] = h.close.split(":").map(Number);
  return ch * 60 + cm - (Number(parts.hour) * 60 + Number(parts.minute));
}

// Earliest pickup (minutes from now) given how many orders are still being made
export function earliestPickup(openOrders) {
  const p = MENU.pickup;
  const extra = Math.max(0, openOrders - p.busyAfterOrders) * p.extraMinutesPerOrder;
  return Math.min(p.maxMinutes, p.minMinutes + extra);
}

// Pickup choices a customer can pick right now. order.js has a copy.
export function pickupChoices(earliest, now = new Date()) {
  const untilClose = minutesUntilClose(now);
  return MENU.pickup.choices.filter(m => m >= earliest && (untilClose === null || m <= untilClose));
}

// US phone number → "+19165550123", or null if it isn't a real 10-digit number
export function normalizePhone(input) {
  let digits = String(input || "").replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") digits = digits.slice(1);
  // Area code and exchange can't start with 0 or 1
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return null;
  return "+1" + digits;
}

// " (Seared)" or " (1 Raw, 2 Seared)" for a protein's per-scoop prep list;
// empty when every scoop is the default. order.js has a copy for the cart.
export function prepNote(protein, list) {
  if (!protein.prep || !Array.isArray(list) || !list.length) return "";
  const counts = protein.prep.map(h => [h, list.filter(x => x === h).length]).filter(([, n]) => n);
  if (counts.length === 1) return counts[0][0] === protein.prep[0] ? "" : ` (${PROTEIN_PREP[counts[0][0]].name})`;
  return ` (${counts.map(([h, n]) => `${n} ${PROTEIN_PREP[h].name}`).join(", ")})`;
}

// The options in one of an extra's choice groups
export const choiceItems = group => group.from === "sauces" ? MENU.sauces : group.items;

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

  // Half & Half: exactly two different regular bases
  const halves = Array.isArray(bowl.halves) ? bowl.halves : [];
  if (base.split) {
    if (halves.length !== 2 || halves[0] === halves[1] || halves.some(id => !BASES[id] || BASES[id].split)) {
      return { error: "Pick both halves for your Half & Half base" };
    }
  } else if (halves.length) {
    return { error: "Only Half & Half bases have halves" };
  }
  const baseName = base.split ? `${base.name} (${halves.map(id => BASES[id].name).join(" / ")})` : base.name;

  const quantity = Number(bowl.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MENU.maxBowlQuantity) {
    return { error: "Invalid quantity" };
  }

  // Proteins: { proteinId: scoops }. Cooked bowls include none, so every scoop on them is extra.
  const proteinEntries = Object.entries(bowl.proteins || {});

  // The included side, only on cooked bowls
  const side = size.cooked ? BOWL_SIDES[bowl.side] : null;
  if (size.cooked && !side) return { error: "Choose your side" };
  if (!size.cooked && bowl.side) return { error: "Poke bowls don't come with a side" };

  // Free add-ons for the side (seaweed and green onions in miso soup)
  const sideAddOns = Array.isArray(bowl.sideAddOns) ? bowl.sideAddOns : [];
  const allowed = side?.addOns || [];
  if (new Set(sideAddOns).size !== sideAddOns.length || sideAddOns.some(id => !allowed.some(a => a.id === id))) {
    return { error: "Invalid side add-on" };
  }

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

  // How each scoop is prepared, from that protein's `prep` list:
  // { salmon: ["raw", "seared", "cooked"] } has one entry per scoop
  const prep = bowl.prep && typeof bowl.prep === "object" ? bowl.prep : {};
  for (const [id, list] of Object.entries(prep)) {
    const p = PROTEINS[id];
    if (!bowl.proteins?.[id] || !p.prep || !Array.isArray(list) || list.length !== bowl.proteins[id] || list.some(h => !p.prep.includes(h))) {
      return { error: "Invalid protein prep" };
    }
  }

  const sauces = Array.isArray(bowl.sauces) ? bowl.sauces : [];
  if (new Set(sauces).size !== sauces.length || sauces.some(id => !SAUCES[id])) return { error: "Invalid sauce" };

  const sauceOn = Array.isArray(bowl.sauceOn) ? bowl.sauceOn : [];
  if (new Set(sauceOn).size !== sauceOn.length || sauceOn.some(id => !SAUCE_PLACEMENTS[id])) return { error: "Invalid sauce placement" };
  if (sauces.length && !sauceOn.length) return { error: "Choose where you want your sauce" };
  if (!sauces.length && sauceOn.length) return { error: "Pick a sauce first" };

  const toppings = Array.isArray(bowl.toppings) ? bowl.toppings : [];
  if (new Set(toppings).size !== toppings.length || toppings.some(id => !TOPPINGS[id])) return { error: "Invalid topping" };
  if (size.maxToppings && toppings.length > size.maxToppings) return { error: `Kids bowls come with up to ${size.maxToppings} toppings` };

  const modifiers = [modifier(`Base: ${baseName}`)];
  if (side) {
    const extras = sideAddOns.map(id => allowed.find(a => a.id === id).name);
    modifiers.push(modifier(`Side: ${side.name}${extras.length ? ` (${extras.join(", ")})` : ""}`));
  }
  for (const [id, count] of proteinEntries) {
    const how = prepNote(PROTEINS[id], prep[id]);
    modifiers.push(modifier(`${size.cooked ? "Add protein" : "Protein"}: ${PROTEINS[id].name}${count > 1 ? ` ×${count}` : ""}${how}`));
  }
  if (extraScoops > 0) {
    modifiers.push(modifier(`Extra protein scoop${extraScoops > 1 ? `s ×${extraScoops}` : ""}`, extraScoops * MENU.extraScoopPrice));
  }
  for (const id of sauces) modifiers.push(modifier(`Sauce: ${SAUCES[id].name}`));
  if (sauceOn.length) modifiers.push(modifier(`Sauce placement: ${sauceOn.map(id => SAUCE_PLACEMENTS[id].name).join(", ")}`));
  for (const id of toppings) modifiers.push(modifier(TOPPINGS[id].name, TOPPINGS[id].price || 0));

  const lineItem = size.cooked ? {
    name: `${size.name} Bowl`,
    variation_name: size.kids ? "Kids" : "Regular",
  } : {
    name: size.proteins || size.id === "kids" ? size.name : "Poke Bowl",
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

// Turns one side / drink / dessert into a Square line item, priced from MENU.
// An extra looks like { id: "chaodown-fries", option: null, picks: { sauces: ["ponzu"] }, quantity: 2 }.
// Returns { lineItem } or { error }.
export function extraToLineItem(extra) {
  const item = EXTRAS[extra?.id];
  if (!item) return { error: "Unknown item" };

  const quantity = Number(extra.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MENU.maxBowlQuantity) {
    return { error: "Invalid quantity" };
  }

  let price = item.price;
  let variation = item.detail || "Regular";
  if (item.options) {
    const option = item.options.find(o => o.id === extra.option);
    if (!option) return { error: `Choose a size for ${item.name}` };
    price = option.price;
    variation = option.name;
  } else if (extra.option) {
    return { error: "Invalid option" };
  }
  if (!Number.isInteger(price)) return { error: `${item.name} isn't available online yet` };

  // Free add-ons: { groupId: [itemId, ...] }
  const picks = extra.picks && typeof extra.picks === "object" ? extra.picks : {};
  const groups = item.choices || [];
  if (Object.keys(picks).some(g => !groups.some(c => c.id === g))) return { error: "Invalid choice" };
  const modifiers = [];
  for (const group of groups) {
    const chosen = picks[group.id] || [];
    const options = byId(choiceItems(group));
    if (!Array.isArray(chosen) || new Set(chosen).size !== chosen.length || chosen.some(id => !options[id])) return { error: "Invalid choice" };
    if (group.single && chosen.length > 1) return { error: `Pick one ${group.name.toLowerCase()} for ${item.name}` };
    if (group.max && chosen.length > group.max) return { error: `Up to ${group.max} ${group.name.toLowerCase()} for ${item.name}` };
    if (group.required && !chosen.length) return { error: `Choose a ${group.name.toLowerCase()} for ${item.name}` };
    if (group.needs && chosen.length && !(picks[group.needs] || []).length) return { error: `Pick a sauce for ${item.name} first` };
    for (const id of chosen) modifiers.push(modifier(`${group.name}: ${options[id].name}`));
  }

  const lineItem = {
    name: item.name,
    variation_name: variation,
    quantity: String(quantity),
    base_price_money: money(price),
  };
  if (modifiers.length) lineItem.modifiers = modifiers;
  return { lineItem };
}
