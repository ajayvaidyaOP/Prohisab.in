package com.depositin.erp.service;

import com.depositin.erp.dto.AccountDtos;
import com.depositin.erp.dto.CommonDtos;
import com.depositin.erp.dto.LedgerDtos;
import com.depositin.erp.entity.ApprovalStatus;
import com.depositin.erp.entity.LedgerTransaction;
import com.depositin.erp.entity.TransactionKind;
import com.depositin.erp.entity.UserAccount;
import com.depositin.erp.exception.ApiException;
import com.depositin.erp.repository.LedgerTransactionRepository;
import com.depositin.erp.repository.UserRepository;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

/**
 * Ledger math and serialization.
 *
 * Balance model (preserved from the original owed_by_user / receivable design):
 *   balance = approved deposits (+) - approved withdrawals (-)
 *   positive = DUE, negative = CREDIT (advance), zero = SETTLED.
 * PENDING and REJECTED entries never affect the balance.
 */
@Service
public class LedgerService {

    private final UserRepository users;
    private final LedgerTransactionRepository transactions;
    private final MoneyService money;
    private final DateService dates;

    public LedgerService(UserRepository users, LedgerTransactionRepository transactions,
                         MoneyService money, DateService dates) {
        this.users = users;
        this.transactions = transactions;
        this.money = money;
        this.dates = dates;
    }

    /** Net approved balance for one account. */
    @Transactional(readOnly = true)
    public BigDecimal netBalance(Long userId, LocalDate from, LocalDate to) {
        BigDecimal deposits = transactions.sumApprovedByUserAndKind(userId, TransactionKind.DEPOSIT, from, to);
        BigDecimal withdrawals = transactions.sumApprovedByUserAndKind(userId, TransactionKind.WITHDRAWAL, from, to);
        return deposits.subtract(withdrawals);
    }

    @Transactional(readOnly = true)
    public BigDecimal approvedTotal(Long userId, TransactionKind kind, LocalDate from, LocalDate to) {
        return transactions.sumApprovedByUserAndKind(userId, kind, from, to);
    }

    @Transactional(readOnly = true)
    public long pendingCount(Long userId) {
        return transactions.countByUserIdAndApprovalStatus(userId, ApprovalStatus.PENDING);
    }

    @Transactional(readOnly = true)
    public BigDecimal pendingAmount(Long userId) {
        return transactions.sumPendingByUser(userId);
    }

    /** Account summary DTO for one user (balances loaded lazily via aggregates). */
    @Transactional(readOnly = true)
    public AccountDtos.AccountSummary summarize(UserAccount user) {
        BigDecimal deposits = transactions.sumApprovedByUserAndKind(user.getId(), TransactionKind.DEPOSIT, null, null);
        BigDecimal withdrawals = transactions.sumApprovedByUserAndKind(user.getId(), TransactionKind.WITHDRAWAL, null, null);
        BigDecimal net = deposits.subtract(withdrawals);
        long entryCount = transactions.countByUserIdAndApprovalStatus(user.getId(), ApprovalStatus.APPROVED);
        LocalDate lastEntry = transactions.findLastEntryDate(user.getId());
        long pendingCount = transactions.countByUserIdAndApprovalStatus(user.getId(), ApprovalStatus.PENDING);
        BigDecimal pendingAmount = transactions.sumPendingByUser(user.getId());
        return toSummary(user, deposits, withdrawals, net, entryCount, lastEntry, pendingCount, pendingAmount);
    }

    public AccountDtos.AccountSummary toSummary(UserAccount user,
                                                BigDecimal deposits,
                                                BigDecimal withdrawals,
                                                BigDecimal net,
                                                long entryCount,
                                                LocalDate lastEntry,
                                                long pendingCount,
                                                BigDecimal pendingAmount) {
        AccountDtos.Balance balance = describeBalance(net);
        return new AccountDtos.AccountSummary(
                user.getId(),
                user.getAccountCode(),
                user.getName(),
                user.getName(),
                true,
                "CUSTOMER",
                "User",
                user.getPhone(),
                user.getEmail(),
                user.getAddress(),
                user.getNotes(),
                "0.00",
                "RECEIVABLE",
                "RECEIVABLE",
                money.format(deposits),
                money.format(withdrawals),
                money.format(deposits),
                money.format(withdrawals),
                money.format(net),
                pendingCount,
                money.format(pendingAmount),
                balance,
                new AccountDtos.Balances(money.format(net), "0.00"),
                null,
                user.isActive(),
                entryCount,
                lastEntry == null ? null : lastEntry.toString(),
                DateTimeFormatter.ISO_INSTANT.format(user.getCreatedAt()),
                DateTimeFormatter.ISO_INSTANT.format(user.getUpdatedAt()));
    }

