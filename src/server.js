const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();
const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || "*";

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception during startup/runtime");
  console.error(error?.stack || error);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection during startup/runtime");
  console.error(reason?.stack || reason);
  process.exit(1);
});

app.use(cors({ origin: CLIENT_URL === "*" ? "*" : [CLIENT_URL] }));
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({ ok: true, service: "diamond-inventory-backend" });
});

app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ message: "Internal server error" });
});

async function startServer() {
  try {
    console.log("Startup step 1: loading route modules");
    const authRoutes = require("./routes/authRoutes");
    const staffRoutes = require("./routes/staffRoutes");
    const diamondRoutes = require("./routes/diamondRoutes");
    const customerRoutes = require("./routes/customerRoutes");
    const memoRoutes = require("./routes/memoRoutes");
    const invoiceRoutes = require("./routes/invoiceRoutes");

    console.log("Startup step 2: registering routes");
    app.use("/api/auth", authRoutes);
    app.use("/api/staff", staffRoutes);
    app.use("/api/diamonds", diamondRoutes);
    app.use("/api/customers", customerRoutes);
    app.use("/api/memos", memoRoutes);
    app.use("/api/invoices", invoiceRoutes);

    console.log("Startup step 3: checking environment");
    console.log("Has SUPABASE_URL:", Boolean(process.env.SUPABASE_URL));
    console.log("Has SUPABASE_SERVICE_ROLE_KEY:", Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY));

    console.log("Startup step 4: creating Supabase client");
    const { supabase } = require("./lib/supabase");
    console.log("Startup step 5: testing Supabase query");
    const { error } = await supabase.from("users").select("id").limit(1);
    if (error) {
      throw error;
    }
    console.log("Supabase connected");
  } catch (error) {
    console.error("Startup failed");
    console.error("Error message:", error?.message || "Unknown error");
    if (error?.details) console.error("Error details:", error.details);
    if (error?.hint) console.error("Error hint:", error.hint);
    if (error?.code) console.error("Error code:", error.code);
    if (error?.stack) console.error("Stack:", error.stack);
    process.exit(1);
  }

  console.log("Startup step 6: starting HTTP server");
  app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
  });
}

startServer();
