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

  extraScoopPrice: 400,
  maxExtraScoops: 5,
  maxSauces: 3,
  maxBowlQuantity: 20,
  maxBowlsPerOrder: 30,

  sizes: [
    { id: "regular",    name: "Regular",         detail: "2 scoops",       scoops: 2, price: 1650 },
    { id: "large",      name: "Large",           detail: "3 scoops",       scoops: 3, price: 1850 },
    { id: "xlarge",     name: "XLarge",          detail: "5 scoops",       scoops: 5, price: 2150 },
    { id: "vegetarian", name: "Vegetarian Bowl", detail: "3 scoops tofu",  scoops: 3, price: 1650, proteins: ["tofu"] },
    { id: "kids",       name: "Kids Bowl",       detail: "1 scoop",        scoops: 1, price: 1100 },
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

  // Proteins: { proteinId: scoops }
  const proteinEntries = Object.entries(bowl.proteins || {});
  let scoops = 0;
  for (const [id, count] of proteinEntries) {
    if (!PROTEINS[id]) return { error: "Unknown protein" };
    if (size.proteins && !size.proteins.includes(id)) return { error: `${size.name} only comes with ${size.proteins.join(", ")}` };
    if (!Number.isInteger(count) || count < 1) return { error: "Invalid protein scoops" };
    scoops += count;
  }
  if (scoops < size.scoops) return { error: `Pick ${size.scoops} scoop${size.scoops > 1 ? "s" : ""} of protein` };
  const extraScoops = scoops - size.scoops;
  if (extraScoops > MENU.maxExtraScoops) return { error: `Up to ${MENU.maxExtraScoops} extra scoops per bowl` };

  const sauces = Array.isArray(bowl.sauces) ? bowl.sauces : [];
  if (new Set(sauces).size !== sauces.length || sauces.some(id => !SAUCES[id])) return { error: "Invalid sauce" };
  if (sauces.length > MENU.maxSauces) return { error: `Up to ${MENU.maxSauces} sauces per bowl` };

  const toppings = Array.isArray(bowl.toppings) ? bowl.toppings : [];
  if (new Set(toppings).size !== toppings.length || toppings.some(id => !TOPPINGS[id])) return { error: "Invalid topping" };

  const modifiers = [modifier(`Base: ${base.name}`)];
  for (const [id, count] of proteinEntries) {
    modifiers.push(modifier(`Protein: ${PROTEINS[id].name}${count > 1 ? ` ×${count}` : ""}`));
  }
  if (extraScoops > 0) {
    modifiers.push(modifier(`Extra protein scoop${extraScoops > 1 ? `s ×${extraScoops}` : ""}`, extraScoops * MENU.extraScoopPrice));
  }
  for (const id of sauces) modifiers.push(modifier(`Sauce: ${SAUCES[id].name}`));
  for (const id of toppings) modifiers.push(modifier(TOPPINGS[id].name, TOPPINGS[id].price || 0));

  const lineItem = {
    name: size.id === "vegetarian" || size.id === "kids" ? size.name : "Poke Bowl",
    variation_name: `${size.name} (${size.detail})`,
    quantity: String(quantity),
    base_price_money: money(size.price),
    modifiers,
  };
  if (typeof bowl.note === "string" && bowl.note.trim()) {
    lineItem.note = bowl.note.trim().slice(0, 200);
  }
  return { lineItem };
}
