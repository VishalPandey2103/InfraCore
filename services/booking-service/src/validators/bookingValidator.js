const validateCreateBooking = (data) => {
    const errors = [];
    const { itemId } = data || {};

    if (!itemId) {
        errors.push("itemId is required");
    }

    return { valid: errors.length === 0, errors };
};

module.exports = { validateCreateBooking };
