const mongoose = require("mongoose");

const bookingSchema = new mongoose.Schema(
    {
        userId: {
            type: String, // JWT claim, kept as string (no cross-service ref)
            required: true,
        },
        itemId: {
            type: String,
            required: true,
        },
        itemName: {
            type: String, // snapshot at booking time
            required: true,
        },
        ownerId: {
            type: String, // item owner, snapshot at booking time
            required: true,
            index: true,
        },
        status: {
            type: String,
            enum: ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "RETURNED"],
            default: "PENDING",
        },
        remarks: {
            type: String,
            default: "",
        },
        approvedAt: Date,
        rejectedAt: Date,
        cancelledAt: Date,
        returnedAt: Date,
    },
    { timestamps: true }
);

module.exports = mongoose.model("Booking", bookingSchema);
