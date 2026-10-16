package com.depositin.erp.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.util.List;

/** Account (ledger user) request/response shapes. */
public final class AccountDtos {

    private AccountDtos() {
    }

    public record Balance(String amount, String side, String status) {
    }

    public record Balances(String receivable, String payable) {
    }

    /** Full account summary. Field names are kept compatible with the React frontend. */
    public record AccountSummary(
            Long id,
            String accountCode,
            String name,
            String username,
            boolean hasLogin,
            String type,
            String typeLabel,
            String phone,
            String email,
            String address,
            String notes,
            String openingBalance,
            String openingBalanceSide,
            String normalSide,
            String totalCredited,
            String totalPaid,
            String totalUserPaid,
            String totalAdminPaid,
            String pendingBalance,
            long pendingSubmissionsCount,
            String pendingSubmissionsAmount,
            Balance balance,
            Balances balances,
            Object crossSideBalance,
            boolean isActive,
            long entryCount,
            String lastEntryDate,
            String createdAt,
            String updatedAt) {
    }

    public record AccountOption(
            Long id,
            String accountCode,
            String name,
            String username,
            String type,
            boolean isActive,
            String totalUserPaid,
            String totalAdminPaid,
            String pendingBalance,
            Balance balance) {
    }

    /**
     * Admin user creation: only Name and Password are required.
     */
    public record CreateAccountRequest(
            @NotBlank(message = "Name is required.") @Size(min = 2, max = 150, message = "Name must be 2-150 characters.") String name,
            @NotBlank(message = "Password is required.") @Size(max = 100, message = "Password must be 100 characters or fewer.") String password) {
    }

    public record UpdateAccountRequest(
            @Size(min = 2, max = 150, message = "Name must be 2-150 characters.") String name,
            @Size(max = 30) String phone,
            @Size(max = 190) String email,
            @Size(max = 500) String address,
            @Size(max = 500) String notes) {
    }

    public record StatusRequest(Boolean isActive) {
    }

    public record ResetPasswordRequest(
            @NotBlank(message = "Enter a new password.") @Size(min = 6, max = 100, message = "Password must be at least 6 characters.") String newPassword,
            @NotBlank(message = "Confirm the new password.") String confirmPassword) {
    }

    public record AccountResponse(AccountSummary account) {
    }

    public record AccountListResponse(List<AccountSummary> items, CommonDtos.Pagination pagination) {
    }

    public record AccountOptionsResponse(List<AccountOption> items) {
    }

    /** Simple string money field validator: decimal with up to 2 decimals, commas allowed. */
    @Pattern(regexp = "^\\d{1,12}(,\\d{2,3})*(\\.\\d{1,2})?$|^\\d{1,12}(\\.\\d{1,2})?$", message = "Enter a valid amount.")
    public @interface ValidMoney {
    }
}
