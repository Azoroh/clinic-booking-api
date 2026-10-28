import { useActionState, useEffect, useState } from "react";
import { bookSlot, type Booking, type Slot } from "./api";
import { formatSlotTime } from "./format";

type Props = {
  slot: Slot;
  onBack: () => void;
  onBooked: (booking: Booking) => void;
  onSlotGone: (message: string) => void;
};

type FormState = {
  name: string;
  email: string;
  key: string;
  error: string;
};

const initialState: FormState = { name: "", email: "", key: "", error: "" };

export default function BookingForm({
  slot,
  onBack,
  onBooked,
  onSlotGone,
}: Props) {
  const [cooldown, setCooldown] = useState(0);

  const [state, formAction, isPending] = useActionState(
    async (prev: FormState, formData: FormData): Promise<FormState> => {
      const name = String(formData.get("name") ?? "");
      const email = String(formData.get("email") ?? "");

      // Same body as the last attempt: reuse its key. Edited body: new key.
      const key =
        prev.key && prev.name === name && prev.email === email
          ? prev.key
          : crypto.randomUUID();

      const next = (error = ""): FormState => ({ name, email, key, error });

      if (cooldown > 0) return next(prev.error);

      const result = await bookSlot({ slot_id: slot.id, name, email }, key);

      if (result.ok) {
        onBooked(result.booking);
        return next();
      }

      switch (result.kind) {
        case "taken":
          onSlotGone("Someone just booked that slot. Please pick another.");
          return next();
        case "not_found":
          onSlotGone("That slot no longer exists. Please pick another.");
          return next();
        case "rate_limited":
          setCooldown(result.retryAfter ?? 60);
          return next("Too many attempts for this email.");
        default:
          return next(result.message);
      }
    },
    initialState,
  );

  // Counts the rate-limit cooldown down once per second
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  return (
    <form action={formAction} className="form">
      <h2>{slot.provider}</h2>
      <p>{formatSlotTime(slot.start, slot.end)}</p>

      <label>
        Full name
        <input
          name="name"
          defaultValue={state.name}
          autoComplete="name"
          required
        />
      </label>

      <label>
        Email
        <input
          name="email"
          type="email"
          defaultValue={state.email}
          autoComplete="email"
          required
        />
      </label>

      {state.error && (
        <p className="error" role="alert">
          {state.error}
        </p>
      )}

      <div className="actions">
        <button
          type="button"
          className="secondary"
          onClick={onBack}
          disabled={isPending}
        >
          Back
        </button>
        <button type="submit" disabled={isPending || cooldown > 0}>
          {isPending
            ? "Booking..."
            : cooldown > 0
              ? `Try again in ${cooldown}s`
              : "Confirm booking"}
        </button>
      </div>
    </form>
  );
}
