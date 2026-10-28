import { useCallback, useEffect, useState } from "react";
import { getSlots, type Booking, type Slot } from "./api";
import SlotList from "./SlotList";
import BookingForm from "./BookingForm";
import Confirmation from "./Confirmation";

export default function App() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Slot | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      setSlots(await getSlots());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load slots");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function handleSlotGone(message: string) {
    setSelected(null);
    setNotice(message);
    refresh();
  }

  function handleDone() {
    setBooking(null);
    setSelected(null);
    setNotice("");
    refresh();
  }

  return (
    <main className="app">
      <h1>Book an appointment</h1>

      {loading && <p>Loading slots...</p>}

      {!loading && error && (
        <div className="banner">
          <p>{error}</p>
          <button
            onClick={() => {
              setLoading(true);
              refresh();
            }}
          >
            Try again
          </button>
        </div>
      )}

      {!loading && !error && booking && selected && (
        <Confirmation booking={booking} slot={selected} onDone={handleDone} />
      )}

      {!loading && !error && !booking && selected && (
        <BookingForm
          key={selected.id}
          slot={selected}
          onBack={() => setSelected(null)}
          onBooked={setBooking}
          onSlotGone={handleSlotGone}
        />
      )}

      {!loading && !error && !booking && !selected && (
        <>
          {notice && <div className="notice">{notice}</div>}
          <SlotList
            slots={slots}
            onSelect={(slot) => {
              setNotice("");
              setSelected(slot);
            }}
          />
        </>
      )}
    </main>
  );
}
