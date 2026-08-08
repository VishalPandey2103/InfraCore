const {
    USER_SERVICE_URL,
    INVENTORY_SERVICE_URL,
    BOOKING_SERVICE_URL,
} = require("./envConfig");

// Path-prefix → downstream service URL
module.exports = [
    { prefix: "/api/v1/auth",      target: USER_SERVICE_URL,      public: true  },
    { prefix: "/api/v1/users",     target: USER_SERVICE_URL,      public: false },
    { prefix: "/api/v1/inventory", target: INVENTORY_SERVICE_URL, public: false },
    { prefix: "/api/v1/bookings",  target: BOOKING_SERVICE_URL,   public: false },
];
