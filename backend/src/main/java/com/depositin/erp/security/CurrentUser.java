package com.depositin.erp.security;

import com.depositin.erp.entity.UserRole;

/** Authenticated principal for the current request. */
public record CurrentUser(Long id, String name, UserRole role) {

    /** Ledger account id for USER accounts (the account is the user). */
    public Long accountId() {
        return role == UserRole.USER ? id : null;
    }

    public boolean isAdmin() {
        return role == UserRole.ADMIN;
    }
}
