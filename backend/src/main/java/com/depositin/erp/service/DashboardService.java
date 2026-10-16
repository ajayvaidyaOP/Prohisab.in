package com.depositin.erp.service;

import com.depositin.erp.dto.AccountDtos;
import com.depositin.erp.dto.DashboardDtos;
import com.depositin.erp.dto.TransactionDtos;
import com.depositin.erp.entity.ApprovalStatus;
import com.depositin.erp.entity.Book;
import com.depositin.erp.entity.LedgerTransaction;
import com.depositin.erp.entity.TransactionKind;
import com.depositin.erp.entity.UserAccount;
import com.depositin.erp.entity.UserRole;
import com.depositin.erp.exception.ApiException;
import com.depositin.erp.repository.BookRepository;
import com.depositin.erp.repository.LedgerTransactionRepository;
import com.depositin.erp.repository.UserRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Admin dashboard aggregates, optionally filtered by date, book and staff user. */
@Service
public class DashboardService {

    private final UserRepository users;
    private final LedgerTransactionRepository transactions;
    private final BookRepository books;
    private final LedgerService ledger;
    private final TransactionService transactionService;
    private final SettingsService settings;
    private final DateService dates;
    private final MoneyService money;

    public DashboardService(UserRepository users, LedgerTransactionRepository transactions,
                            BookRepository books, LedgerService ledger, TransactionService transactionService,
                            SettingsService settings, DateService dates, MoneyService money) {
        this.users = users;
        this.transactions = transactions;
        this.books = books;
        this.ledger = ledger;
        this.transactionService = transactionService;
        this.settings = settings;
        this.dates = dates;
        this.money = money;
    }

    @Transactional(readOnly = true)
    public DashboardDtos.DashboardData data() {
        return data(null, null, null, null);
    }

