const express = require("express");
const { supabase } = require("../lib/supabase");
const { ensureAuth } = require("../middleware/auth");

const router = express.Router();

router.use(ensureAuth);

function hasCustomerAccess(req) {
  return (
    req.user?.role === "admin" ||
    req.user?.permissions?.customer ||
    req.user?.permissions?.memo ||
    req.user?.permissions?.invoice
  );
}

function serializeCustomer(row) {
  if (!row) return null;
  return { ...row, _id: row.id };
}

function normalizePhone(phone) {
  return String(phone || "").trim().replace(/\s+/g, "");
}

function isValidPhone(phone) {
  if (!phone) return true;
  return /^\+?[0-9]{10,15}$/.test(phone);
}

router.get("/", async (req, res) => {
  if (!hasCustomerAccess(req)) {
    return res.status(403).json({ message: "Missing permission: customer" });
  }
  const { data: customers, error } = await supabase
    .from("customers")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    return res.status(500).json({ message: error.message });
  }
  return res.json((customers || []).map(serializeCustomer));
});

router.post("/", async (req, res) => {
  if (!(req.user?.role === "admin" || req.user?.permissions?.customer)) {
    return res.status(403).json({ message: "Missing permission: customer" });
  }
  const { name, company, phone, email, address } = req.body;
  if (!name) {
    return res.status(400).json({ message: "Customer name is required" });
  }
  const normalizedPhone = normalizePhone(phone);
  if (!isValidPhone(normalizedPhone)) {
    return res.status(400).json({ message: "Phone must be 10-15 digits (optional leading +)" });
  }

  const { data: created, error } = await supabase
    .from("customers")
    .insert({ name, company, phone: normalizedPhone, email, address })
    .select("*")
    .single();
  if (error) {
    return res.status(400).json({ message: error.message });
  }
  return res.status(201).json(serializeCustomer(created));
});

router.patch("/:id", async (req, res) => {
  if (!(req.user?.role === "admin" || req.user?.permissions?.customer)) {
    return res.status(403).json({ message: "Missing permission: customer" });
  }

  const { name, company, phone, email, address } = req.body;
  const normalizedPhone = normalizePhone(phone);
  if (!isValidPhone(normalizedPhone)) {
    return res.status(400).json({ message: "Phone must be 10-15 digits (optional leading +)" });
  }
  const { data: updated, error } = await supabase
    .from("customers")
    .update({ name, company, phone: normalizedPhone, email, address })
    .eq("id", req.params.id)
    .select("*")
    .maybeSingle();
  if (error) {
    return res.status(400).json({ message: error.message });
  }

  if (!updated) {
    return res.status(404).json({ message: "Customer not found" });
  }

  return res.json(serializeCustomer(updated));
});

router.delete("/:id", async (req, res) => {
  if (!(req.user?.role === "admin" || req.user?.permissions?.customer)) {
    return res.status(403).json({ message: "Missing permission: customer" });
  }

  const { data: deleted, error } = await supabase
    .from("customers")
    .delete()
    .eq("id", req.params.id)
    .select("id")
    .maybeSingle();
  if (error) {
    return res.status(400).json({ message: error.message });
  }
  if (!deleted) {
    return res.status(404).json({ message: "Customer not found" });
  }

  return res.json({ message: "Customer deleted successfully" });
});

module.exports = router;
