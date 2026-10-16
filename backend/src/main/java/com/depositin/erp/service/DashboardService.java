package com.depositin.erp.service;

import com.depositin.erp.dto.AccountDtos;
import com.depositin.erp.dto.DashboardDtos;
import com.depositin.erp.dto.TransactionDtos;
import com.depositin.erp.entity.ApprovalStatus;
import com.depositin.erp.entity.LedgerTransaction;
import com.depositin.erp.entity.TransactionKind;
import com.depositin.erp.entity.UserAccount;
import com.depositin.erp.entity.UserRole;
import com.depositin.erp.repository.LedgerTransactionRepository;
import com.depositin.erp.repository.UserRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

/** Admin dashboard aggregates. */
@Service
public class DashboardService {

    private final UserRepository users;
    private final LedgerTransactionRepository transactions;
    private final LedgerService ledger;
    private final TransactionService transactionService;
    private final SettingsService settings;
    private final DateService dates;
    private final MoneyService money;

    public DashboardService(UserRepository users, LedgerTransactionRepository transactions,
                            LedgerService ledger, TransactionService transactionService,
                            SettingsService settings, DateService dates, MoneyService money) {
        this.users = users;
        this.transactions = transactions;
        this.ledger = ledger;
        this.transactionService = transactionService;
        this.settings = settings;
        this.dates = dates;
        this.money = money;
    }

    @Transactional(readOnly = true)
    public DashboardDtos.DashboardData data() {
        LocalDate today = dates.today();
        List<UserAccount> allUsers = users.findAll();

        long totalUsers = allUsers.size();
        long activeUsers = allUsers.stream().filter(UserAccount::isActive).count();
        long activeCustomers = activeUsers;
        long inactiveCustomers = totalUsers - activeUsers;

        BigDecimal allDeposits = BigDecimal.ZERO;
        BigDecimal allWithdrawals = BigDecimal.ZERO;
        BigDecimal pendingAmount = BigDecimal.ZERO;
        long pendingCount = 0;
        long withBalance = 0;

        List<DashboardDtos.UserOverview> overviews = new ArrayList<>();
        List<DashboardDtos.OutstandingAccount> outstanding = new ArrayList<>();

        for (UserAccount user : allUsers) {
            AccountDtos.AccountSummary summary = ledger.summarize(user);
            BigDecimal net = new BigDecimal(summary.pendingBalance());
            allDeposits = allDeposits.add(new BigDecimal(summary.totalUserPaid()));
            allWithdrawals = allWithdrawals.add(new BigDecimal(summary.totalAdminPaid()));
            pendingAmount = pendingAmount.add(new BigDecimal(summary.pendingSubmissionsAmount()));
            pendingCount += summary.pendingSubmissionsCount();
            if (net.signum() != 0) {
                withBalance++;
            }
            DashboardDtos.UserOverview overview = new DashboardDtos.UserOverview(
                    user.getId(), user.getAccountCode(), user.getName(), user.getName(),
                    user.getPhone(), "CUSTOMER", user.isActive(),
                    summary.totalUserPaid(), summary.totalAdminPaid(), summary.pendingBalance(),
                    summary.pendingSubmissionsCount(), summary.pendingSubmissionsAmount(), summary.balance());
            overviews.add(overview);
            if (net.signum() != 0) {
                outstanding.add(new DashboardDtos.OutstandingAccount(
                        user.getId(), user.getAccountCode(), user.getName(), user.getName(), "CUSTOMER", user.isActive(),
                        summary.totalUserPaid(), summary.totalAdminPaid(), summary.pendingBalance(), summary.balance()));
            }
        }

        BigDecimal todayDeposits = transactions.sumApprovedByKindOnDate(TransactionKind.DEPOSIT, today);
        BigDecimal todayWithdrawals = transactions.sumApprovedByKindOnDate(TransactionKind.WITHDRAWAL, today);
        long todayDepositCount = transactions.countApprovedByKindOnDate(TransactionKind.DEPOSIT, today);
        long todayWithdrawalCount = transactions.countApprovedByKindOnDate(TransactionKind.WITHDRAWAL, today);

        List<TransactionDtos.TransactionView> pendingEntries = transactions.findAllPending().stream()
                .map(transactionService::toView).toList();
        List<TransactionDtos.TransactionView> recent = transactions.search(null, true, null, null, null, null,
                        org.springframework.data.domain.PageRequest.of(0, 10)).getContent().stream()
                .map(transactionService::toView).toList();

        BigDecimal totalNet = allDeposits.subtract(allWithdrawals);

        DashboardDtos.DashboardData data = new DashboardDtos.DashboardData(
                today.toString(),
                dates.businessZone().toString(),
                settings.getOrCreate().getCurrencySymbol(),
                new DashboardDtos.Counts(
                        activeCustomers, inactiveCustomers,
                        0, 0,
                        totalUsers, activeUsers,
                        transactions.countApproved(),
                        todayDepositCount + todayWithdrawalCount,
                        withBalance, 0,
                        pendingCount),
                new DashboardDtos.UserLedgerTotals(
                        money.format(allDeposits),
                        money.format(allWithdrawals),
                        money.format(totalNet),
                        pendingCount,
                        money.format(pendingAmount),
                        money.format(todayDeposits),
                        (int) todayDepositCount,
                        money.format(todayWithdrawals),
                        (int) todayWithdrawalCount),
                new DashboardDtos.SideSummary(money.format(totalNet), "0.00",
                        "Net of all approved deposits (+) and withdrawals (-)."),
                new DashboardDtos.SideSummary("0.00", "0.00", "No payable accounts in this ledger model."),
                new DashboardDtos.TodayPayments(money.format(todayDeposits), todayDepositCount,
                        money.format(todayWithdrawals), todayWithdrawalCount, today.toString()),
                pendingEntries,
                recent,
                outstanding,
                overviews,
                outstanding.size());
        return data;
    }
}
