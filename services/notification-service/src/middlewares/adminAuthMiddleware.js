const { ADMIN_API_SECRET } = require("../config/envConfig");

module.exports = (req, res, next) => {
    const provided = req.headers["x-admin-secret"];
    if (!provided || provided !== ADMIN_API_SECRET) {
        return res.status(401).json({ success: false, message: "Unauthorized" });
    }
    next();
};
