const User = require("../models/userModel");
const AppError = require("../utils/appError");
const hashPassword = require("../utils/hashPassword");
const comparePassword = require("../utils/comparePassword");
const generateToken = require("../utils/generateToken");

const register = async ({ name, email, password }) => {
    const existing = await User.findOne({ email });
    if (existing) {
        throw new AppError("Email already registered", 409);
    }

    const hashed = await hashPassword(password);

    const user = await User.create({
        name,
        email,
        password: hashed,
        role: "STUDENT",
    });

    const token = generateToken({ id: user._id, role: user.role });

    return {
        user: {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
        },
        token,
    };
};

const login = async ({ email, password }) => {
    const user = await User.findOne({ email });
    if (!user) {
        throw new AppError("Invalid email or password", 401);
    }

    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
        throw new AppError("Invalid email or password", 401);
    }

    const token = generateToken({ id: user._id, role: user.role });

    return {
        user: {
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
        },
        token,
    };
};

module.exports = { register, login };
