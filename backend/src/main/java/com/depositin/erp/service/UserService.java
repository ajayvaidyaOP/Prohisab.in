package com.depositin.erp.service;

import com.depositin.erp.dto.AccountDtos;
import com.depositin.erp.entity.UserAccount;
import com.depositin.erp.entity.UserRole;
import com.depositin.erp.entity.Book;
import com.depositin.erp.repository.BookRepository;
import com.depositin.erp.exception.ApiException;
import com.depositin.erp.exception.ErrorCode;
import com.depositin.erp.repository.UserRepository;
import com.depositin.erp.security.SessionService;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * User account management. Admin creates users with Name + Password only.
 * Login names are case-insensitively unique. Users cannot change their own
 * password - only an admin can reset it.
 */
@Service
public class UserService {

    private final UserRepository users;
    private final AuthService auth;
    private final AuditService audit;
    private final LedgerService ledger;
    private final SessionService sessions;
    private final BookRepository books;

    public UserService(UserRepository users, AuthService auth, AuditService audit,
                       LedgerService ledger, SessionService sessions, BookRepository books) {
        this.users = users;
        this.books = books;
        this.auth = auth;
        this.audit = audit;
        this.ledger = ledger;
        this.sessions = sessions;
    }

    @Transactional
    public AccountDtos.AccountSummary create(AccountDtos.CreateAccountRequest request, UserAccount actor) {
        String name = request.name().trim();
        String normalized = UserAccount.normalizeName(name);
        if (users.existsByNameNormalized(normalized)) {
            throw ApiException.conflict(ErrorCode.DUPLICATE_RECORD,
                    "A user with this name already exists. Choose a different name.");
        }
        if (isWeakPassword(request.password())) {
            throw ApiException.unprocessable(ErrorCode.PASSWORD_TOO_WEAK,
                    "Password must be at least 6 characters and contain letters and numbers.",
                    java.util.List.of(new ApiException.FieldError("password", "Use at least 6 characters with letters and numbers.")));
        }

        UserAccount user = new UserAccount();
        user.setName(name);
        user.setNameNormalized(normalized);
        user.setPasswordHash(auth.passwordEncoder().encode(request.password()));
        if (request.pin() != null && !request.pin().isBlank()) {
            user.setPin(request.pin().trim());
        }
        user.setRole(UserRole.USER);
        user.setAccountCode("USR-" + String.format("%06d", 1)); // provisional; replaced below
        user.setActive(true);
        try {
            user = users.save(user);
        } catch (DataIntegrityViolationException e) {
            throw ApiException.conflict(ErrorCode.DUPLICATE_RECORD,
                    "A user with this name already exists. Choose a different name.");
        }
        user.setAccountCode("USR-" + String.format("%06d", user.getId()));
        user = users.save(user);

        audit.record("USER_CREATED", "User", user.getId(), actor, Map.of("name", user.getName(), "role", user.getRole().name()));
        return ledger.summarize(user);
    }

    @Transactional
    public AccountDtos.AccountSummary update(Long id, AccountDtos.UpdateAccountRequest request, UserAccount actor) {
        UserAccount user = requireUser(id);
        Map<String, Object> changes = new HashMap<>();
        if (request.name() != null && !request.name().isBlank()) {
            String name = request.name().trim();
            if (!name.equals(user.getName())) {
                if (users.existsByNameNormalizedAndIdNot(UserAccount.normalizeName(name), id)) {
                    throw ApiException.conflict(ErrorCode.DUPLICATE_RECORD,
                            "A user with this name already exists. Choose a different name.");
                }
                changes.put("name", Map.of("from", user.getName(), "to", name));
                user.setName(name);
            }
        }
        if (request.phone() != null) {
            changes.put("phone", request.phone());
            user.setPhone(emptyToNull(request.phone()));
        }
        if (request.email() != null) {
            changes.put("email", request.email());
            user.setEmail(emptyToNull(request.email()));
        }
        if (request.address() != null) {
            changes.put("address", request.address());
            user.setAddress(emptyToNull(request.address()));
        }
        if (request.notes() != null) {
            changes.put("notes", request.notes());
            user.setNotes(emptyToNull(request.notes()));
        }
        users.save(user);
        audit.record("USER_UPDATED", "User", id, actor, Map.of("changes", changes));
        return ledger.summarize(user);
    }

    @Transactional
    public AccountDtos.AccountSummary setStatus(Long id, boolean active, UserAccount actor) {
        UserAccount user = requireUser(id);
        if (!active && user.getRole() == UserRole.ADMIN) {
            throw ApiException.conflict(ErrorCode.CONFLICT, "The administrator account cannot be deactivated.");
        }
        user.setActive(active);
        users.save(user);
        if (!active) {
            // Sign the user out everywhere when deactivated.
            sessions.destroyAllForUser(user.getId(), null);
        }
        audit.record(active ? "USER_ACTIVATED" : "USER_DEACTIVATED", "User", id, actor, Map.of("name", user.getName()));
        return ledger.summarize(user);
    }

    /**
     * Admin password reset. The new password takes effect immediately and every
     * existing session of that user is revoked. The password value is never logged.
     */
    @Transactional
    public void resetPassword(Long id, AccountDtos.ResetPasswordRequest request, UserAccount actor) {
        UserAccount user = requireUser(id);
        if (request.newPassword() == null || !request.newPassword().equals(request.confirmPassword())) {
            throw ApiException.validation("Please correct the highlighted fields.",
                    java.util.List.of(new ApiException.FieldError("confirmPassword", "Passwords do not match.")));
        }
        if (isWeakPassword(request.newPassword())) {
            throw ApiException.unprocessable(ErrorCode.PASSWORD_TOO_WEAK,
                    "Password must be at least 6 characters and contain letters and numbers.",
                    java.util.List.of(new ApiException.FieldError("newPassword", "Use at least 6 characters with letters and numbers.")));
        }
        user.setPasswordHash(auth.passwordEncoder().encode(request.newPassword()));
        users.save(user);
        sessions.destroyAllForUser(user.getId(), null);
        audit.record("PASSWORD_RESET", "User", id, actor, Map.of("targetUser", user.getName()));
    }

    @Transactional(readOnly = true)
    @Transactional
    public AccountDtos.AccountSummary setAllowedBooks(Long id, List<Long> bookIds, UserAccount actor) {
        UserAccount user = requireUser(id);
        user.getAllowedBooks().clear();
        if (bookIds != null) {
            for (Long bid : bookIds) {
                books.findById(bid).ifPresent(user.getAllowedBooks()::add);
            }
        }
        users.save(user);
        audit.record("USER_BOOKS_UPDATED", "User", user.getId(), actor, Map.of("bookIds", bookIds == null ? List.of() : bookIds));
        return ledger.summarize(user);
    }

    @Transactional
    public AccountDtos.AccountSummary setBackDateEntry(Long id, boolean allowed, UserAccount actor) {
        UserAccount user = requireUser(id);
        user.setBackDateEntry(allowed);
        users.save(user);
        audit.record("USER_BACKDATE_UPDATED", "User", user.getId(), actor, Map.of("allowed", allowed));
        return ledger.summarize(user);
    }

    public UserAccount requireUser(Long id) {
        return users.findById(id).orElseThrow(() -> ApiException.notFound("User account not found."));
    }

    private boolean isWeakPassword(String password) {
        if (password == null || password.length() < 6) {
            return true;
        }
        boolean hasLetter = password.chars().anyMatch(Character::isLetter);
        boolean hasDigit = password.chars().anyMatch(Character::isDigit);
        return !hasLetter || !hasDigit;
    }

    private static String emptyToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
