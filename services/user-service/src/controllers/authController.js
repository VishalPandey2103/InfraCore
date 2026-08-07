const asyncHandler = require("../utils/asyncHandler");
const ApiResponse = require("../utils/apiResponse");
const authService = require("../services/authService");

const login = asyncHandler(async (req, res) => {
    const result = await authService.login(req.body);

    res.status(200).json(
        new ApiResponse(true, "Login successful", result)
    );
});

module.exports = {
    login,
};