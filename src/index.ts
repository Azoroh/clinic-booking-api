import express from "express";
import dotenv from "dotenv";
import { supabase } from "./supabase.js";

dotenv.config();

const app = express();
app.use(express.json()); // read JSON request bodies

const PORT = process.env.PORT || 3000;

//postgres returns "2026-12-10T09:00:00+00:00", our spec wants "2026-12-10T09:00:00Z"
const toSpecDate = (value: string) =>
  new Date(value).toString().replace(".000Z", "Z");

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

app.get("/health", (req, res) => {
  res.json({ status: "API is running" });
});

// Level 1: POST /reset - Delete all bookings and replace all slots
app.post("/reset", async (req, res) => {
  try {
    const { slots } = req.body ?? {};

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

// Level 2: API Key Middleware (applies to all routes below this point)
app.use((req, res, next) => {
  const apiKey = req.header("X-API-Key");

  if (!apiKey || apiKey !== process.env.API_KEY) {
    return res.status(401).json({ error: "Missing or invalid API key" });
  }
  next();
});

// Level 1-3: POST /bookings - book a slot
app.post("/bookings", async (req, res) => {
  try {
    let { slot_id, name, email } = req.body ?? {};

    // Level 2: Missing fields check
    if (!slot_id || !name || !email) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Level 2: Trim spaces and store email in lower case
    name = name.trim();
    email = email.trim().toLowerCase();

    // email validation and empty string check
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email) || name === "") {
      return res.status(400).json({ error: "Invalid name or email format" });
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

    // Insert booking
    const { data, error } = await supabase
      .from("bookings")
      .insert({ slot_id, name, email })
      .select()
      .single();

    if (error) {
      // Level 3 Preview: Our unique index triggers error code 23505 on race conditions
      if (error.code === "23505") {
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
