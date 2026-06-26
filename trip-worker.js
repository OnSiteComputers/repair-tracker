/**
 * On-Site Trip Calculator — Cloudflare Worker
 * ---------------------------------------------------------------
 * Relays a round-trip DRIVING time request to Google Routes API so the
 * browser app never sees the API key (Google blocks browser calls anyway).
 *
 * The app POSTs { address: "123 Main St, City, NC 28025" }.
 * Worker computes round-trip driving time (origin->dest + dest->origin)
 * from the shop, and returns:
 *   { ok:true, oneWayMinutes, roundTripMinutes, roundTripHours, oneWayMiles }
 * or { ok:false, error:"..." }.
 *
 * Pricing is intentionally NOT done here — the app applies
 * max($120, roundTripHours * $195). Keeping money math in the app means you
 * can change the rate without redeploying the Worker.
 *
 * SECRET (set in Cloudflare dashboard, never in code):
 *   GOOGLE_MAPS_KEY = your restricted Routes API key
 *
 * Optional var (set in dashboard, falls back to the shop address):
 *   SHOP_ORIGIN = "53 Cabarrus Ave W, Concord, NC 28025"
 */

const DEFAULT_ORIGIN = "53 Cabarrus Ave W, Concord, NC 28025";

// CORS so your Cloudflare Pages site can call this Worker from the browser.
function cors(extra) {
  return Object.assign({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  }, extra || {});
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: cors() });
}

// Ask Google Routes API for driving seconds + meters between two addresses.
async function leg(origin, destination, key) {
  const body = {
    origin: { address: origin },
    destination: { address: destination },
    travelMode: "DRIVE",
    // baseline (no live traffic) — stable for quoting
    routingPreference: "TRAFFIC_UNAWARE",
    units: "IMPERIAL",
  };
  const resp = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters",
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (!resp.ok) {
    const msg = (data && data.error && data.error.message) ? data.error.message : ("Google error " + resp.status);
    throw new Error(msg);
  }
  if (!data.routes || !data.routes.length) {
    throw new Error("No route found to that address");
  }
  const r = data.routes[0];
  // duration comes back like "1234s"
  const secs = parseInt(String(r.duration).replace(/[^0-9]/g, ""), 10) || 0;
  const meters = r.distanceMeters || 0;
  return { secs, meters };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors() });
    }
    if (request.method !== "POST") {
      return json({ ok: false, error: "POST only" }, 405);
    }
    const key = env.GOOGLE_MAPS_KEY;
    if (!key) {
      return json({ ok: false, error: "Server not configured (missing key)" }, 500);
    }
    const origin = env.SHOP_ORIGIN || DEFAULT_ORIGIN;

    let address = "";
    try {
      const b = await request.json();
      address = (b && b.address ? String(b.address) : "").trim();
    } catch (e) {
      return json({ ok: false, error: "Bad request body" }, 400);
    }
    if (address.length < 5) {
      return json({ ok: false, error: "Enter a full address (street, city, state/zip)" }, 400);
    }

    try {
      // Round trip = there + back. They can differ (one-way streets, ramps),
      // so we sum both legs rather than doubling one.
      const out = await leg(origin, address, key);
      const back = await leg(address, origin, key);
      const rtSecs = out.secs + back.secs;
      const oneWayMin = Math.round(out.secs / 60);
      const rtMin = Math.round(rtSecs / 60);
      const oneWayMiles = Math.round((out.meters / 1609.344) * 10) / 10;
      return json({
        ok: true,
        oneWayMinutes: oneWayMin,
        roundTripMinutes: rtMin,
        roundTripHours: Math.round((rtSecs / 3600) * 100) / 100,
        oneWayMiles: oneWayMiles,
      });
    } catch (e) {
      return json({ ok: false, error: e.message || "Lookup failed" }, 502);
    }
  },
};
