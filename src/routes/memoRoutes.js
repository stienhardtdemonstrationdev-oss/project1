const express = require("express");
const { supabase } = require("../lib/supabase");
const { ensureAuth, requirePermission } = require("../middleware/auth");

const router = express.Router();

function createMemoNumber() {
  return `MEMO-${Date.now()}`;
}

function createInvoiceNumber() {
  return `INV-${Date.now()}`;
}

function parseDateOnly(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

function validateMemoDateRange(fromDate, toDate) {
  const from = parseDateOnly(fromDate);
  const to = parseDateOnly(toDate);
  if (!from || !to) {
    return "Invalid memo date";
  }
  if (from > to) {
    return "fromDate cannot be after toDate";
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const maxDate = new Date(today);
  maxDate.setFullYear(maxDate.getFullYear() + 1);

  const fromDay = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const toDay = new Date(to.getFullYear(), to.getMonth(), to.getDate());

  if (fromDay < today || toDay < today) {
    return "Memo dates must be from today onwards";
  }
  if (fromDay > maxDate || toDay > maxDate) {
    return "Memo dates can be at most 1 year from today";
  }

  return null;
}

async function getCustomersMap(ids) {
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from("customers").select("*").in("id", ids);
  if (error) throw error;
  return new Map((data || []).map((item) => [item.id, item]));
}

async function getDiamondsMap(ids) {
  if (!ids.length) return new Map();
  const { data, error } = await supabase.from("diamonds").select("*").in("id", ids);
  if (error) throw error;
  return new Map((data || []).map((item) => [item.id, item]));
}

function serializeMemo(row, customer = null, diamonds = null) {
  return {
    _id: row.id,
    id: row.id,
    memoNumber: row.memo_number,
    customer: customer ? { ...customer, _id: customer.id } : row.customer || null,
    diamonds: (diamonds || row.diamonds || []).map((d) => ({ ...d, _id: d.id })),
    totalAmount: row.total_amount,
    fromDate: row.from_date,
    toDate: row.to_date,
    status: row.status,
    notes: row.notes || ""
  };
}

router.use(ensureAuth);

router.get("/", requirePermission("memo"), async (req, res) => {
  const { data: memos, error } = await supabase
    .from("memos")
    .select("*")
    .eq("status", "Open")
    .order("created_at", { ascending: false });
  if (error) {
    return res.status(500).json({ message: error.message });
  }

  const customerIds = [...new Set((memos || []).map((m) => m.customer_id).filter(Boolean))];
  const diamondIds = [
    ...new Set((memos || []).flatMap((m) => (Array.isArray(m.diamond_ids) ? m.diamond_ids : [])))
  ];
  const customersMap = await getCustomersMap(customerIds);
  const diamondsMap = await getDiamondsMap(diamondIds);

  const hydrated = (memos || []).map((memo) =>
    serializeMemo(
      memo,
      customersMap.get(memo.customer_id) || null,
      (memo.diamond_ids || []).map((id) => diamondsMap.get(id)).filter(Boolean)
    )
  );
  return res.json(hydrated);
});

router.post("/", requirePermission("memo"), async (req, res) => {
  const { customerId, diamondIds, notes, fromDate, toDate } = req.body;
  if (!customerId || !Array.isArray(diamondIds) || diamondIds.length === 0 || !fromDate || !toDate) {
    return res.status(400).json({ message: "customerId, diamondIds, fromDate and toDate are required" });
  }

  const dateError = validateMemoDateRange(fromDate, toDate);
  if (dateError) {
    return res.status(400).json({ message: dateError });
  }

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .maybeSingle();
  if (customerError) {
    return res.status(500).json({ message: customerError.message });
  }
  if (!customer) {
    return res.status(404).json({ message: "Customer not found" });
  }

  const { data: diamonds, error: diamondsError } = await supabase
    .from("diamonds")
    .select("*")
    .in("id", diamondIds);
  if (diamondsError) {
    return res.status(500).json({ message: diamondsError.message });
  }
  if ((diamonds || []).length !== diamondIds.length) {
    return res.status(400).json({ message: "Some diamonds are invalid" });
  }

  const blocked = diamonds.find((d) => ["On Invoice", "Sold"].includes(d.status));
  if (blocked) {
    return res.status(400).json({ message: `Diamond ${blocked.sku} cannot be added to memo` });
  }

  const totalAmount = diamonds.reduce((sum, item) => sum + Number(item.price || 0), 0);

  const { data: memo, error: createError } = await supabase
    .from("memos")
    .insert({
      memo_number: createMemoNumber(),
      customer_id: customerId,
      diamond_ids: diamondIds,
      total_amount: totalAmount,
      from_date: fromDate,
      to_date: toDate,
      notes,
      status: "Open"
    })
    .select("*")
    .single();
  if (createError) {
    return res.status(400).json({ message: createError.message });
  }

  const { error: statusError } = await supabase
    .from("diamonds")
    .update({ status: "On Memo" })
    .in("id", diamondIds);
  if (statusError) {
    return res.status(500).json({ message: statusError.message });
  }

  return res.status(201).json(serializeMemo(memo, customer, diamonds || []));
});

router.post("/:id/convert-to-invoice", requirePermission("invoice"), async (req, res) => {
  const { data: memo, error: memoError } = await supabase
    .from("memos")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();
  if (memoError) {
    return res.status(500).json({ message: memoError.message });
  }
  if (!memo) {
    return res.status(404).json({ message: "Memo not found" });
  }
  if (memo.status !== "Open") {
    return res.status(400).json({ message: "Only open memos can be converted" });
  }

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .insert({
      invoice_number: createInvoiceNumber(),
      customer_id: memo.customer_id,
      diamond_ids: memo.diamond_ids,
      memo_id: memo.id,
      total_amount: memo.total_amount,
      notes: `Converted from ${memo.memo_number}`,
      status: "Draft"
    })
    .select("*")
    .single();
  if (invoiceError) {
    return res.status(400).json({ message: invoiceError.message });
  }

  const { error: memoUpdateError } = await supabase
    .from("memos")
    .update({ status: "Converted" })
    .eq("id", memo.id);
  if (memoUpdateError) {
    return res.status(500).json({ message: memoUpdateError.message });
  }

  const { error: diamondStatusError } = await supabase
    .from("diamonds")
    .update({ status: "On Invoice" })
    .in("id", memo.diamond_ids || []);
  if (diamondStatusError) {
    return res.status(500).json({ message: diamondStatusError.message });
  }

  return res.status(201).json(invoice);
});

router.patch("/:id", requirePermission("memo"), async (req, res) => {
  const { customerId, diamondIds, notes, fromDate, toDate } = req.body;
  const { data: memo, error: memoError } = await supabase
    .from("memos")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();
  if (memoError) {
    return res.status(500).json({ message: memoError.message });
  }
  if (!memo) {
    return res.status(404).json({ message: "Memo not found" });
  }
  if (memo.status !== "Open") {
    return res.status(400).json({ message: "Only open memos can be updated" });
  }

  const update = {};

  if (customerId) {
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .maybeSingle();
    if (customerError) {
      return res.status(500).json({ message: customerError.message });
    }
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }
    update.customer_id = customerId;
  }

  if (Array.isArray(diamondIds) && diamondIds.length > 0) {
    const { data: diamonds, error: diamondsError } = await supabase
      .from("diamonds")
      .select("*")
      .in("id", diamondIds);
    if (diamondsError) {
      return res.status(500).json({ message: diamondsError.message });
    }
    if ((diamonds || []).length !== diamondIds.length) {
      return res.status(400).json({ message: "Some diamonds are invalid" });
    }

    const blocked = diamonds.find(
      (d) => ["On Invoice", "Sold"].includes(d.status) && !(memo.diamond_ids || []).includes(d.id)
    );
    if (blocked) {
      return res.status(400).json({ message: `Diamond ${blocked.sku} cannot be added to memo` });
    }

    const previousIds = (memo.diamond_ids || []).map(String);
    const nextIds = diamondIds.map(String);
    const removedIds = previousIds.filter((id) => !nextIds.includes(id));
    const addedIds = nextIds.filter((id) => !previousIds.includes(id));

    if (removedIds.length > 0) {
      const { error: removedError } = await supabase
        .from("diamonds")
        .update({ status: "Available" })
        .in("id", removedIds);
      if (removedError) return res.status(500).json({ message: removedError.message });
    }
    if (addedIds.length > 0) {
      const { error: addedError } = await supabase
        .from("diamonds")
        .update({ status: "On Memo" })
        .in("id", addedIds);
      if (addedError) return res.status(500).json({ message: addedError.message });
    }

    update.diamond_ids = diamondIds;
    update.total_amount = diamonds.reduce((sum, item) => sum + Number(item.price || 0), 0);
  }

  if (notes !== undefined) {
    update.notes = notes;
  }
  if (fromDate !== undefined) {
    update.from_date = fromDate;
  }
  if (toDate !== undefined) {
    update.to_date = toDate;
  }
  const finalFrom = update.from_date || memo.from_date;
  const finalTo = update.to_date || memo.to_date;
  if (finalFrom && finalTo) {
    const dateError = validateMemoDateRange(finalFrom, finalTo);
    if (dateError) {
      return res.status(400).json({ message: dateError });
    }
  }

  const { data: updatedMemo, error: updateError } = await supabase
    .from("memos")
    .update(update)
    .eq("id", memo.id)
    .select("*")
    .single();
  if (updateError) {
    return res.status(400).json({ message: updateError.message });
  }

  const customerIds = [updatedMemo.customer_id].filter(Boolean);
  const hydratedDiamondIds = updatedMemo.diamond_ids || [];
  const customersMap = await getCustomersMap(customerIds);
  const diamondsMap = await getDiamondsMap(hydratedDiamondIds);
  return res.json(
    serializeMemo(
      updatedMemo,
      customersMap.get(updatedMemo.customer_id) || null,
      hydratedDiamondIds.map((id) => diamondsMap.get(id)).filter(Boolean)
    )
  );
});

router.delete("/:id", requirePermission("memo"), async (req, res) => {
  const { data: memo, error: memoError } = await supabase
    .from("memos")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();
  if (memoError) {
    return res.status(500).json({ message: memoError.message });
  }
  if (!memo) {
    return res.status(404).json({ message: "Memo not found" });
  }
  if (memo.status !== "Open") {
    return res.status(400).json({ message: "Only open memos can be deleted" });
  }

  const { error: diamondsError } = await supabase
    .from("diamonds")
    .update({ status: "Available" })
    .in("id", memo.diamond_ids || []);
  if (diamondsError) {
    return res.status(500).json({ message: diamondsError.message });
  }

  const { error: deleteError } = await supabase.from("memos").delete().eq("id", memo.id);
  if (deleteError) {
    return res.status(500).json({ message: deleteError.message });
  }

  return res.json({ message: "Memo deleted successfully" });
});

module.exports = router;
