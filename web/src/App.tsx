import { useEffect, useState } from "react";
import { getSlots, type Slot } from "./api";

export default function App() {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    getSlots()
      .then(setSlots)
      .catch((e) => setError(e.message));
  }, []);

  return <pre>{error || JSON.stringify(slots, null, 2)}</pre>;
}
