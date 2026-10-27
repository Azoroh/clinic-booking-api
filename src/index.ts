import cors from "cors";
import express from "express";
import type { Response } from "express";
import dotenv from "dotenv";
import { supabase } from "./supabase.js";

dotenv.config();

const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "X-API-Key", "Idempotency-Key"],
    exposedHeaders: ["Retry-After"],
  }),
);

app.use(express.json()); // read JSON request bodies

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;
const attempts = new Map<string, number[]>(); //email > timestamps of recent attempts

const checkRateLimit = (email: string): number => {
  const now = Date.now();
  const recent = (attempts.get(email) ?? []).filter((t) => now - t < WINDOW_MS);

  if (recent.length >= MAX_ATTEMPTS) {
    attempts.set(email, recent);
    return Math.ceil((recent[0] + WINDOW_MS - now) / 1000);
  }

  recent.push(now);
  attempts.set(email, recent);
  return 0;
};

const PORT = process.env.PORT || 3000;

//postgres returns "2026-12-10T09:00:00+00:00", our spec wants "2026-12-10T09:00:00Z"
const toSpecDate = (value: string) =>
  new Date(value).toISOString().replace(".000Z", "Z");

//booking object from the spec
const toBooking = (row: {
  id: string;
  slot_id: string;
  name: string;
  email: string;
  status: string;
  created_at: string;
}) => ({
  id: row.id,
  slot_id: row.slot_id,
  name: row.name,
  email: row.email,
  status: row.status,
  created_at: new Date(row.created_at).toISOString(),
});

//An existing booking has this Idempotency-Key
//same body? replay it. Different body? reject with 422
const replayOrReject = (
  res: Response,
  existing: any,
  body: { slot_id: string; name: string; email: string },
) => {
  const sameBody =
    existing.slot_id === body.slot_id &&
    existing.name === body.name &&
    existing.email === body.email;

  if (sameBody) {
    return res.status(201).json(toBooking(existing));
  }
  return res
    .status(422)
    .json({ error: "Idempotency-Key reused with a different body" });
};

app.get("/health", (req, res) => {
  res.json({ status: "API is running" });
});

// Level 2: API Key Middleware (applies to all routes below this point)
app.use((req, res, next) => {
  const apiKey = req.header("X-API-Key");

  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: "Missing or invalid API key" });
  }
  next();
});

