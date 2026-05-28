const express = require("express");
const { supabase } = require("../lib/supabase");
const { ensureAuth, requirePermission } = require("../middleware/auth");

const router = express.Router();

function createInvoiceNumber() {
  return `INV-${Date.now()}`;
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

function serializeInvoice(row, customer = null, diamonds = null) {
  return {
    _id: row.id,
    id: row.id,
    invoiceNumber: row.invoice_number,
    customer: customer ? { ...customer, _id: customer.id } : row.customer || null,
    diamonds: (diamonds || row.diamonds || []).map((d) => ({ ...d, _id: d.id })),
    memo: row.memo || null,
    totalAmount: row.total_amount,
    status: row.status,
    notes: row.notes || ""
  };
}

router.use(ensureAuth, requirePermission("invoice"));

router.get("/", async (req, res) => {
  const { data: invoices, error } = await supabase
    .from("invoices")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return res.status(500).json({ message: error.message });

  const customerIds = [...new Set((invoices || []).map((i) => i.customer_id).filter(Boolean))];
  const diamondIds = [...new Set((invoices || []).flatMap((i) => i.diamond_ids || []))];
  const customersMap = await getCustomersMap(customerIds);
  const diamondsMap = await getDiamondsMap(diamondIds);

  const hydrated = (invoices || []).map((invoice) =>
    serializeInvoice(
      invoice,
      customersMap.get(invoice.customer_id) || null,
      (invoice.diamond_ids || []).map((id) => diamondsMap.get(id)).filter(Boolean)
    )
  );
  return res.json(hydrated);
});

router.post("/", async (req, res) => {
  const { customerId, diamondIds, notes } = req.body;
  if (!customerId || !Array.isArray(diamondIds) || diamondIds.length === 0) {
    return res.status(400).json({ message: "customerId and diamondIds are required" });
  }

  const { data: customer, error: customerError } = await supabase
    .from("customers")
    .select("*")
    .eq("id", customerId)
    .maybeSingle();
  if (customerError) return res.status(500).json({ message: customerError.message });
  if (!customer) {
    return res.status(404).json({ message: "Customer not found" });
  }

  const { data: diamonds, error: diamondsError } = await supabase
    .from("diamonds")
    .select("*")
    .in("id", diamondIds);
  if (diamondsError) return res.status(500).json({ message: diamondsError.message });
  if ((diamonds || []).length !== diamondIds.length) {
    return res.status(400).json({ message: "Some diamonds are invalid" });
  }

  const blocked = diamonds.find((d) => d.status === "Sold");
  if (blocked) {
    return res.status(400).json({ message: `Diamond ${blocked.sku} already sold` });
  }

  const totalAmount = diamonds.reduce((sum, item) => sum + Number(item.price || 0), 0);

  const { data: invoice, error: createError } = await supabase
    .from("invoices")
    .insert({
      invoice_number: createInvoiceNumber(),
      customer_id: customerId,
      diamond_ids: diamondIds,
      total_amount: totalAmount,
      notes,
      status: "Draft"
    })
    .select("*")
    .single();
  if (createError) return res.status(400).json({ message: createError.message });

  const { error: statusError } = await supabase
    .from("diamonds")
    .update({ status: "On Invoice" })
    .in("id", diamondIds);
  if (statusError) return res.status(500).json({ message: statusError.message });

  return res.status(201).json(serializeInvoice(invoice, customer, diamonds || []));
});

router.post("/:id/finalize", async (req, res) => {
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();
  if (invoiceError) return res.status(500).json({ message: invoiceError.message });
  if (!invoice) {
    return res.status(404).json({ message: "Invoice not found" });
  }
  if (invoice.status === "Finalized") {
    return res.status(400).json({ message: "Invoice already finalized" });
  }

  const { data: finalized, error: finalizeError } = await supabase
    .from("invoices")
    .update({ status: "Finalized" })
    .eq("id", invoice.id)
    .select("*")
    .single();
  if (finalizeError) return res.status(500).json({ message: finalizeError.message });

  const { error: soldError } = await supabase
    .from("diamonds")
    .update({ status: "Sold" })
    .in("id", invoice.diamond_ids || []);
  if (soldError) return res.status(500).json({ message: soldError.message });

  const customersMap = await getCustomersMap([finalized.customer_id].filter(Boolean));
  const diamondsMap = await getDiamondsMap(finalized.diamond_ids || []);
  return res.json(
    serializeInvoice(
      finalized,
      customersMap.get(finalized.customer_id) || null,
      (finalized.diamond_ids || []).map((id) => diamondsMap.get(id)).filter(Boolean)
    )
  );
});

router.patch("/:id", async (req, res) => {
  const { customerId, diamondIds, notes } = req.body;
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();
  if (invoiceError) return res.status(500).json({ message: invoiceError.message });
  if (!invoice) {
    return res.status(404).json({ message: "Invoice not found" });
  }
  if (invoice.status === "Finalized") {
    return res.status(400).json({ message: "Finalized invoice cannot be updated" });
  }

  const update = {};
  if (customerId) {
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .select("id")
      .eq("id", customerId)
      .maybeSingle();
    if (customerError) return res.status(500).json({ message: customerError.message });
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
    if (diamondsError) return res.status(500).json({ message: diamondsError.message });
    if ((diamonds || []).length !== diamondIds.length) {
      return res.status(400).json({ message: "Some diamonds are invalid" });
    }

    const blocked = diamonds.find(
      (d) => d.status === "Sold" && !(invoice.diamond_ids || []).includes(d.id)
    );
    if (blocked) {
      return res.status(400).json({ message: `Diamond ${blocked.sku} already sold` });
    }

    const previousIds = (invoice.diamond_ids || []).map(String);
    const nextIds = diamondIds.map((id) => String(id));

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
        .update({ status: "On Invoice" })
        .in("id", addedIds);
      if (addedError) return res.status(500).json({ message: addedError.message });
    }

    update.diamond_ids = diamondIds;
    update.total_amount = diamonds.reduce((sum, item) => sum + Number(item.price || 0), 0);
  }

  if (notes !== undefined) {
    update.notes = notes;
  }

  const { data: updatedInvoice, error: updateError } = await supabase
    .from("invoices")
    .update(update)
    .eq("id", invoice.id)
    .select("*")
    .single();
  if (updateError) return res.status(400).json({ message: updateError.message });

  const customersMap = await getCustomersMap([updatedInvoice.customer_id].filter(Boolean));
  const diamondsMap = await getDiamondsMap(updatedInvoice.diamond_ids || []);
  return res.json(
    serializeInvoice(
      updatedInvoice,
      customersMap.get(updatedInvoice.customer_id) || null,
      (updatedInvoice.diamond_ids || []).map((id) => diamondsMap.get(id)).filter(Boolean)
    )
  );
});

router.delete("/:id", async (req, res) => {
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("*")
    .eq("id", req.params.id)
    .maybeSingle();
  if (invoiceError) return res.status(500).json({ message: invoiceError.message });
  if (!invoice) {
    return res.status(404).json({ message: "Invoice not found" });
  }
  if (invoice.status === "Finalized") {
    return res.status(400).json({ message: "Finalized invoice cannot be deleted" });
  }

  const { error: diamondsError } = await supabase
    .from("diamonds")
    .update({ status: "Available" })
    .in("id", invoice.diamond_ids || []);
  if (diamondsError) return res.status(500).json({ message: diamondsError.message });

  const { error: deleteError } = await supabase.from("invoices").delete().eq("id", invoice.id);
  if (deleteError) return res.status(500).json({ message: deleteError.message });

  return res.json({ message: "Invoice deleted successfully" });
});

module.exports = router;
