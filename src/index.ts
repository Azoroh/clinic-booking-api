import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json()); // Allows us to read JSON request bodies

const PORT = process.env.PORT || 3000;

app.get("/health", (req, res) => {
  res.json({ status: "API is running" });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
