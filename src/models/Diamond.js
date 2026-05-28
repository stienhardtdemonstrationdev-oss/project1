const mongoose = require("mongoose");

const diamondSchema = new mongoose.Schema(
  {
    sku: { type: String, required: true, unique: true, trim: true },
    shape: { type: String, required: true, trim: true },
    carat: { type: Number, required: true },
    color: { type: String, required: true, trim: true },
    clarity: { type: String, required: true, trim: true },
    price: { type: Number, required: true },
    status: {
      type: String,
      enum: ["Added", "Available", "On Memo", "On Invoice", "Sold", "On Hold"],
      default: "Added"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Diamond", diamondSchema);
