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

// Level 1: POST /bookings - book a slot
app.post("/bookings", async (req, res) => {
  try {
    const { slot_id, name, email } = req.body ?? {};

    const { data, error } = await supabase
      .from("bookings")
      .insert({ slot_id, name, email })
      .select()
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.status(201).json(toBooking(data));
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Level 1: GET /bookings/:id - look up one booking
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

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
