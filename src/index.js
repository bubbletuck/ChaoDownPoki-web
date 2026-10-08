// Cloudflare Worker: Square online ordering backend + static site fallback.
//
// GET  /api/menu          → the ordering menu and prices (src/menu.js)
// GET  /api/status        → { busyExtra, busy, untilClose } → how busy we are (for pickup times)
// POST /api/quote         → { bowls, extras }               → exact subtotal, tax and total from Square
// POST /api/create-order  → { bowls, extras, customer, pickupNote, pickupMinutes, sourceId, expectedTotal, idempotencyKey }
//                           (refused outside the ordering hours in src/menu.js)
//
// A bowl looks like:
//   { size: "regular", base: "white-rice", proteins: { salmon: 1, tuna: 1 }, prep: { salmon: "seared" },
//     sauces: ["ponzu"], sauceOn: ["protein"], toppings: ["avocado"], note: "", quantity: 1 }
// An extra (side, drink, dessert) looks like:
//   { id: "egg-roll", option: "4", quantity: 1 }
//
// Every price comes from src/menu.js. The browser only says what was picked.

import {
  MENU, bowlToLineItem, extraToLineItem, orderingStatus,
  prepMinutes, busyExtraMinutes, earliestPickup, pickupChoices, minutesUntilClose, normalizePhone,
} from "./menu.js";

const SQUARE_VERSION = "2025-01-23";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/menu") {
      // no-cache: browsers re-check after every deploy, so the page and prices never disagree
      return json(MENU, 200, { "Cache-Control": "no-cache" });
    }
    if (url.pathname === "/api/status" || url.pathname === "/api/quote" || url.pathname === "/api/create-order") {
      // Names (never values) of missing settings, to make setup problems easy to spot
      const missing = ["SQUARE_ACCESS_TOKEN", "SQUARE_LOCATION_ID"].filter(name => !env[name]);
      if (missing.length) {
        console.log("Missing settings:", missing.join(", "));
        return json({ error: "Online ordering is not set up yet. Please call us to order.", missing }, 500);
      }
      if (url.pathname === "/api/status") return status(env);
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
      }
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON body" }, 400);
      }
      return url.pathname === "/api/quote" ? quote(body, env) : createOrder(body, env);
    }

    return env.ASSETS.fetch(request);
  },
};

// Builds the Square order (line items + tax) from the cart, or returns { error }.
function buildOrder(body, env) {
  const bowls = Array.isArray(body?.bowls) ? body.bowls : [];
  const extras = Array.isArray(body?.extras) ? body.extras : [];
  if (bowls.length + extras.length === 0) return { error: "Your order is empty" };
  if (bowls.length + extras.length > MENU.maxBowlsPerOrder) return { error: "That's a big order! Please call us for catering." };

  const line_items = [];
  for (const bowl of bowls) {
    const { lineItem, error } = bowlToLineItem(bowl);
    if (error) return { error };
    line_items.push(lineItem);
  }
  for (const extra of extras) {
    const { lineItem, error } = extraToLineItem(extra);
    if (error) return { error };
    line_items.push(lineItem);
  }

  return {
    order: {
      location_id: env.SQUARE_LOCATION_ID,
      line_items,
      taxes: [{ uid: "sales-tax", name: MENU.taxName, percentage: MENU.taxPercent, scope: "ORDER" }],
    },
  };
}

function totals(order) {
  return {
    subtotal: order.total_money.amount - order.total_tax_money.amount,
    tax: order.total_tax_money.amount,
    total: order.total_money.amount,
    currency: order.total_money.currency,
  };
}

async function quote(body, env) {
  const { order, error } = buildOrder(body, env);
  if (error) return json({ error }, 400);

  const res = await square(env, "/v2/orders/calculate", { order });
  if (!res.ok) return json({ error: "Could not price your order", details: res.errors }, res.status);
  return json(totals(res.data.order));
}

