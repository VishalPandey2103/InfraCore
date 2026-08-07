const validator = require("validator");

const validateRegister = (data) => {
    const errors = [];
    const { name, email, password } = data || {};

    if (!name || name.trim().length < 2) {
        errors.push("Name must be at least 2 characters");
    }
    if (!email || !validator.isEmail(email)) {
        errors.push("Valid email is required");
    }
    if (!password || password.length < 8) {
        errors.push("Password must be at least 8 characters");
    }

    return { valid: errors.length === 0, errors };
};

const validateLogin = (data) => {
    const errors = [];
    const { email, password } = data || {};

    if (!email || !validator.isEmail(email)) {
        errors.push("Valid email is required");
    }
    if (!password) {
        errors.push("Password is required");
    }

    return { valid: errors.length === 0, errors };
};

module.exports = { validateRegister, validateLogin };
