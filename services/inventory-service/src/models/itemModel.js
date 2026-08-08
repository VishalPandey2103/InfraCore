const mongoose = require("mongoose");

const itemSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        category: {
            type: String,
            required: true,
            trim: true,
        },
        department: {
            type: String,
            required: true,
            trim: true,
        },
        description: {
            type: String,
            default: "",
        },
        condition: {
            type: String,
            enum: ["NEW", "GOOD", "FAIR", "POOR"],
            default: "GOOD",
        },
        isAvailable: {
            type: Boolean,
            default: true,
        },
        createdBy: {
            type: String, // user id from JWT (kept as string, no cross-service ObjectId ref)
            required: true,
        },
    },
    { timestamps: true }
);

module.exports = mongoose.model("Item", itemSchema);
