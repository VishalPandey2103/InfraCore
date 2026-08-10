const axios = require("axios");
const AppError = require("../utils/appError");
const { INVENTORY_SERVICE_URL } = require("../config/envConfig");

// Forward the caller's identity when calling inventory-service.
// Inventory-service trusts x-user-id and x-user-role headers.
const buildHeaders = (userId, userRole) => ({
    "x-user-id": userId,
    "x-user-role": userRole,
});

const getItem = async (itemId, userId, userRole) => {
    try {
        const response = await axios.get(
            `${INVENTORY_SERVICE_URL}/api/v1/inventory/${itemId}`,
            { headers: buildHeaders(userId, userRole) }
        );
        return response.data.data;
    } catch (error) {
        if (error.response && error.response.status === 404) {
            throw new AppError("Item not found", 404);
        }
        throw new AppError("Inventory service unavailable", 503);
    }
};

const setItemAvailability = async (itemId, isAvailable, userId, userRole) => {
    try {
        await axios.patch(
            `${INVENTORY_SERVICE_URL}/api/v1/inventory/${itemId}/availability`,
            { isAvailable },
            { headers: buildHeaders(userId, userRole) }
        );
    } catch (error) {
        throw new AppError("Failed to update item availability", 503);
    }
};

module.exports = { getItem, setItemAvailability };
