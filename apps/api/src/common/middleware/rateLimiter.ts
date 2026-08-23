import { rateLimit } from "express-rate-limit";
import { env } from "@/common/utils/envConfig";

// No custom keyGenerator: express-rate-limit v8 rejects `req.ip` directly
// (ERR_ERL_KEY_GEN_IPV6) because a bare IPv6 address lets a user rotate within
// their /64 to bypass limits. The built-in default handles v4 and v6 correctly.
const rateLimiter = rateLimit({
	legacyHeaders: false,
	standardHeaders: true,
	limit: env.COMMON_RATE_LIMIT_MAX_REQUESTS,
	windowMs: env.COMMON_RATE_LIMIT_WINDOW_MS,
	message: "Too many requests, please try again later.",
});

export default rateLimiter;
