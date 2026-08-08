const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const AppError = require("../utils/appError");
const userService = require("../services/userService");
const { validateUpdateProfile, validateRoleChange } = require("../validators/userValidator");

const getMe = asyncHandler(async (req, res) => {
    const user = await userService.findById(req.user.id);
    res.json(new ApiResponse(true, "Profile fetched", user));
});

const listUsers = asyncHandler(async (req, res) => {
    const users = await userService.findAll();
    res.json(new ApiResponse(true, "Users fetched", users));
});

const getUserById = asyncHandler(async (req, res) => {
    // allow self OR admin
    if (req.user.role !== "ADMIN" && req.user.id !== req.params.id) {
        throw new AppError("Forbidden", 403);
    }
    const user = await userService.findById(req.params.id);
    res.json(new ApiResponse(true, "User fetched", user));
});

const updateMe = asyncHandler(async (req, res) => {
    const { valid, errors } = validateUpdateProfile(req.body);
    if (!valid) {
        throw new AppError(errors.join(", "), 400);
    }
    const user = await userService.updateProfile(req.user.id, req.body);
    res.json(new ApiResponse(true, "Profile updated", user));
});

const changeUserRole = asyncHandler(async (req, res) => {
    const { valid, errors } = validateRoleChange(req.body);
    if (!valid) {
        throw new AppError(errors.join(", "), 400);
    }
    const user = await userService.changeRole(req.params.id, req.body.role);
    res.json(new ApiResponse(true, "Role updated", user));
});

module.exports = { getMe, listUsers, getUserById, updateMe, changeUserRole };
