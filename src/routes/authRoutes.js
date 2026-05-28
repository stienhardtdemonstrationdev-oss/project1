const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { supabase } = require("../lib/supabase");
const { ensureAuth } = require("../middleware/auth");

const router = express.Router();

function signToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      permissions: user.permissions
    },
    process.env.JWT_SECRET || "dev-secret",
    { expiresIn: "7d" }
  );
}

router.post("/bootstrap-admin", async (req, res) => {
  const { name, email, password } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ message: "name, email and password are required" });
  }

  const { count, error: countError } = await supabase
    .from("users")
    .select("id", { count: "exact", head: true });
  if (countError) {
    return res.status(500).json({ message: countError.message });
  }
  if ((count || 0) > 0) {
    return res.status(400).json({ message: "Admin already initialized" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const { data: adminUser, error: createError } = await supabase
    .from("users")
    .insert({
      name,
      email: String(email).toLowerCase().trim(),
      password_hash: passwordHash,
      role: "admin",
      permissions: {
        diamond: true,
        customer: true,
        memo: true,
        invoice: true,
        staffManagement: true
      },
      is_active: true
    })
    .select("*")
    .single();
  if (createError) {
    return res.status(500).json({ message: createError.message });
  }

  const token = signToken(adminUser);

  return res.status(201).json({
    token,
    user: {
      id: adminUser.id,
      name: adminUser.name,
      email: adminUser.email,
      role: adminUser.role,
      permissions: adminUser.permissions
    }
  });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: "email and password are required" });
  }

  const { data: user, error: userError } = await supabase
    .from("users")
    .select("*")
    .eq("email", String(email).toLowerCase().trim())
    .eq("is_active", true)
    .maybeSingle();
  if (userError) {
    return res.status(500).json({ message: userError.message });
  }
  if (!user) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const isValidPassword = await bcrypt.compare(password, user.password_hash);
  if (!isValidPassword) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = signToken(user);
  return res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      permissions: user.permissions
    }
  });
});

router.get("/me", ensureAuth, async (req, res) => {
  const { data: user, error } = await supabase
    .from("users")
    .select("id,name,email,role,permissions,is_active,created_at")
    .eq("id", req.user.userId)
    .maybeSingle();
  if (error) {
    return res.status(500).json({ message: error.message });
  }
  if (!user) {
    return res.status(404).json({ message: "User not found" });
  }
  return res.json(user);
});

module.exports = router;
