package com.depositin.erp.security;

import com.depositin.erp.config.AppProperties;
import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory login brute-force protection: too many failed attempts for the same
 * name+IP inside the window blocks further attempts with 429 until the window slides.
 */
@Component
public class LoginRateLimiter {

    private final AppProperties properties;
    private final Map<String, Deque<Instant>> failures = new ConcurrentHashMap<>();

    public LoginRateLimiter(AppProperties properties) {
        this.properties = properties;
    }

    public void checkAllowed(String nameKey, String clientIp) {
        String key = key(nameKey, clientIp);
        Instant cutoff = Instant.now().minus(properties.loginRateLimit().windowMinutes(), ChronoUnit.MINUTES);
        Deque<Instant> deque = failures.get(key);
        if (deque != null) {
            synchronized (deque) {
                prune(deque, cutoff);
                if (deque.size() >= properties.loginRateLimit().maxFailedAttempts()) {
                    throw com.depositin.erp.exception.ApiException.conflict(
                            com.depositin.erp.exception.ErrorCode.TOO_MANY_REQUESTS,
                            "Too many failed sign-in attempts. Please wait a few minutes and try again.");
                }
            }
        }
    }

    public void recordFailure(String nameKey, String clientIp) {
        String key = key(nameKey, clientIp);
        Instant cutoff = Instant.now().minus(properties.loginRateLimit().windowMinutes(), ChronoUnit.MINUTES);
        Deque<Instant> deque = failures.computeIfAbsent(key, k -> new ArrayDeque<>());
        synchronized (deque) {
            prune(deque, cutoff);
            deque.addLast(Instant.now());
        }
    }

    public void recordSuccess(String nameKey, String clientIp) {
        failures.remove(key(nameKey, clientIp));
    }

    private void prune(Deque<Instant> deque, Instant cutoff) {
        while (!deque.isEmpty() && deque.peekFirst().isBefore(cutoff)) {
            deque.removeFirst();
        }
    }

    private String key(String nameKey, String clientIp) {
        return (nameKey == null ? "" : nameKey) + "|" + (clientIp == null ? "" : clientIp);
    }
}
