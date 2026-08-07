const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const AppError = require("../utils/appError");
const authService = require("../services/authService");
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

module.exports = { register, login };
