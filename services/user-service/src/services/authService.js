const User = require("../models/userModel");
const comparePassword = require("../utils/comparePassword");
const generateToken = require("../utils/generateToken");

// ...

const login = async ({ email, password }) => {
    const user = await User.findOne({ email });

    if (!user) {
        throw new Error("Invalid email or password");
    }

    const isMatch = await comparePassword(password, user.password);

    if (!isMatch) {
        throw new Error("Invalid email or password");
    }

    const token = generateToken({
        id: user._id,
        role: user.role,
    });

    return {
        user,
        token,
    };
};

module.exports = {
    login,
};