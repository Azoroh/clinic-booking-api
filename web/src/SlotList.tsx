import type { Slot } from "./api";
import { formatSlotTime } from "./format";

type Props = {
  slots: Slot[];
  onSelect: (slot: Slot) => void;
};

export default function SlotList({ slots, onSelect }: Props) {
  const upcoming = slots.filter((s) => new Date(s.start) > new Date());

  if (upcoming.length === 0) {
    return <p>No upcoming slots right now. Please check back later.</p>;
  }

  return (
    <ul className="slots">
      {upcoming.map((slot) => (
        <li key={slot.id} className={slot.available ? "slot" : "slot booked"}>
          <div>
            <strong>{slot.provider}</strong>
            <div>{formatSlotTime(slot.start, slot.end)}</div>
          </div>
          <button disabled={!slot.available} onClick={() => onSelect(slot)}>
            {slot.available ? "Book" : "Booked"}
          </button>
        </li>
      ))}
    </ul>
  );
}