async function createOrder(body, env) {
  const status = orderingStatus();
  if (!status.open) return json({ error: status.message, closed: true }, 403);

  const { order, error } = buildOrder(body, env);
  if (error) return json({ error }, 400);

  const { sourceId, customer = {}, pickupNote, expectedTotal, idempotencyKey } = body;

  if (typeof sourceId !== "string" || !sourceId) {
    return json({ error: "Missing payment details" }, 400);
  }
  const name = typeof customer.name === "string" ? customer.name.trim() : "";
  if (!name) return json({ error: "Please enter a name for pickup" }, 400);

  const phone = normalizePhone(customer.phone);
  if (!phone) return json({ error: "Please enter a valid 10-digit phone number, like (916) 555-0123" }, 400);

  // Pickup time: no sooner than this order takes to make, plus extra when we're busy
  const busyExtra = busyExtraMinutes(await openOrderCount(env));
  const earliest = earliestPickup(prepMinutes(body.bowls, body.extras), busyExtra);
  const choices = pickupChoices(earliest);
  const pickupMinutes = Number(body.pickupMinutes);
  if (!choices.length) {
    return json({ error: "It's too close to closing time for online orders. Please call us.", closed: true }, 403);
  }
  if (!choices.includes(pickupMinutes)) {
    return json({
      error: `The earliest pickup for your order is now about ${choices[0]} minutes${busyExtra ? " because we just got busy" : ""}. Please pick a new time.`,
      pickupChanged: true, ...statusFor(busyExtra),
    }, 409);
  }
  const pickupAt = new Date(Date.now() + pickupMinutes * 60000);
  const pickupTime = clockTime(pickupAt);

  // One key per checkout attempt from the browser, so a retried request
  // can't create a second order or charge the card twice.
  const key = typeof idempotencyKey === "string" && /^[\w-]{16,40}$/.test(idempotencyKey)
    ? idempotencyKey
    : crypto.randomUUID();

  // A scheduled pickup shows the time on Square's order screen; the ticket name
  // ("Maria @ 7:40 PM") makes it easy to match orders to customers at the counter.
  const note = typeof pickupNote === "string" ? pickupNote.trim() : "";
  const pickupDetails = {
    recipient: { display_name: name.slice(0, 255), phone_number: phone },
    schedule_type: "SCHEDULED",
    pickup_at: pickupAt.toISOString(),
    note: `Pickup ~${pickupTime} (ordered for ${pickupMinutes} min).${note ? " " + note : ""}`.slice(0, 500),
  };
  order.fulfillments = [{ type: "PICKUP", state: "PROPOSED", pickup_details: pickupDetails }];
  order.ticket_name = `${name.slice(0, 18)} @ ${pickupTime}`.slice(0, 30);

  // 1. Create the order with a PICKUP fulfillment.
  const orderRes = await square(env, "/v2/orders", { idempotency_key: `${key}-order`, order });
  if (!orderRes.ok) {
    return json({ error: "We couldn't create your order. Please try again.", details: orderRes.errors }, orderRes.status);
  }
  const created = orderRes.data.order;

  // Never charge a different amount from the one the customer saw.
  if (Number.isInteger(expectedTotal) && expectedTotal !== created.total_money.amount) {
    return json({ error: "Your total changed. Please review your order and try again.", ...totals(created) }, 409);
  }

  // 2. Charge the card for the order total and attach the payment to the order.
  const paymentRes = await square(env, "/v2/payments", {
    idempotency_key: `${key}-pay`,
    source_id: sourceId,
    amount_money: created.total_money,
    order_id: created.id,
    location_id: env.SQUARE_LOCATION_ID,
    autocomplete: true,
  });
  if (!paymentRes.ok) {
    return json({ error: paymentMessage(paymentRes.errors), details: paymentRes.errors }, paymentRes.status);
  }
  const payment = paymentRes.data.payment;
  busy.openOrders++;  // count it right away so the next customer sees the busier kitchen

  return json({
    orderId: created.id,
    paymentId: payment.id,
    status: payment.status,
    receiptUrl: payment.receipt_url,
    pickupMinutes,
    pickupTime,
    ...totals(created),
  });
}

// ---------- Busy-kitchen pickup times ----------

// How many paid online pickup orders are still being made. Cached for 20s
// so a page full of customers doesn't hammer Square.
let busy = { at: 0, live: false, openOrders: 0 };
async function openOrderCount(env) {
  if (Date.now() - busy.at < 20000) return busy.openOrders;
  const since = new Date(Date.now() - MENU.pickup.countOrdersFromLastMinutes * 60000).toISOString();
  const res = await square(env, "/v2/orders/search", {
    location_ids: [env.SQUARE_LOCATION_ID],
    limit: 100,
    query: {
      filter: {
        state_filter: { states: ["OPEN"] },
        date_time_filter: { created_at: { start_at: since } },
        fulfillment_filter: { fulfillment_types: ["PICKUP"], fulfillment_states: ["PROPOSED", "RESERVED"] },
      },
      sort: { sort_field: "CREATED_AT", sort_order: "DESC" },
    },
  });
  if (!res.ok) {  // Square hiccup: keep the last known count
    busy.live = false;
    return busy.openOrders;
  }
  // Only paid orders: a declined card leaves an unpaid order behind that nobody is making
  busy = { at: Date.now(), live: true, openOrders: (res.data.orders || []).filter(o => o.tenders?.length).length };
  return busy.openOrders;
}

// The page works out each order's earliest pickup from these
function statusFor(busyExtra) {
  return {
    busyExtra,
    busy: busyExtra > 0,
    untilClose: minutesUntilClose(),  // null when hours aren't enforced
    live: !!busy.live,  // false = couldn't check Square, so showing normal times
  };
}

async function status(env) {
  return json(statusFor(busyExtraMinutes(await openOrderCount(env))));
}

// "7:40 PM" in the shop's time zone
function clockTime(date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: MENU.hours.timeZone, hour: "numeric", minute: "2-digit" }).format(date);
}

function paymentMessage(errors = []) {
  const code = errors[0]?.code;
  switch (code) {
    case "CARD_DECLINED":
    case "GENERIC_DECLINE":
    case "INSUFFICIENT_FUNDS":
      return "Your card was declined. Please try another card.";
    case "CVV_FAILURE":
    case "INVALID_CARD":
      return "Please check your card's security code and try again.";
    case "ADDRESS_VERIFICATION_FAILURE":
    case "INVALID_POSTAL_CODE":
      return "Please check your card's ZIP code and try again.";
    case "INVALID_EXPIRATION":
    case "CARD_EXPIRED":
      return "Please check your card's expiration date.";
    default:
      return "Payment didn't go through. Your card was not charged. Please try again.";
  }
}

async function square(env, path, payload) {
  const base = env.SQUARE_ENVIRONMENT === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";

  const res = await fetch(base + path, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Only pass Square's error codes/details to the client, not the raw response.
    const errors = (data.errors || []).map(({ code, detail, category }) => ({ code, detail, category }));
    console.log(`Square ${path} failed`, res.status, JSON.stringify(errors));
    return { ok: false, status: res.status >= 500 ? 502 : 400, errors };
  }
  return { ok: true, data };
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers },
  });
}
