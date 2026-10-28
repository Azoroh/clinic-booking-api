import { useEffect, useRef, useState, type FormEvent } from "react";
import { bookSlot, type Booking, type Slot } from "./api";
import { formatSlotTime } from "./format";

type Props = {
  slot: Slot;
  onBack: () => void;
  onBooked: (booking: Booking) => void;
  onSlotGone: (message: string) => void;
};

export default function BookingForm({
  slot,
  onBack,
  onBooked,
  onSlotGone,
}: Props) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  // One key per distinct request body: retries reuse it, edits get a new one
  const keyRef = useRef(crypto.randomUUID());
  const rotateKey = () => {
    keyRef.current = crypto.randomUUID();
  };

  // Counts the rate-limit cooldown down once per second
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting || cooldown > 0) return;

    setSubmitting(true);
    setError("");
    const result = await bookSlot(
      { slot_id: slot.id, name, email },
      keyRef.current,
    );
    setSubmitting(false);

    if (result.ok) {
      onBooked(result.booking);
      return;
    }

    switch (result.kind) {
      case "taken":
        onSlotGone("Someone just booked that slot. Please pick another.");
        break;
      case "not_found":
        onSlotGone("That slot no longer exists. Please pick another.");
        break;
      case "rate_limited":
        setError("Too many attempts for this email.");
        setCooldown(result.retryAfter ?? 60);
        break;
      default:
        setError(result.message);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="form">
      <h2>{slot.provider}</h2>
      <p>{formatSlotTime(slot.start, slot.end)}</p>

      <label>
        Full name
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            rotateKey();
          }}
          autoComplete="name"
          required
        />
      </label>

      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            rotateKey();
          }}
          autoComplete="email"
          required
        />
      </label>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <div className="actions">
        <button
          type="button"
          className="secondary"
          onClick={onBack}
          disabled={submitting}
        >
          Back
        </button>
        <button type="submit" disabled={submitting || cooldown > 0}>
          {submitting
            ? "Booking..."
            : cooldown > 0
              ? `Try again in ${cooldown}s`
              : "Confirm booking"}
        </button>
      </div>
    </form>
  );
}
