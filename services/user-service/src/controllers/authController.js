const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const AppError = require("../utils/appError");
const authService = require("../services/authService");
const tokenBlacklist = require("../services/tokenBlacklistService");
const { validateRegister, validateLogin } = require("../validators/authValidator");

const register = asyncHandler(async (req, res) => {
    const { valid, errors } = validateRegister(req.body);
    if (!valid) {
        throw new AppError(errors.join(", "), 400);
    }

    const result = await authService.register(req.body);
    res.status(201).json(new ApiResponse(true, "Registered successfully", result));
});

const login = asyncHandler(async (req, res) => {
    const { valid, errors } = validateLogin(req.body);
    if (!valid) {
        throw new AppError(errors.join(", "), 400);
    }

    const result = await authService.login(req.body);
    res.status(200).json(new ApiResponse(true, "Login successful", result));
});

// Logout: revoke the current token by adding its jti to Redis until it would
// have expired naturally.
//
// A twist for our setup: the gateway strips the Authorization header before
// forwarding, so this handler cannot read the raw token from req. Two ways
// to solve this cleanly:
//   1. Have the gateway forward the jti in an `x-user-jti` header (what we do)
//   2. Have the client POST the token in the request body
// Option 1 keeps the client API clean and treats logout as any other
// authenticated action.
const logout = asyncHandler(async (req, res) => {
    const jti = req.headers["x-user-jti"];
    const exp = parseInt(req.headers["x-user-exp"] || "0", 10);

    if (!jti) {
        throw new AppError("Missing token identifier", 400);
    }

    await tokenBlacklist.revoke(jti, exp, "user-logout");
    res.json(new ApiResponse(true, "Logged out"));
});

module.exports = { register, login, logout };
