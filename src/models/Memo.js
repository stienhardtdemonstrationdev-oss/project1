const mongoose = require("mongoose");

const memoSchema = new mongoose.Schema(
  {
    memoNumber: { type: String, required: true, unique: true, trim: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
    diamonds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Diamond", required: true }],
    totalAmount: { type: Number, required: true, default: 0 },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    status: {
      type: String,
      enum: ["Open", "Converted", "Cancelled"],
      default: "Open"
    },
    notes: { type: String, trim: true, default: "" }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Memo", memoSchema);
