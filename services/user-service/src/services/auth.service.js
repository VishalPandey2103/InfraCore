const User = require("../models/user.model");
const hashPassword = require("../utils/hashPassword");

const register = async ({ name, email, password, role }) => {
    const existingUser = await User.findOne({ email });

    if (existingUser) {
        throw new Error("User already exists");
    }

    const hashedPassword = await hashPassword(password);

    const user = await User.create({
        name,
        email,
        password: hashedPassword,
        role,
    });

    return user;
};

module.exports = {
    register,
};