export type Slot = {
  id: string;
  provider: string;
  start: string;
  end: string;
  available: boolean;
};

export type Booking = {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: "confirmed" | "cancelled";
  created_at: string;
};

export type BookResult =
  | { ok: true; booking: Booking }
  | {
      ok: false;
      kind: "invalid" | "not_found" | "taken" | "rate_limited" | "other";
      message: string;
      retryAfter?: number;
    };

const API_URL = String(import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "");
const API_KEY = import.meta.env.VITE_API_KEY;

//all call go through here, so the API key header is added in one place
async function request(
  path: string,
  init: Omit<RequestInit, "headers"> & {
    headers?: Record<string, string>;
  } = {},
) {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": API_KEY,
        ...init.headers,
      },
    });
  } catch {
    throw new Error(
      "Can't reach the server. Check your connection and try again.",
    );
  }
  const body = await res.json().catch(() => null);
  return { res, body };
}

export async function getSlots(): Promise<Slot[]> {
  const { res, body } = await request("/slots");
  if (!res.ok) throw new Error(body?.error ?? "Could not load slots");
  return body.slots;
}

export async function bookSlot(
  input: { slot_id: string; name: string; email: string },
  idempotencyKey: string,
): Promise<BookResult> {
  try {
    const { res, body } = await request("/bookings", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(input),
    });

    if (res.status === 201) return { ok: true, booking: body };

    const message = body?.error ?? "Something went wrong";
    switch (res.status) {
      case 400:
        return { ok: false, kind: "invalid", message };
      case 404:
        return { ok: false, kind: "not_found", message };
      case 409:
        return { ok: false, kind: "taken", message };
      case 429:
        return {
          ok: false,
          kind: "rate_limited",
          message,
          retryAfter: Number(res.headers.get("Retry-After")) || 60,
        };
      default:
        return { ok: false, kind: "other", message };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Something went wrong";
    return { ok: false, kind: "other", message };
  }
}
