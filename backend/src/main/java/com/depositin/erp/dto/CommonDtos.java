package com.depositin.erp.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/** Shared pagination envelope. */
public final class CommonDtos {

    private CommonDtos() {
    }

    public record Pagination(int page, int pageSize, long total, int totalPages) {
    }

    public record LoginRequest(
            @NotBlank(message = "Enter your name.") @Size(max = 150) String username,
            @NotBlank(message = "Enter your password.") @Size(max = 100) String password) {
    }

    public record AuthUser(Long id, String username, String role, Long accountId, String name) {
    }

    public record AuthUserResponse(AuthUser user) {
    }

    public record ErrorOnly(String message) {
    }
}
