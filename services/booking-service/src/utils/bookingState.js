// Legal state transitions for a booking.
const transitions = {
    PENDING: ["APPROVED", "REJECTED", "CANCELLED"],
    APPROVED: ["RETURNED"],
    REJECTED: [],
    CANCELLED: [],
    RETURNED: [],
};

const canTransition = (from, to) => {
    return transitions[from] && transitions[from].includes(to);
};

module.exports = { canTransition };
