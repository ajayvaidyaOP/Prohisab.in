package com.depositin.erp.dto;

import com.fasterxml.jackson.annotation.JsonAlias;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

/** Transaction (ledger entry) request/response shapes. */
public final class TransactionDtos {

    private TransactionDtos() {
    }

    public record UserRef(Long id, String username) {
    }

    public record AccountRef(Long id, String accountCode, String name, String type, String typeLabel) {
    }

    /**
     * Kept compatible with the React frontend's Transaction type.
     * {@code type} is 'DEPOSIT' or 'WITHDRAWAL'; legacy type names are accepted on input.
     */
    public record TransactionView(
            Long id,
            String entryDate,
            String type,
            String typeLabel,
            String side,
            String direction,
            String amount,
            String option,
            String detail,
            String description,
            String paymentMethod,
            String paymentMethodLabel,
            String referenceNumber,
            String notes,
            Long reversalOfId,
            Long reversedById,
            boolean isReversal,
            boolean isReversed,
            String approvalStatus,
            UserRef reviewedBy,
            String reviewedAt,
            String rejectionReason,
            AccountRef account,
            Long createdById,
            String createdAt) {
    }

    /**
     * Create a deposit or withdrawal.
     * `type` accepts DEPOSIT / WITHDRAWAL (or the legacy internal names, which are mapped).
     */
    public record CreateTransactionRequest(
            @NotNull(message = "Choose a user account.") Long accountId,
            @NotBlank(message = "Choose Deposit or Withdrawal.") String type,
            @NotBlank(message = "Choose a date.") String entryDate,
            @NotBlank(message = "Enter an amount.") String amount,
            // Resolved from `option`/`optionName` or the legacy combined `notes` ("Option — detail").
            // The service validates it against the active entry-option list (INVALID_ENTRY_OPTION).
            @JsonAlias({"optionName"}) @Size(max = 120) String option,
            @JsonAlias({"description"}) @Size(max = 500) String detail,
            @Size(max = 20) String paymentMethod,
            @Size(max = 100) String referenceNumber,
            // Legacy compatibility: combined notes field (option — detail) when option/detail are not sent.
            @Size(max = 500) String notes) {
    }

    public record RejectRequest(@NotBlank(message = "Enter a reason.") @Size(max = 300) String reason) {
    }

    public record ReversalRequest(
            @NotBlank(message = "Enter a reason.") @Size(max = 300) String reason,
            @Size(max = 10) String entryDate) {
    }

    public record TransactionResponse(TransactionView transaction, AccountDtos.AccountSummary account, boolean replayed) {
    }

    public record ApproveResponse(TransactionView transaction, AccountDtos.AccountSummary account,
                                  boolean alreadyApproved, boolean replayed) {
    }

    public record RejectResponse(TransactionView transaction, AccountDtos.AccountSummary account,
                                 boolean alreadyRejected, boolean replayed) {
    }

    /** The original entry after a reversal, with its reversal link. */
    public record OriginalRef(Long id, boolean isReversed, Long reversedById) {
    }

    public record ReversalResponse(TransactionView reversal, OriginalRef original,
                                   AccountDtos.AccountSummary account, boolean replayed) {
    }

    public record TransactionListResponse(List<TransactionView> items, CommonDtos.Pagination pagination) {
    }
}
