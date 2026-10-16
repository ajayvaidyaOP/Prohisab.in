package com.depositin.erp.dto;

import java.util.List;

/** Ledger/statement response shapes (kept compatible with the React frontend). */
public final class LedgerDtos {

    private LedgerDtos() {
    }

    public record Filters(String from, String to, String search) {
    }

    public record OpeningBalance(String amount, String side) {
    }

    public record Totals(String increases, String decreases, String net, int entryCount) {
    }

    public record LedgerEntryView(
            Long id,
            String entryDate,
            String type,
            String typeLabel,
            String description,
            String option,
            String detail,
            String side,
            String direction,
            String amount,
            String paymentMethod,
            String paymentMethodLabel,
            String referenceNumber,
            String notes,
            Long reversalOfId,
            Long reversedById,
            boolean isReversal,
            boolean isReversed,
            String approvalStatus,
            String reviewedAt,
            String rejectionReason,
            String runningBalance,
            boolean crossSide,
            String createdAt) {
    }

    public record LedgerResponse(
            AccountDtos.AccountSummary account,
            Filters filters,
            OpeningBalance openingBalance,
            AccountDtos.Balance balanceBroughtForward,
            AccountDtos.Balance closingBalance,
            Totals totals,
            int crossSideEntryCount,
            List<LedgerEntryView> entries,
            CommonDtos.Pagination pagination) {
    }

    public record StatementResponse(
            AccountDtos.AccountSummary account,
            Filters filters,
            OpeningBalance openingBalance,
            AccountDtos.Balance balanceBroughtForward,
            AccountDtos.Balance closingBalance,
            Totals totals,
            int crossSideEntryCount,
            List<LedgerEntryView> entries) {
    }
}
