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
    const allowed = ["name", "category", "department", "description", "condition"];
    const hasAny = allowed.some((k) => data && data[k] !== undefined);

    if (!hasAny) {
        errors.push("Provide at least one field to update");
    }

    return { valid: errors.length === 0, errors };
};

module.exports = { validateCreateItem, validateUpdateItem };