    public AccountDtos.Balance describeBalance(BigDecimal net) {
        if (net.signum() == 0) {
            return new AccountDtos.Balance("0.00", "RECEIVABLE", "SETTLED");
        }
        if (net.signum() < 0) {
            return new AccountDtos.Balance(money.format(net.abs()), "RECEIVABLE", "CREDIT");
        }
        return new AccountDtos.Balance(money.format(net), "RECEIVABLE", "DUE");
    }

    /** Ledger page with running balance (approved entries only move the balance). */
    @Transactional(readOnly = true)
    public LedgerDtos.LedgerResponse ledgerPage(Long accountId, String from, String to, String search,
                                                int page, int pageSize,
                                                com.depositin.erp.security.CurrentUser viewer) {
        UserAccount user = requireVisible(accountId, viewer);
        LocalDate fromDate = dates.parseDate(from);
        LocalDate toDate = dates.parseDate(to);
        List<LedgerTransaction> rows = transactions.ledgerRows(accountId, fromDate, toDate);

        // Running balance over ALL matching rows in date order (page slice computed after).
        List<LedgerDtos.LedgerEntryView> all = new ArrayList<>();
        BigDecimal running = BigDecimal.ZERO;
        int increases = 0;
        int totalEntries = 0;
        BigDecimal sumIn = BigDecimal.ZERO;
        BigDecimal sumOut = BigDecimal.ZERO;
        for (LedgerTransaction row : rows) {
            boolean approved = row.getApprovalStatus() == ApprovalStatus.APPROVED;
            if (approved) {
                if (row.getKind() == TransactionKind.DEPOSIT) {
                    running = running.add(row.getAmount());
                    sumIn = sumIn.add(row.getAmount());
                    increases++;
                } else {
                    running = running.subtract(row.getAmount());
                    sumOut = sumOut.add(row.getAmount());
                }
                totalEntries++;
            }
            all.add(toEntryView(row, running));
        }

        // Filter by search text (option, detail, description) after computing running balances.
        String needle = search == null || search.isBlank() ? null : search.trim().toLowerCase();
        List<LedgerDtos.LedgerEntryView> filtered = all;
        if (needle != null) {
            filtered = all.stream()
                    .filter(e -> (e.description() != null && e.description().toLowerCase().contains(needle))
                            || (e.notes() != null && e.notes().toLowerCase().contains(needle)))
                    .toList();
        }

        int total = filtered.size();
        int totalPages = Math.max(1, (int) Math.ceil(total / (double) pageSize));
        int safePage = Math.max(1, page);
        int fromIndex = Math.min((safePage - 1) * pageSize, total);
        int toIndex = Math.min(fromIndex + pageSize, total);
        List<LedgerDtos.LedgerEntryView> slice = filtered.subList(fromIndex, toIndex);

        BigDecimal closing = running;
        AccountDtos.Balance closingBalance = describeBalance(closing);
        return new LedgerDtos.LedgerResponse(
                summarize(user),
                new LedgerDtos.Filters(fromDate == null ? null : fromDate.toString(), toDate == null ? null : toDate.toString(), search),
                new LedgerDtos.OpeningBalance("0.00", "RECEIVABLE"),
                new AccountDtos.Balance("0.00", "RECEIVABLE", "SETTLED"),
                closingBalance,
                new LedgerDtos.Totals(money.format(sumIn), money.format(sumOut), money.format(sumIn.subtract(sumOut)), totalEntries),
                0,
                slice,
                new CommonDtos.Pagination(safePage, pageSize, total, totalPages));
    }

    /** Full statement (no pagination) for the printable page. */
    @Transactional(readOnly = true)
    public LedgerDtos.StatementResponse statement(Long accountId, String from, String to, String search,
                                                  com.depositin.erp.security.CurrentUser viewer) {
        LedgerDtos.LedgerResponse page = ledgerPage(accountId, from, to, search, 1, Integer.MAX_VALUE, viewer);
        return new LedgerDtos.StatementResponse(
                page.account(), page.filters(), page.openingBalance(), page.balanceBroughtForward(),
                page.closingBalance(), page.totals(), page.crossSideEntryCount(), page.entries());
    }

