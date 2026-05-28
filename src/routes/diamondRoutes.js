const express = require("express");
const multer = require("multer");
const xlsx = require("xlsx");
const { supabase } = require("../lib/supabase");
const { ensureAuth, requirePermission } = require("../middleware/auth");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(ensureAuth);

function hasDiamondReadAccess(req) {
  return (
    req.user?.role === "admin" ||
    req.user?.permissions?.diamond ||
    req.user?.permissions?.memo ||
    req.user?.permissions?.invoice
  );
}

function serializeDiamond(row) {
  if (!row) return null;
  return { ...row, _id: row.id };
}

router.get("/", async (req, res) => {
  if (!hasDiamondReadAccess(req)) {
    return res.status(403).json({ message: "Missing permission: diamond" });
  }
  const { data: diamonds, error } = await supabase
    .from("diamonds")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    return res.status(500).json({ message: error.message });
  }
  return res.json((diamonds || []).map(serializeDiamond));
});

router.get("/:id", async (req, res) => {
  if (!hasDiamondReadAccess(req)) {
    return res.status(403).json({ message: "Missing permission: diamond" });
  }
  const { data: diamond, error } = await supabase
    .from("diamonds")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();
  if (error) {
    return res.status(500).json({ message: error.message });
  }
  if (!diamond) {
    return res.status(404).json({ message: "Diamond not found" });
  }
  return res.json(serializeDiamond(diamond));
});

router.post("/", async (req, res) => {
  if (!(req.user?.role === "admin" || req.user?.permissions?.diamond)) {
    return res.status(403).json({ message: "Missing permission: diamond" });
  }
  const { sku, shape, carat, color, clarity, price, status } = req.body;
  if (!sku || !shape || !carat || !color || !clarity || !price) {
    return res.status(400).json({ message: "Required fields: sku, shape, carat, color, clarity, price" });
  }

  const { data: created, error } = await supabase
    .from("diamonds")
    .insert({
      sku,
      shape,
      carat: Number(carat),
      color,
      clarity,
      price: Number(price),
      status: status || "Added"
    })
    .select("*")
    .single();
  if (error) {
    return res.status(400).json({ message: error.message });
  }
  return res.status(201).json(serializeDiamond(created));
});

router.patch("/:id", async (req, res) => {
  if (!(req.user?.role === "admin" || req.user?.permissions?.diamond)) {
    return res.status(403).json({ message: "Missing permission: diamond" });
  }
  const { sku, shape, carat, color, clarity, price, status } = req.body;
  const update = {};
  if (sku !== undefined) update.sku = sku;
  if (shape !== undefined) update.shape = shape;
  if (carat !== undefined) update.carat = Number(carat);
  if (color !== undefined) update.color = color;
  if (clarity !== undefined) update.clarity = clarity;
  if (price !== undefined) update.price = Number(price);
  if (status !== undefined) update.status = status;

  const { data: updated, error } = await supabase
    .from("diamonds")
    .update(update)
    .eq("id", req.params.id)
    .select("*")
    .maybeSingle();
  if (error) {
    return res.status(400).json({ message: error.message });
  }
  if (!updated) {
    return res.status(404).json({ message: "Diamond not found" });
  }
  return res.json(serializeDiamond(updated));
});

router.delete("/:id", async (req, res) => {
  if (!(req.user?.role === "admin" || req.user?.permissions?.diamond)) {
    return res.status(403).json({ message: "Missing permission: diamond" });
  }
  const { data: deleted, error } = await supabase
    .from("diamonds")
    .delete()
    .eq("id", req.params.id)
    .select("id")
    .maybeSingle();
  if (error) {
    return res.status(400).json({ message: error.message });
  }
  if (!deleted) {
    return res.status(404).json({ message: "Diamond not found" });
  }
  return res.json({ message: "Diamond deleted successfully" });
});

router.post("/bulk-upload", upload.single("file"), async (req, res) => {
  if (!(req.user?.role === "admin" || req.user?.permissions?.diamond)) {
    return res.status(403).json({ message: "Missing permission: diamond" });
  }
  if (!req.file) {
    return res.status(400).json({ message: "Excel file is required" });
  }

  try {
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const firstSheetName = workbook.SheetNames[0];
    if (!firstSheetName) {
      return res.status(400).json({ message: "Excel file has no sheets" });
    }

    const rows = xlsx.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
      defval: ""
    });

    if (!rows.length) {
      return res.status(400).json({ message: "Excel sheet is empty" });
    }

    const mapped = rows
      .map((row) => ({
        sku: String(row.sku || row.SKU || "").trim(),
        shape: String(row.shape || row.Shape || "").trim(),
        carat: Number(row.carat || row.Carat || 0),
        color: String(row.color || row.Color || "").trim(),
        clarity: String(row.clarity || row.Clarity || "").trim(),
        price: Number(row.price || row.Price || 0),
        status: String(row.status || row.Status || "Added").trim() || "Added"
      }))
      .filter(
        (item) =>
          item.sku &&
          item.shape &&
          Number.isFinite(item.carat) &&
          item.carat > 0 &&
          item.color &&
          item.clarity &&
          Number.isFinite(item.price) &&
          item.price > 0
      );

    if (!mapped.length) {
      return res.status(400).json({
        message:
          "No valid rows found. Required columns: sku, shape, carat, color, clarity, price"
      });
    }

    const { data: existingSkus, error: skuError } = await supabase
      .from("diamonds")
      .select("sku")
      .in("sku", mapped.map((item) => item.sku));
    if (skuError) {
      return res.status(500).json({ message: skuError.message });
    }
    const existingSet = new Set((existingSkus || []).map((item) => item.sku));
    const uniqueRows = mapped.filter((item) => !existingSet.has(item.sku));

    if (!uniqueRows.length) {
      return res.status(409).json({ message: "All rows are duplicates by SKU" });
    }

    const { data: inserted, error: insertError } = await supabase
      .from("diamonds")
      .insert(uniqueRows)
      .select("id");
    if (insertError) {
      return res.status(400).json({ message: insertError.message });
    }

    return res.status(201).json({
      message: "Bulk upload completed",
      insertedCount: inserted.length,
      skippedDuplicateCount: mapped.length - uniqueRows.length
    });
  } catch (error) {
    return res.status(400).json({ message: `Bulk upload failed: ${error.message}` });
  }
});

module.exports = router;
