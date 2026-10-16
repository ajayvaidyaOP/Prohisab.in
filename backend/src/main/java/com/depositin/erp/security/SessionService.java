package com.depositin.erp.security;

import com.depositin.erp.config.AppProperties;
import com.depositin.erp.entity.UserAccount;
import com.depositin.erp.entity.UserSession;
import com.depositin.erp.repository.UserSessionRepository;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Optional;

/**
 * Cookie-based session management. The raw token only ever exists in the client's
 * HttpOnly cookie; the database stores the SHA-256 hash of the token.
 */
@Service
public class SessionService {

    private static final SecureRandom RANDOM = new SecureRandom();

    private final UserSessionRepository sessions;
    private final AppProperties properties;

    public SessionService(UserSessionRepository sessions, AppProperties properties) {
        this.sessions = sessions;
        this.properties = properties;
    }

    /** Creates a new session and returns the raw token to put in the cookie. */
    @Transactional
    public String createSession(UserAccount user, String userAgent) {
        String token = generateToken();
        Instant now = Instant.now();
        UserSession session = new UserSession();
        session.setId(sha256Hex(token));
        session.setUser(user);
        session.setCreatedAt(now);
        session.setLastSeenAt(now);
        session.setExpiresAt(now.plus(Duration.ofHours(properties.session().maxHours())));
        session.setUserAgent(userAgent == null ? null : truncate(userAgent, 255));
        sessions.deleteExpired(now);
        sessions.save(session);
        return token;
    }

    /**
     * Resolves the cookie token to a live session, enforcing idle and hard timeouts.
     * Returns empty when the session is missing or expired (and deletes expired rows).
     */
    @Transactional
    public Optional<UserAccount> resolve(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) {
            return Optional.empty();
        }
        Instant now = Instant.now();
        String id = sha256Hex(rawToken);
        Optional<UserSession> found = sessions.findById(id);
        if (found.isEmpty()) {
            return Optional.empty();
        }
        UserSession session = found.get();
        if (session.getExpiresAt().isBefore(now)) {
            sessions.delete(session);
            return Optional.empty();
        }
        Duration idle = Duration.ofMinutes(properties.session().idleTimeoutMinutes());
        if (session.getLastSeenAt().plus(idle).isBefore(now)) {
            sessions.delete(session);
            return Optional.empty();
        }
        if (session.getLastSeenAt().plusSeconds(60).isBefore(now)) {
            session.setLastSeenAt(now);
            sessions.save(session);
        }
        return Optional.of(session.getUser());
    }

    @Transactional
    public void destroy(String rawToken) {
        if (rawToken == null || rawToken.isBlank()) {
            return;
        }
        sessions.deleteById(sha256Hex(rawToken));
    }

    @Transactional
    public void destroyAllForUser(Long userId, String keepRawToken) {
        if (keepRawToken == null || keepRawToken.isBlank()) {
            sessions.deleteAllForUser(userId);
        } else {
            sessions.deleteAllForUserExcept(userId, sha256Hex(keepRawToken));
        }
    }

    public void writeCookie(HttpServletResponse response, String rawToken) {
        Cookie cookie = new Cookie(properties.cookieName(), rawToken == null ? "" : rawToken);
        cookie.setHttpOnly(true);
        cookie.setSecure(properties.cookie().secure());
        cookie.setPath("/");
        cookie.setMaxAge(rawToken == null ? 0 : properties.session().maxHours() * 3600);
        response.addHeader("Set-Cookie", buildSetCookie(cookie));
    }

    public String readCookie(HttpServletRequest request) {
        Cookie[] cookies = request.getCookies();
        if (cookies == null) {
            return null;
        }
        String name = properties.cookieName();
        for (Cookie cookie : cookies) {
            if (name.equals(cookie.getName())) {
                return cookie.getValue();
            }
        }
        return null;
    }

    private String buildSetCookie(Cookie cookie) {
        StringBuilder sb = new StringBuilder();
        sb.append(cookie.getName()).append('=').append(cookie.getValue() == null ? "" : cookie.getValue());
        sb.append("; Path=").append(cookie.getPath() == null ? "/" : cookie.getPath());
        if (cookie.getMaxAge() >= 0) {
            sb.append("; Max-Age=").append(cookie.getMaxAge());
        }
        if (cookie.isHttpOnly()) {
            sb.append("; HttpOnly");
        }
        if (cookie.getSecure()) {
            sb.append("; Secure");
        }
        String sameSite = properties.cookie().sameSite();
        if (sameSite != null && !sameSite.isBlank()) {
            sb.append("; SameSite=").append(Character.toUpperCase(sameSite.charAt(0))).append(sameSite.substring(1).toLowerCase());
        }
        return sb.toString();
    }

    public static String generateToken() {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }

    public static String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }

    private static String truncate(String value, int max) {
        return value.length() <= max ? value : value.substring(0, max);
    }
}
