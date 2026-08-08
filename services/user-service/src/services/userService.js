const User = require("../models/userModel");
const AppError = require("../utils/appError");

const findById = async (id) => {
    const user = await User.findById(id).select("-password");
    if (!user) {
        throw new AppError("User not found", 404);
    }
    return user;
};

const findAll = async () => {
    return await User.find().select("-password");
};

const updateProfile = async (id, updates) => {
    const user = await User.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true }
    ).select("-password");

    if (!user) {
        throw new AppError("User not found", 404);
    }
    return user;
};

const changeRole = async (id, role) => {
    const user = await User.findByIdAndUpdate(
        id,
        { $set: { role } },
        { new: true }
    ).select("-password");

    if (!user) {
        throw new AppError("User not found", 404);
    }
    return user;
};

module.exports = { findById, findAll, updateProfile, changeRole };
