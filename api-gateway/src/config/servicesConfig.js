const {
    USER_SERVICE_URL,
    INVENTORY_SERVICE_URL,
    BOOKING_SERVICE_URL,
} = require("./envConfig");

// Path-prefix → downstream service URL
//
// Order matters: app.js registers these in array order and Express matches the
// first mount that fits. /api/v1/auth/logout must therefore come BEFORE the
// public /api/v1/auth entry, or the public one swallows it.
//
// Logout is the one auth route that needs a verified JWT. The handler revokes
// the caller's own token, so it depends on the gateway decoding it and
// forwarding x-user-jti / x-user-exp — which only happens on a protected
// prefix. Left under the public prefix it 401s with "Missing gateway identity
// headers" and silently never revokes anything.
module.exports = [
    { prefix: "/api/v1/auth/logout", target: USER_SERVICE_URL,      public: false },
    { prefix: "/api/v1/auth",        target: USER_SERVICE_URL,      public: true  },
    { prefix: "/api/v1/users",       target: USER_SERVICE_URL,      public: false },
    { prefix: "/api/v1/inventory",   target: INVENTORY_SERVICE_URL, public: false },
    { prefix: "/api/v1/bookings",    target: BOOKING_SERVICE_URL,   public: false },
];
