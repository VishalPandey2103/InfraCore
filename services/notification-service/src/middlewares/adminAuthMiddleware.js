const { ADMIN_API_SECRET } = require("../config/envConfig");

// Shared-secret guard for /admin routes. Not user-scoped auth — this is meant
// for ops tooling / CLI scripts. In production you would replace this with
// mTLS or a service-account JWT.
module.exports = (req, res, next) => {
    const provided = req.headers["x-admin-secret"];
    if (!provided || provided !== ADMIN_API_SECRET) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    next();
};
