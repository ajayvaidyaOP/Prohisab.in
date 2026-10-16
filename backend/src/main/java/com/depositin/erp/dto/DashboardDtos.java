package com.depositin.erp.dto;

import java.util.List;

/** Dashboard response shape (kept compatible with the React frontend). */
public final class DashboardDtos {

    private DashboardDtos() {
    }

    public record Counts(
            long activeCustomers,
            long inactiveCustomers,
            long activeSuppliers,
            long inactiveSuppliers,
            long totalUsers,
            long activeUsers,
            long ledgerEntries,
            long entriesToday,
            long customersWithBalance,
            long suppliersWithBalance,
            long pendingSubmissionsCount,
            long activeBooks) {
    }

    public record UserLedgerTotals(
            String totalUserPaid,
            String totalAdminPaid,
            String totalPending,
            long pendingSubmissionsCount,
            String pendingSubmissionsAmount,
            String todayUserPaid,
            long todayUserPaidCount,
            String todayAdminPaid,
            long todayAdminPaidCount) {
    }

    public record SideSummary(String total, String credits, String description) {
    }

    public record TodayPayments(String received, long receivedCount, String paid, long paidCount, String date) {
    }

    public record OutstandingAccount(
            Long id,
            String accountCode,
            String name,
            String username,
            String type,
            boolean isActive,
            String totalUserPaid,
            String totalAdminPaid,
            String pendingBalance,
            AccountDtos.Balance balance) {
    }

    public record UserOverview(
            Long id,
            String accountCode,
            String name,
            String username,
            String phone,
            String type,
            boolean isActive,
            String totalUserPaid,
            String totalAdminPaid,
            String pendingBalance,
            long pendingSubmissionsCount,
            String pendingSubmissionsAmount,
            AccountDtos.Balance balance) {
    }

    public record DashboardData(
            String today,
            String timezone,
            String currencySymbol,
            Counts counts,
            UserLedgerTotals userLedgerTotals,
            SideSummary receivables,
            SideSummary payables,
            TodayPayments todayPayments,
            List<TransactionDtos.TransactionView> pendingEntries,
            List<TransactionDtos.TransactionView> recentTransactions,
            List<OutstandingAccount> outstandingAccounts,
            List<UserOverview> usersOverview,
            long outstandingCount) {
    }
}
