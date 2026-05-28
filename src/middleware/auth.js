const jwt = require("jsonwebtoken");

function ensureAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!token) {
    return res.status(401).json({ message: "Missing token" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || "dev-secret");
    req.user = payload;
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  return next();
}

function requirePermission(permissionKey) {
  return (req, res, next) => {
    if (req.user?.role === "admin") {
      return next();
    }

    if (!req.user?.permissions?.[permissionKey]) {
      return res.status(403).json({ message: `Missing permission: ${permissionKey}` });
    }

    return next();
  };
}

module.exports = {
  ensureAuth,
  requireAdmin,
  requirePermission
};