// Level 1: POST /reset - Delete all bookings and replace all slots
app.post("/reset", async (req, res) => {
  try {
    const { slots } = req.body ?? {};
    attempts.clear();

    // deleting all existing bookings
    const { error: bookingDeleteError } = await supabase
      .from("bookings")
      .delete()
      .not("id", "is", null);

    if (bookingDeleteError) {
      return res.status(500).json({ error: bookingDeleteError.message });
    }

    //delete all existing slots
    const { error: slotDeleteError } = await supabase
      .from("slots")
      .delete()
      .not("id", "is", null);

    if (slotDeleteError) {
      return res.status(500).json({ error: slotDeleteError.message });
    }

    //if array is provided, insert new slots
    if (Array.isArray(slots) && slots.length > 0) {
      const formattedSlots = slots.map(
        (slot: {
          id: string;
          provider: string;
          start: string;
          end: string;
        }) => ({
          id: slot.id,
          provider: slot.provider,
          start_time: slot.start,
          end_time: slot.end,
        }),
      );

      const { error: insertError } = await supabase
        .from("slots")
        .insert(formattedSlots);

      if (insertError) {
        return res.status(500).json({ error: insertError.message });
      }
    }

    return res.status(200).json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// Level 4: GET /bookings - List a person's bookings with cursor pagination
app.get("/bookings", async (req, res) => {
  try {
    const { email, cursor } = req.query;
    let limit = 10; //spec defaults to 10, so we use 10

    //validate email
    if (!email || typeof email !== "string") {
      return res.status(400).json({ error: "Email is required" });
    }

    //validate limit (1 to 50)
    if (req.query.limit !== undefined) {
      const parsedLimit = parseInt(req.query.limit as string, 10);
      if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 50) {
        return res.status(400).json({ error: "Invalid limit" });
      }
      limit = parsedLimit;
    }

    //build the query
    //we request 'limit + 1' from supabase to check if there is a 'next page'
    let query = supabase
      .from("bookings")
      .select("*")
      .eq("email", email.trim().toLowerCase()) //email match ignores case
      .order("seq", { ascending: true }) //oldest first
      .limit(limit + 1);

    if (typeof cursor === "string" && cursor !== "") {
      if (!/^\d+$/.test(cursor)) {
        return res.status(400).json({ error: "Invalid cursor" });
      }
      query = query.gt("seq", Number(cursor));
    }

    const { data, error } = await query;

    if (error) return res.status(500).json({ error: error.message });

    //handle pagination logic
    let next_cursor = null;
    let bookingsToReturn = data;

    //received more items than our limit?, next page exists.
    if (data.length > limit) {
      const lastItem = data[limit - 1];
      next_cursor = String(lastItem.seq); //counter number of the last item we return
      bookingsToReturn = data.slice(0, limit); // slice off the extra item we fetched
    }

    return res.status(200).json({
      bookings: bookingsToReturn.map(toBooking),
      next_cursor,
    });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Level 1-5: POST /bookings - book a slot
app.post("/bookings", async (req, res) => {
  try {
    const idempotencyKey = req.header("Idempotency-key");
    let { slot_id, name, email } = req.body ?? {};

    // Level 5: rate limit, runs before validation so failed attempts count too
    const rawEmail = req.body?.email;
    if (typeof rawEmail === "string" && rawEmail.trim() !== "") {
      const wait = checkRateLimit(rawEmail.trim().toLowerCase());
      if (wait > 0) {
        res.set("Retry-After", String(wait));
        return res
          .status(429)
          .json({ error: "Too many attempts, try again later" });
      }
    }

    // Level 2: Missing, empty, or wrong-type fields
    if (
      typeof slot_id !== "string" ||
      typeof name !== "string" ||
      typeof email !== "string" ||
      !slot_id.trim() ||
      !name.trim() ||
      !email.trim()
    ) {
      return res.status(400).json({ error: "Missing or invalid fields" });
    }

    // Level 2: Trim spaces and store email in lower case
    name = name.trim();
    email = email.trim().toLowerCase();

    // email validation and empty string check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email) || name === "") {
      return res.status(400).json({ error: "Invalid name or email format" });
    }

    // Level 4: Idempotency Check
    if (idempotencyKey) {
      const { data: existing, error: existError } = await supabase
        .from("bookings")
        .select("*")
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();

      if (existError) {
        return res.status(500).json({ error: existError.message });
      }

      if (existing) {
        return replayOrReject(res, existing, { slot_id, name, email });
      }
    }

    // Level 2: Check if slot exists and has not started yet
    const { data: slot, error: slotError } = await supabase
      .from("slots")
      .select("*")
      .eq("id", slot_id)
      .maybeSingle();

    if (slotError) return res.status(500).json({ error: slotError.message });
    if (!slot) return res.status(404).json({ error: "Slot not found" });

    const now = new Date();
    const startTime = new Date(slot.start_time);
    if (startTime <= now) {
      return res.status(400).json({ error: "Slot has already started" });
    }

    // Insert booking, save idempotency key if provided
    const { data, error } = await supabase
      .from("bookings")
      .insert({ slot_id, name, email, idempotency_key: idempotencyKey || null })
      .select()
      .single();

    if (error) {
      // Level 3 Preview: Our unique index triggers error code 23505 on race conditions
      if (error.code === "23505") {
        // Maybe this "duplicate" is really my twin request that just won
        if (idempotencyKey) {
          const { data: winner } = await supabase
            .from("bookings")
            .select("*")
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();

          if (winner) {
            return replayOrReject(res, winner, { slot_id, name, email });
          }
        }
        return res.status(409).json({ error: "Slot already booked" });
      }

      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json(toBooking(data));
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Level 1: GET /bookings/:id - looking up a single booking
app.get("/bookings/:id", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("bookings")
      .select()
      .eq("id", req.params.id)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!data) return res.status(404).json({ error: "booking not found" });

    return res.json(toBooking(data));
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Level 3: DELETE /bookings/:id - Cancel a booking
app.delete("/bookings/:id", async (req, res) => {
  try {
    const bookingId = req.params.id;

    const { data: existingBooking, error: fetchError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (fetchError) return res.status(500).json({ error: fetchError.message });
    // 404 if no booking with that id
    if (!existingBooking) {
      return res.status(404).json({ error: "No booking with that id" });
    }

    // 409 if already cancelled
    if (existingBooking.status === "cancelled") {
      return res.status(409).json({ error: "Already cancelled" });
    }

    // Update status to 'cancelled'
    const { data: updatedBooking, error: updateError } = await supabase
      .from("bookings")
      .update({ status: "cancelled" })
      .eq("id", bookingId)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({ error: updateError.message });
    }

    return res.status(200).json(toBooking(updatedBooking));
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Level 1: GET /slots - every slot, earliest first, optional provider filter
app.get("/slots", async (req, res) => {
  try {
    let query = supabase
      .from("slots")
      .select("id, provider, start_time, end_time, bookings(status)")
      .order("start_time", { ascending: true })
      .order("id", { ascending: true });

    const { provider } = req.query;
    if (typeof provider === "string") query = query.eq("provider", provider);

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    const slots = data.map((slot) => ({
      id: slot.id,
      provider: slot.provider,
      start: toSpecDate(slot.start_time),
      end: toSpecDate(slot.end_time),
      available: !slot.bookings.some(
        (booking: { status: string }) => booking.status === "confirmed",
      ),
    }));

    return res.json({ slots });
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
