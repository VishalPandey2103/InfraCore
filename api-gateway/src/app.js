const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");

const services = require("./config/servicesConfig");
const verifyJwt = require("./middlewares/jwtMiddleware");
const { authRateLimit, userRateLimit } = require("./middlewares/rateLimitMiddleware");
const healthRoutes = require("./routes/healthRoutes");
const notFound = require("./middlewares/notFoundMiddleware");
const errorHandler = require("./middlewares/errorMiddleware");

const app = express();

// Trust the first proxy in front of us so req.ip reflects the real client IP.
// Rate limiting for auth endpoints keys on req.ip; without this every request
// would share the loopback address of the fronting proxy.
app.set("trust proxy", 1);

// Health endpoint (not proxied, not rate limited — used by liveness probes)
app.use("/health", healthRoutes);

// Wire each service.
// Public prefixes (auth) skip JWT but get a strict IP-based rate limit.
// Protected prefixes verify JWT then apply a user-scoped rate limit.
services.forEach((svc) => {
    const proxy = createProxyMiddleware({
        target: svc.target,
        changeOrigin: true,
        // app.use(prefix, ...) strips the prefix from req.url, but the
        // downstream services mount their routers at the full /api/v1/... path.
        // Put the prefix back before forwarding.
        pathRewrite: (path) => `${svc.prefix}${path}`,
        on: {
            proxyReq: (proxyReq, req) => {
                if (req.user) {
                    proxyReq.setHeader("x-user-id", req.user.id);
                    proxyReq.setHeader("x-user-role", req.user.role);
                    // jti + exp so the user-service /logout can revoke this
                    // exact token without needing the raw JWT (which we strip).
                    if (req.user.jti) proxyReq.setHeader("x-user-jti", req.user.jti);
                    if (req.user.exp) proxyReq.setHeader("x-user-exp", String(req.user.exp));
                }
                // strip the raw JWT before forwarding
                proxyReq.removeHeader("authorization");
                // never let external callers reach internal service-to-service
                // endpoints (e.g. inventory's /loan) by forging the secret header
                proxyReq.removeHeader("x-internal-secret");
            },
        },
    });

    if (svc.public) {
        // Public route ordering: rate limit BEFORE proxy so we reject 429 at
        // the edge without burning a downstream request.
        app.use(svc.prefix, authRateLimit, proxy);
    } else {
        // Protected route ordering: verifyJwt first (so req.user is populated),
        // then userRateLimit (which keys on req.user.id), then proxy.
        app.use(svc.prefix, verifyJwt, userRateLimit, proxy);
    }
});

app.use(notFound);
app.use(errorHandler);

module.exports = app;
