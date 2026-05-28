const express = require("express");
const bcrypt = require("bcryptjs");
const { supabase } = require("../lib/supabase");
const { ensureAuth, requireAdmin } = require("../middleware/auth");

const router = express.Router();

router.use(ensureAuth, requireAdmin);

function serializeStaff(row) {
  if (!row) return null;
  return {
    _id: row.id,
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    permissions: row.permissions || {},
    isActive: !!row.is_active
  };
}

router.get("/", async (req, res) => {
  const { data: staffUsers, error } = await supabase
    .from("users")
    .select("id,name,email,role,permissions,is_active,created_at")
    .eq("role", "staff")
    .order("created_at", { ascending: false });
  if (error) {
    return res.status(500).json({ message: error.message });
  }
  return res.json((staffUsers || []).map(serializeStaff));
});

router.get("/:email", async (req, res) => {
  const email = String(req.params.email).toLowerCase().trim();
  const { data: staffUser, error } = await supabase
    .from("users")
    .select("id,name,email,role,permissions,is_active,created_at")
    .eq("email", email)
    .eq("role", "staff")
    .maybeSingle();
  if (error) {
    return res.status(500).json({ message: error.message });
  }
  if (!staffUser) {
    return res.status(404).json({ message: "Staff not found" });
  }
  return res.json(serializeStaff(staffUser));
});

router.post("/", async (req, res) => {
  const { name, email, password, permissions } = req.body;
  if (!name || !email || !password) {
    return res.status(400).json({ message: "name, email and password are required" });
  }

  const normalizedEmail = String(email).toLowerCase().trim();
  const { data: existingUser, error: existingError } = await supabase
    .from("users")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();
  if (existingError) {
    return res.status(500).json({ message: existingError.message });
  }
  if (existingUser) {
    return res.status(409).json({ message: "Staff with this email already exists" });
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const { data: staffUser, error: createError } = await supabase
    .from("users")
    .insert({
      name,
      email: normalizedEmail,
      password_hash: passwordHash,
      role: "staff",
      permissions: permissions || {},
      is_active: true
    })
    .select("id,name,email,role,permissions,is_active,created_at")
    .single();
  if (createError) {
    return res.status(500).json({ message: createError.message });
  }

  return res.status(201).json(serializeStaff(staffUser));
});

router.patch("/:email", async (req, res) => {
  const email = String(req.params.email).toLowerCase().trim();
  const { name, password, permissions, isActive } = req.body;

  const { data: staffUser, error: fetchError } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .eq("role", "staff")
    .maybeSingle();
  if (fetchError) {
    return res.status(500).json({ message: fetchError.message });
  }
  if (!staffUser) {
    return res.status(404).json({ message: "Staff not found" });
  }

  const update = {};
  if (name !== undefined) {
    update.name = name;
  }
  if (typeof isActive === "boolean") {
    update.is_active = isActive;
  }
  if (permissions && typeof permissions === "object") {
    update.permissions = {
      ...(staffUser.permissions || {}),
      ...permissions
    };
  }
  if (password) {
    update.password_hash = await bcrypt.hash(password, 10);
  }

  const { data: updatedStaff, error: updateError } = await supabase
    .from("users")
    .update(update)
    .eq("id", staffUser.id)
    .select("id,name,email,role,permissions,is_active,created_at")
    .single();
  if (updateError) {
    return res.status(500).json({ message: updateError.message });
  }

  return res.json(serializeStaff(updatedStaff));
});

router.delete("/:email", async (req, res) => {
  const email = String(req.params.email).toLowerCase().trim();
  const { data: deleted, error } = await supabase
    .from("users")
    .delete()
    .eq("email", email)
    .eq("role", "staff")
    .select("id")
    .maybeSingle();
  if (error) {
    return res.status(500).json({ message: error.message });
  }

  if (!deleted) {
    return res.status(404).json({ message: "Staff not found" });
  }

  return res.json({ message: "Staff deleted successfully" });
});

module.exports = router;
