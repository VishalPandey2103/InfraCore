const validateCreateItem = (data) => {
    const errors = [];
    const { name, category, department } = data || {};

    if (!name || name.trim().length < 2) {
        errors.push("Name is required (min 2 chars)");
    }
    if (!category || category.trim().length < 2) {
        errors.push("Category is required");
    }
    if (!department || department.trim().length < 2) {
        errors.push("Department is required");
    }

    return { valid: errors.length === 0, errors };
};

const validateUpdateItem = (data) => {
    const errors = [];
    // ownerId, isListed and isOnLoan must never be settable through a
    // generic update — they have dedicated flows.
    const allowed = ["name", "category", "department", "description", "condition"];

    // Strip anything outside the whitelist.
    const updates = {};
    for (const key of allowed) {
        if (data && data[key] !== undefined) {
            updates[key] = data[key];
        }
    }

    if (Object.keys(updates).length === 0) {
        errors.push("Provide at least one field to update");
    }

    return { valid: errors.length === 0, errors, updates };
};

module.exports = { validateCreateItem, validateUpdateItem };
