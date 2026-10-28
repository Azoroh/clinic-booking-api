const BASE = process.env.BASE_URL ?? "http://localhost:3000";

const headers = {
  "Content-Type": "application/json",
  "X-API-Key": process.env.API_KEY,
};

const results = await Promise.all(
  Array.from({ length: 10 }, (_, i) =>
    fetch(`${BASE}/bookings`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        slot_id: "s1",
        name: `P${i}`,
        email: `p${i}@example.com`,
      }),
    }).then((r) => r.status),
  ),
);

console.log(results);
