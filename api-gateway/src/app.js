const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const services = require("./config/servicesConfig");
const verifyJwt = require("./middlewares/jwtMiddleware");
const healthRoutes = require("./routes/healthRoutes");
const notFound = require("./middlewares/notFoundMiddleware");
const errorHandler = require("./middlewares/errorMiddleware");

const app = express();

// Health endpoint (not proxied)
app.use("/health", healthRoutes);

// Wire each service.
// Public prefixes (auth) skip JWT.
// Protected prefixes verify JWT and inject x-user-id / x-user-role.
services.forEach((svc) => {
    const proxy = createProxyMiddleware({
        target: svc.target,
        changeOrigin: true,
        on: {
            proxyReq: (proxyReq, req) => {
                if (req.user) {
                    proxyReq.setHeader("x-user-id", req.user.id);
                    proxyReq.setHeader("x-user-role", req.user.role);
                }
                // strip the raw JWT before forwarding
                proxyReq.removeHeader("authorization");
            },
        },
    });

    if (svc.public) {
        app.use(svc.prefix, proxy);
    } else {
        app.use(svc.prefix, verifyJwt, proxy);
    }
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
