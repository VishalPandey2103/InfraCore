const validator = require("validator");

const validateUpdateProfile = (data) => {
    const errors = [];
    const { name, email } = data || {};

    if (name === undefined && email === undefined) {
        errors.push("Provide name or email to update");
    }
    if (name !== undefined && name.trim().length < 2) {
        errors.push("Name must be at least 2 characters");
    }
    if (email !== undefined && !validator.isEmail(email)) {
        errors.push("Valid email is required");
    }

    return { valid: errors.length === 0, errors };
};

const validateRoleChange = (data) => {
    const errors = [];
    const { role } = data || {};
    const allowed = ["STUDENT", "RESOURCE_MANAGER", "ADMIN"];

    if (!role || !allowed.includes(role)) {
        errors.push(`Role must be one of: ${allowed.join(", ")}`);
    }

    return { valid: errors.length === 0, errors };
};

module.exports = { validateUpdateProfile, validateRoleChange };
