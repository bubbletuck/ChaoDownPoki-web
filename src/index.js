// Cloudflare Worker: Square online ordering backend + static site fallback.
//
// GET  /api/menu          → the ordering menu and prices (src/menu.js)
// POST /api/quote         → { bowls, extras }               → exact subtotal, tax and total from Square
// POST /api/create-order  → { bowls, extras, customer, pickupNote, sourceId, expectedTotal, idempotencyKey }
//                           (refused outside the ordering hours in src/menu.js)
//
// A bowl looks like:
//   { size: "regular", base: "white-rice", proteins: { salmon: 1, tuna: 1 }, prep: { salmon: "seared" },
//     sauces: ["ponzu"], sauceOn: ["protein"], toppings: ["avocado"], note: "", quantity: 1 }
// An extra (side, drink, dessert) looks like:
//   { id: "egg-roll", option: "4", quantity: 1 }
//
// Every price comes from src/menu.js. The browser only says what was picked.

import { MENU, bowlToLineItem, extraToLineItem, orderingStatus } from "./menu.js";

const SQUARE_VERSION = "2025-01-23";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/menu") {
      // no-cache: browsers re-check after every deploy, so the page and prices never disagree
      return json(MENU, 200, { "Cache-Control": "no-cache" });
    }
    if (url.pathname === "/api/quote" || url.pathname === "/api/create-order") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
      }
      if (!env.SQUARE_ACCESS_TOKEN || !env.SQUARE_LOCATION_ID) {
        return json({ error: "Online ordering is not set up yet. Please call us to order." }, 500);
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

  const phoneDigits = typeof customer.phone === "string" ? customer.phone.replace(/\D/g, "") : "";
  if (phoneDigits.length < 10 || phoneDigits.length > 15) {
    return json({ error: "Please enter a valid phone number" }, 400);
  }

  // One key per checkout attempt from the browser, so a retried request
  // can't create a second order or charge the card twice.
  const key = typeof idempotencyKey === "string" && /^[\w-]{16,40}$/.test(idempotencyKey)
    ? idempotencyKey
    : crypto.randomUUID();

  const pickupDetails = {
    recipient: { display_name: name.slice(0, 255), phone_number: phoneDigits },
    schedule_type: "ASAP",
  };
  if (typeof pickupNote === "string" && pickupNote.trim()) {
    pickupDetails.note = pickupNote.trim().slice(0, 500);
  }
  order.fulfillments = [{ type: "PICKUP", state: "PROPOSED", pickup_details: pickupDetails }];

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

  return json({
    orderId: created.id,
    paymentId: payment.id,
    status: payment.status,
    receiptUrl: payment.receipt_url,
    ...totals(created),
  });
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
