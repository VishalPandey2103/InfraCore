const health = (req, res) => {
    res.status(200).json({
        success: true,
        message: "API Gateway is healthy",
    });
};

module.exports = { health };
