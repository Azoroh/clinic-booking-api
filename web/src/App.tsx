import { useCallback, useEffect, useState } from "react";
import { getSlots, type Slot } from "./api";
import SlotList from "./SlotList";

export default function App() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Slot | null>(null);

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

      {!loading && !error && !selected && (
        <SlotList slots={slots} onSelect={setSelected} />
      )}

      {!loading && !error && selected && (
        <div>
          <p>
            You picked {selected.provider} ({selected.id}). The form comes next.
          </p>
          <button onClick={() => setSelected(null)}>Back</button>
        </div>
      )}
    </main>
  );
}
