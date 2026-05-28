const mongoose = require("mongoose");

const permissionsSchema = new mongoose.Schema(
  {
    diamond: { type: Boolean, default: false },
    customer: { type: Boolean, default: false },
    memo: { type: Boolean, default: false },
    invoice: { type: Boolean, default: false },
    staffManagement: { type: Boolean, default: false }
  },
  { _id: false }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "staff"], default: "staff" },
    permissions: {
      type: permissionsSchema,
      default: () => ({})
    },
    isActive: { type: Boolean, default: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
