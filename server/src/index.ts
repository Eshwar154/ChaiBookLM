import express from "express";

const app = express();
const port = process.env.PORT ?? 8080;

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "Hello from Chaibook API" });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
