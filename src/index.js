// Cloudflare Worker: Square online ordering backend + static site fallback.
//
// POST /api/create-order
//   Body: {
//     sourceId: "cnon:...",            // card token from Square Web Payments SDK
//     items: [{ catalogObjectId: "...", quantity: 1, note?: "..." }],
//     customer: { name: "...", phone?: "...", email?: "..." },
//     pickupNote?: "..."
//   }
//
// Prices come from the Square catalog (catalogObjectId), never from the
// browser, so customers can't change what they're charged.

const SQUARE_VERSION = "2025-01-23";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/create-order") {
      if (request.method !== "POST") {
        return json({ error: "Method not allowed" }, 405, { Allow: "POST" });
      }
      return createOrder(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function createOrder(request, env) {
  if (!env.SQUARE_ACCESS_TOKEN || !env.SQUARE_LOCATION_ID) {
    return json({ error: "Ordering is not configured" }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { sourceId, items, customer = {}, pickupNote } = body || {};

  if (typeof sourceId !== "string" || !sourceId) {
    return json({ error: "Missing payment token" }, 400);
  }
  if (!Array.isArray(items) || items.length === 0) {
    return json({ error: "Cart is empty" }, 400);
  }
  if (typeof customer.name !== "string" || !customer.name.trim()) {
    return json({ error: "Name is required for pickup" }, 400);
  }

  const lineItems = [];
  for (const item of items) {
    const qty = Number(item?.quantity);
    if (typeof item?.catalogObjectId !== "string" || !Number.isInteger(qty) || qty < 1 || qty > 99) {
      return json({ error: "Invalid cart item" }, 400);
    }
    const lineItem = { catalog_object_id: item.catalogObjectId, quantity: String(qty) };
    if (typeof item.note === "string" && item.note.trim()) {
      lineItem.note = item.note.trim().slice(0, 500);
    }
    lineItems.push(lineItem);
  }

  const recipient = { display_name: customer.name.trim().slice(0, 255) };
  if (typeof customer.phone === "string" && customer.phone.trim()) {
    recipient.phone_number = customer.phone.trim();
  }
  if (typeof customer.email === "string" && customer.email.trim()) {
    recipient.email_address = customer.email.trim();
  }

  const pickupDetails = { recipient, schedule_type: "ASAP" };
  if (typeof pickupNote === "string" && pickupNote.trim()) {
    pickupDetails.note = pickupNote.trim().slice(0, 500);
  }

  // 1. Create the order with a PICKUP fulfillment.
  const orderRes = await square(env, "/v2/orders", {
    idempotency_key: crypto.randomUUID(),
    order: {
      location_id: env.SQUARE_LOCATION_ID,
      line_items: lineItems,
      fulfillments: [{ type: "PICKUP", state: "PROPOSED", pickup_details: pickupDetails }],
    },
  });
  if (!orderRes.ok) {
    return json({ error: "Could not create order", details: orderRes.errors }, orderRes.status);
  }
  const order = orderRes.data.order;

  // 2. Charge the card for the order total and attach the payment to the order.
  const paymentRes = await square(env, "/v2/payments", {
    idempotency_key: crypto.randomUUID(),
    source_id: sourceId,
    amount_money: order.total_money,
    order_id: order.id,
    location_id: env.SQUARE_LOCATION_ID,
    autocomplete: true,
    buyer_email_address: recipient.email_address,
  });
  if (!paymentRes.ok) {
    return json({ error: "Payment failed", details: paymentRes.errors, orderId: order.id }, paymentRes.status);
  }
  const payment = paymentRes.data.payment;

  return json({
    orderId: order.id,
    paymentId: payment.id,
    status: payment.status,
    total: order.total_money,
    receiptUrl: payment.receipt_url,
  });
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