    public LedgerDtos.LedgerEntryView toEntryView(LedgerTransaction row, BigDecimal runningBalance) {
        String description = row.buildDescription();
        boolean isReversal = row.getReversalOfId() != null;
        boolean isReversed = row.getReversedById() != null;
        return new LedgerDtos.LedgerEntryView(
                row.getId(),
                row.getEntryDate().toString(),
                isReversal ? "REVERSAL" : row.getKind().name(),
                isReversal ? "Reversal"
                        : row.getKind() == TransactionKind.DEPOSIT ? "Deposit" : "Withdrawal",
                description,
                row.getOptionName(),
                row.getDetail(),
                "RECEIVABLE",
                row.getKind() == TransactionKind.DEPOSIT ? "INCREASE" : "DECREASE",
                money.format(row.getAmount()),
                row.getPaymentMethod(),
                row.getPaymentMethod() == null ? row.getOptionName()
                        : TransactionService.paymentMethodLabel(row.getPaymentMethod()),
                row.getReferenceNumber(),
                description,
                row.getReversalOfId(),
                row.getReversedById(),
                isReversal,
                isReversed,
                row.getApprovalStatus().name(),
                row.getReviewedAt() == null ? null : DateTimeFormatter.ISO_INSTANT.format(row.getReviewedAt()),
                row.getRejectionReason(),
                money.format(runningBalance),
                false,
                DateTimeFormatter.ISO_INSTANT.format(row.getCreatedAt()));
    }

    /** Users list for admins with filters. */
    @Transactional(readOnly = true)
    public AccountDtos.AccountListResponse listUsers(String search, String status, String sort, int page, int pageSize) {
        List<UserAccount> usersAll = users.findAll();
        String needle = search == null || search.isBlank() ? null : search.trim().toLowerCase();
        List<UserAccount> filtered = new ArrayList<>();
        for (UserAccount user : usersAll) {
            if (needle != null
                    && !user.getName().toLowerCase().contains(needle)
                    && !user.getAccountCode().toLowerCase().contains(needle)
                    && (user.getPhone() == null || !user.getPhone().toLowerCase().contains(needle))
                    && (user.getEmail() == null || !user.getEmail().toLowerCase().contains(needle))) {
                continue;
            }
            if ("active".equalsIgnoreCase(status) && !user.isActive()) {
                continue;
            }
            if ("inactive".equalsIgnoreCase(status) && user.isActive()) {
                continue;
            }
            filtered.add(user);
        }
        if ("newest".equalsIgnoreCase(sort)) {
            filtered.sort((a, b) -> b.getCreatedAt().compareTo(a.getCreatedAt()));
        } else if ("code".equalsIgnoreCase(sort)) {
            filtered.sort((a, b) -> a.getAccountCode().compareTo(b.getAccountCode()));
        } else {
            filtered.sort((a, b) -> a.getName().compareToIgnoreCase(b.getName()));
        }

        int total = filtered.size();
        int totalPages = Math.max(1, (int) Math.ceil(total / (double) pageSize));
        int safePage = Math.max(1, page);
        int fromIndex = Math.min((safePage - 1) * pageSize, total);
        int toIndex = Math.min(fromIndex + pageSize, total);
        List<AccountDtos.AccountSummary> items = new ArrayList<>();
        for (UserAccount user : filtered.subList(fromIndex, toIndex)) {
            items.add(summarize(user));
        }
        return new AccountDtos.AccountListResponse(items, new CommonDtos.Pagination(safePage, pageSize, total, totalPages));
    }

    /** Short options list for pickers. */
    @Transactional(readOnly = true)
    public List<AccountDtos.AccountOption> accountOptions(String search) {
        String needle = search == null || search.isBlank() ? null : search.trim().toLowerCase();
        List<AccountDtos.AccountOption> items = new ArrayList<>();
        for (UserAccount user : users.findAll()) {
            if (needle != null && !user.getName().toLowerCase().contains(needle)
                    && !user.getAccountCode().toLowerCase().contains(needle)) {
                continue;
            }
            AccountDtos.AccountSummary summary = summarize(user);
            items.add(new AccountDtos.AccountOption(
                    user.getId(), user.getAccountCode(), user.getName(), user.getName(), "CUSTOMER", user.isActive(),
                    summary.totalUserPaid(), summary.totalAdminPaid(), summary.pendingBalance(), summary.balance()));
        }
        return items;
    }

    /** USER accounts may only see their own ledger; ADMIN sees everything. */
    public UserAccount requireVisible(Long accountId, com.depositin.erp.security.CurrentUser viewer) {
        UserAccount user = users.findById(accountId)
                .orElseThrow(() -> ApiException.notFound("User account not found."));
        if (viewer == null || (!viewer.isAdmin() && !viewer.id().equals(accountId))) {
            throw ApiException.forbidden("You can only view your own account.");
        }
        return user;
    }
}
