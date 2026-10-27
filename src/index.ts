import express from "express";
import dotenv from "dotenv";
import { supabase } from "./supabase.js";

dotenv.config();

const app = express();
app.use(express.json()); // read JSON request bodies

const PORT = process.env.PORT || 3000;

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
