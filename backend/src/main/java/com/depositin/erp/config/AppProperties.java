package com.depositin.erp.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Application configuration bound from {@code app.*} in application.yml.
 */
@ConfigurationProperties(prefix = "app")
public record AppProperties(
        Session session,
        Cookie cookie,
        String timezone,
        LoginRateLimit loginRateLimit,
        boolean trustProxy,
        String allowedOrigins
) {

    public record Session(String cookieName, int idleTimeoutMinutes, int maxHours) {
    }

    public record Cookie(boolean secure, String sameSite) {
    }

    public record LoginRateLimit(int maxFailedAttempts, int windowMinutes) {
    }

    public String cookieName() {
        return session.cookieName() == null || session.cookieName().isBlank() ? "erp_session" : session.cookieName();
    }
}
