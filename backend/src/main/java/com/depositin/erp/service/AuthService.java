package com.depositin.erp.service;

import com.depositin.erp.dto.CommonDtos;
import com.depositin.erp.entity.UserAccount;
import com.depositin.erp.entity.UserRole;
import com.depositin.erp.exception.ApiException;
import com.depositin.erp.repository.UserRepository;
import com.depositin.erp.security.CurrentUser;
import com.depositin.erp.security.LoginRateLimiter;
import com.depositin.erp.security.SecurityUtils;
import com.depositin.erp.security.SessionService;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Login/logout against BCrypt password hashes and hashed cookie sessions.
 * Passwords are never stored raw and never written to logs or audit details.
 */
@Service
public class AuthService {

    private final UserRepository users;
    private final SessionService sessions;
    private final LoginRateLimiter rateLimiter;
    private final AuditService audit;
    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder(12);

    public AuthService(UserRepository users, SessionService sessions, LoginRateLimiter rateLimiter, AuditService audit) {
        this.users = users;
        this.sessions = sessions;
        this.rateLimiter = rateLimiter;
        this.audit = audit;
    }

    public PasswordEncoder passwordEncoder() {
        return passwordEncoder;
    }

    @Transactional
    public LoginResult login(CommonDtos.LoginRequest request, String clientIp, String userAgent) {
        String nameKey = SecurityUtils.normalizeName(request.username());
        rateLimiter.checkAllowed(nameKey, clientIp);

        Optional<UserAccount> found = users.findByNameNormalized(nameKey == null ? "" : nameKey);
        UserAccount user = found.orElse(null);

        boolean ok = user != null
                && user.isActive()
                && passwordEncoder.matches(request.password(), user.getPasswordHash());
        if (ok && user.getRole() == UserRole.USER && !user.isActive()) {
            ok = false;
        }

        if (!ok) {
            rateLimiter.recordFailure(nameKey, clientIp);
            if (user != null) {
                audit.record("AUTH_LOGIN_FAILED", "User", user.getId(), user, Map.of("reason", "bad_credentials"));
            }
            throw ApiException.unauthorized("Invalid name or password.");
        }

        rateLimiter.recordSuccess(nameKey, clientIp);
        String token = sessions.createSession(user, userAgent);
        audit.record("AUTH_LOGIN", "User", user.getId(), user, Map.of("role", user.getRole().name()));
        return new LoginResult(token, toAuthUser(user));
    }

    @Transactional
    public LoginResult loginByPin(CommonDtos.PinLoginRequest request, String clientIp, String userAgent) {
        String pin = request.pin().trim();
        String nameKey = "pin:" + pin;
        rateLimiter.checkAllowed(nameKey, clientIp);

        Optional<UserAccount> found = users.findByPin(pin);
        UserAccount user = found.orElse(null);

        boolean ok = user != null && user.isActive() && user.getRole() == UserRole.USER;
        if (!ok) {
            rateLimiter.recordFailure(nameKey, clientIp);
            if (user != null) {
                audit.record("AUTH_LOGIN_FAILED", "User", user.getId(), user, Map.of("reason", "bad_pin"));
            }
            throw ApiException.unauthorized("Invalid PIN.");
        }

        rateLimiter.recordSuccess(nameKey, clientIp);
        String token = sessions.createSession(user, userAgent);
        audit.record("AUTH_LOGIN", "User", user.getId(), user, Map.of("role", user.getRole().name(), "method", "pin"));
        return new LoginResult(token, toAuthUser(user));
    }

    @Transactional
    public void changePassword(Long userId, CommonDtos.ChangePasswordRequest request) {
        UserAccount user = users.findById(userId).orElseThrow(() -> ApiException.unauthorized("You must be signed in."));
        if (!passwordEncoder.matches(request.currentPassword(), user.getPasswordHash())) {
            throw ApiException.unauthorized("Current password is incorrect.");
        }
        if (!request.newPassword().equals(request.confirmPassword())) {
            throw ApiException.validation("Passwords do not match.", List.of(new ApiException.FieldError("confirmPassword", "Passwords do not match.")));
        }
        if (request.newPassword().length() < 6) {
            throw ApiException.validation("Password too weak.", List.of(new ApiException.FieldError("newPassword", "Use at least 6 characters.")));
        }
        user.setPasswordHash(passwordEncoder.encode(request.newPassword()));
        users.save(user);
        audit.record("ADMIN_PASSWORD_CHANGED", "User", user.getId(), user, Map.of());
    }

    @Transactional
    public void logout(String rawToken, CurrentUser currentUser) {
        sessions.destroy(rawToken);
        if (currentUser != null) {
            UserAccount actor = users.findById(currentUser.id()).orElse(null);
            audit.record("AUTH_LOGOUT", "User", currentUser.id(), actor, Map.of());
        }
    }

    public CommonDtos.AuthUser toAuthUser(UserAccount user) {
        Long accountId = user.getRole() == UserRole.USER ? user.getId() : null;
        return new CommonDtos.AuthUser(user.getId(), user.getName(), user.getRole().name(), accountId, user.getName());
    }

    public record LoginResult(String token, CommonDtos.AuthUser user) {
    }
}
