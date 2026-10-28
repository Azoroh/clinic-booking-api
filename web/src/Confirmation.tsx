import type { Booking, Slot } from "./api";
import { formatSlotTime } from "./format";

type Props = {
  booking: Booking;
  slot: Slot;
  onDone: () => void;
};

export default function Confirmation({ booking, slot, onDone }: Props) {
  return (
    <div className="confirmation">
      <h2>Booking confirmed</h2>
      <span className="badge">{booking.status}</span>
      <dl>
        <dt>Provider</dt>
        <dd>{slot.provider}</dd>
        <dt>When</dt>
        <dd>{formatSlotTime(slot.start, slot.end)}</dd>
        <dt>Name</dt>
        <dd>{booking.name}</dd>
        <dt>Email</dt>
        <dd>{booking.email}</dd>
        <dt>Booking ID</dt>
        <dd>{booking.id}</dd>
      </dl>
      <button onClick={onDone}>Book another</button>
    </div>
  );
}