    @Transactional(readOnly = true)
    public DashboardDtos.DashboardData data(String from, String to, Long bookId, Long userId) {
        LocalDate fromDate = dates.parseDate(from);
        LocalDate toDate = dates.parseDate(to);
        if (fromDate != null && toDate != null && fromDate.isAfter(toDate)) {
            throw ApiException.badRequest("From date must be on or before the To date.");
        }
        if (bookId != null && !books.existsById(bookId)) {
            throw ApiException.notFound("Book not found.");
        }

        LocalDate today = dates.today();
        List<UserAccount> allUsers = users.findByRoleOrderByCreatedAtAsc(UserRole.USER);
        List<UserAccount> filteredUsers = userId == null
                ? allUsers
                : allUsers.stream().filter(user -> user.getId().equals(userId)).toList();
        if (userId != null && filteredUsers.isEmpty()) {
            throw ApiException.notFound("Staff account not found.");
        }
        long totalUsers = filteredUsers.size();
        long activeUsers = filteredUsers.stream().filter(UserAccount::isActive).count();
        long inactiveUsers = totalUsers - activeUsers;

        Map<Long, EnumMap<TransactionKind, BigDecimal>> approvedByUser = new HashMap<>();
        for (Object[] row : transactions.sumApprovedByFiltersGrouped(fromDate, toDate, bookId, userId)) {
            Long id = (Long) row[0];
            TransactionKind kind = (TransactionKind) row[1];
            BigDecimal amount = (BigDecimal) row[2];
            approvedByUser.computeIfAbsent(id, ignored -> new EnumMap<>(TransactionKind.class)).put(kind, amount);
        }

        Map<Long, PendingTotal> pendingByUser = new HashMap<>();
        for (Object[] row : transactions.sumPendingByFiltersGrouped(fromDate, toDate, bookId, userId)) {
            pendingByUser.put((Long) row[0], new PendingTotal((Long) row[1], (BigDecimal) row[2]));
        }

        BigDecimal allDeposits = BigDecimal.ZERO;
        BigDecimal allWithdrawals = BigDecimal.ZERO;
        BigDecimal pendingAmount = BigDecimal.ZERO;
        long pendingCount = 0;
        List<DashboardDtos.UserOverview> overviews = new ArrayList<>();
        List<DashboardDtos.OutstandingAccount> outstanding = new ArrayList<>();

        for (UserAccount user : filteredUsers) {
            EnumMap<TransactionKind, BigDecimal> userTotals = approvedByUser.getOrDefault(user.getId(), new EnumMap<>(TransactionKind.class));
            BigDecimal deposits = userTotals.getOrDefault(TransactionKind.DEPOSIT, BigDecimal.ZERO);
            BigDecimal withdrawals = userTotals.getOrDefault(TransactionKind.WITHDRAWAL, BigDecimal.ZERO);
            BigDecimal net = deposits.subtract(withdrawals);
            PendingTotal pending = pendingByUser.getOrDefault(user.getId(), new PendingTotal(0L, BigDecimal.ZERO));

            allDeposits = allDeposits.add(deposits);
            allWithdrawals = allWithdrawals.add(withdrawals);
            pendingAmount = pendingAmount.add(pending.amount());
            pendingCount += pending.count();

            AccountDtos.Balance balance = ledger.describeBalance(net);
            DashboardDtos.UserOverview overview = new DashboardDtos.UserOverview(
                    user.getId(), user.getAccountCode(), user.getName(), user.getName(),
                    user.getPhone(), "CUSTOMER", user.isActive(),
                    money.format(deposits), money.format(withdrawals), money.format(net),
                    pending.count(), money.format(pending.amount()), balance);
            overviews.add(overview);
            if (net.signum() != 0) {
                outstanding.add(new DashboardDtos.OutstandingAccount(
                        user.getId(), user.getAccountCode(), user.getName(), user.getName(), "CUSTOMER", user.isActive(),
                        money.format(deposits), money.format(withdrawals), money.format(net), balance));
            }
        }

        boolean todayInRange = (fromDate == null || !today.isBefore(fromDate))
                && (toDate == null || !today.isAfter(toDate));
        BigDecimal todayDeposits = todayInRange
                ? transactions.sumApprovedByFilters(TransactionKind.DEPOSIT, today, today, bookId, userId)
                : BigDecimal.ZERO;
        BigDecimal todayWithdrawals = todayInRange
                ? transactions.sumApprovedByFilters(TransactionKind.WITHDRAWAL, today, today, bookId, userId)
                : BigDecimal.ZERO;
        long todayDepositCount = todayInRange
                ? transactions.countByFiltersAndKind(ApprovalStatus.APPROVED, TransactionKind.DEPOSIT, today, today, bookId, userId)
                : 0;
        long todayWithdrawalCount = todayInRange
                ? transactions.countByFiltersAndKind(ApprovalStatus.APPROVED, TransactionKind.WITHDRAWAL, today, today, bookId, userId)
                : 0;

        long approvedEntryCount = transactions.countByFilters(ApprovalStatus.APPROVED, fromDate, toDate, bookId, userId);
        long pendingEntryCount = transactions.countByFilters(ApprovalStatus.PENDING, fromDate, toDate, bookId, userId);
        List<TransactionDtos.TransactionView> pendingEntries = transactions.searchByDashboardFilters(
                        ApprovalStatus.PENDING, false, userId, fromDate, toDate, bookId,
                        PageRequest.of(0, 100, Sort.by(Sort.Direction.ASC, "createdAt", "id")))
                .getContent().stream().map(transactionService::toView).toList();
        List<TransactionDtos.TransactionView> recent = transactions.searchByDashboardFilters(
                        null, true, userId, fromDate, toDate, bookId,
                        PageRequest.of(0, 10, Sort.by(Sort.Direction.DESC, "entryDate", "id")))
                .getContent().stream().map(transactionService::toView).toList();

        BigDecimal totalNet = allDeposits.subtract(allWithdrawals);
        long withBalance = outstanding.size();
        long activeBooks;
        if (bookId != null) {
            activeBooks = books.findById(bookId).filter(book -> book.getStatus() == Book.Status.ACTIVE).isPresent() ? 1 : 0;
        } else if (userId != null) {
            activeBooks = filteredUsers.get(0).getAllowedBooks().stream()
                    .filter(book -> book.getStatus() == Book.Status.ACTIVE)
                    .count();
        } else {
            activeBooks = books.countByStatus(Book.Status.ACTIVE);
        }
        DashboardDtos.DashboardData data = new DashboardDtos.DashboardData(
                today.toString(),
                dates.businessZone().toString(),
                settings.getOrCreate().getCurrencySymbol(),
                new DashboardDtos.Counts(
                        activeUsers, inactiveUsers,
                        0, 0,
                        totalUsers, activeUsers,
                        approvedEntryCount,
                        todayDepositCount + todayWithdrawalCount,
                        withBalance, 0,
                        pendingEntryCount,
                        activeBooks),
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
                        "Net of approved deposits (+) and withdrawals (-) for this selection."),
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

    private record PendingTotal(long count, BigDecimal amount) { }
}
