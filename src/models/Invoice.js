const mongoose = require("mongoose");

const invoiceSchema = new mongoose.Schema(
  {
    invoiceNumber: { type: String, required: true, unique: true, trim: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    diamonds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Diamond", required: true }],
    memo: { type: mongoose.Schema.Types.ObjectId, ref: "Memo", default: null },
    totalAmount: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      enum: ["Draft", "Finalized"],
      default: "Draft"
    },
    notes: { type: String, trim: true, default: "" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Invoice", invoiceSchema);
