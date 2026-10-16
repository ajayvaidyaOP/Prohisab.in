package com.depositin.erp.security;

import com.depositin.erp.config.AppProperties;
import com.depositin.erp.entity.UserRole;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

/** Helpers for the current security context. */
public final class SecurityUtils {

    private SecurityUtils() {
    }

    public static CurrentUser currentUser() {
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        if (auth != null && auth.getPrincipal() instanceof CurrentUser cu) {
            return cu;
        }
        return null;
    }

    public static CurrentUser requireUser() {
        CurrentUser cu = currentUser();
        if (cu == null) {
            throw com.depositin.erp.exception.ApiException.unauthorized("You must be signed in.");
        }
        return cu;
    }

    public static CurrentUser requireAdmin() {
        CurrentUser cu = requireUser();
        if (cu.role() != UserRole.ADMIN) {
            throw com.depositin.erp.exception.ApiException.forbidden("This action is available to administrators only.");
        }
        return cu;
    }

    /** Normalizes a name exactly like the entity does (trim + lower case). */
    public static String normalizeName(String name) {
        return name == null ? null : name.trim().toLowerCase();
    }
}
