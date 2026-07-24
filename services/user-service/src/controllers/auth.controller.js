const authService = require("../services/auth.service");

const health = (req, res) => {
    res.status(200).json({
        success: true,
        message: "User Service is healthy",
    });
};

const register = async (req, res, next) => {
    try {
        const user = await authService.register(req.body);

        res.status(201).json({
            success: true,
            data: user,
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    health,
    register,
};