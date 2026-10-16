package com.depositin.erp.service;

import com.depositin.erp.dto.AccountDtos;
import com.depositin.erp.dto.CommonDtos;
import com.depositin.erp.dto.TransactionDtos;
import com.depositin.erp.entity.ApprovalStatus;
import com.depositin.erp.entity.LedgerTransaction;
import com.depositin.erp.entity.TransactionKind;
import com.depositin.erp.entity.UserAccount;
import com.depositin.erp.entity.UserRole;
import com.depositin.erp.entity.Book;
import com.depositin.erp.repository.BookRepository;
import com.depositin.erp.exception.ApiException;
import com.depositin.erp.exception.ErrorCode;
import com.depositin.erp.repository.LedgerTransactionRepository;
import com.depositin.erp.repository.UserRepository;
import com.depositin.erp.security.CurrentUser;
import com.depositin.erp.security.SecurityUtils;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;

/**
 * Deposit / withdrawal workflow:
 * - USER submissions start PENDING and never touch the balance until approved.
 * - ADMIN-created entries are APPROVED immediately (existing behaviour preserved).
 * - Approval/rejection is transactional and race-safe: an entry can be decided once.
 */
@Service
public class TransactionService {

    private final LedgerTransactionRepository transactions;
    private final BookRepository books;
    private final UserRepository users;
    private final LedgerService ledger;
    private final EntryOptionService entryOptions;
    private final MoneyService money;
    private final DateService dates;
    private final AuditService audit;

    public TransactionService(LedgerTransactionRepository transactions, BookRepository books, UserRepository users,
                              LedgerService ledger, EntryOptionService entryOptions,
                              MoneyService money, DateService dates, AuditService audit) {
        this.transactions = transactions;
        this.books = books;
        this.users = users;
        this.ledger = ledger;
        this.entryOptions = entryOptions;
        this.money = money;
        this.dates = dates;
        this.audit = audit;
    }

    /**
     * Creates a deposit or withdrawal request.
     * Legacy internal type names are mapped onto the two user-facing kinds.
     */
    @Transactional
    public TransactionDtos.TransactionResponse create(TransactionDtos.CreateTransactionRequest request, CurrentUser actor) {
        UserAccount actorUser = users.findById(actor.id())
                .orElseThrow(() -> ApiException.unauthorized("You must be signed in."));

        TransactionKind kind = parseKind(request.type());

        // Privacy: USER accounts may only post to their own ledger.
        Long targetId = request.accountId();
        if (actor.role() == UserRole.USER && !actor.id().equals(targetId)) {
            throw ApiException.forbidden("You can only add entries to your own account.");
        }
        UserAccount target = users.findById(targetId)
                .orElseThrow(() -> ApiException.notFound("User account not found."));
        if (!target.isActive()) {
            throw ApiException.unprocessable(ErrorCode.ACCOUNT_INACTIVE,
                    "This account is inactive. Reactivate it before recording transactions.",
                    List.of(new ApiException.FieldError("accountId", "Account is inactive.")));
        }

        LocalDate entryDate = dates.parseDate(request.entryDate());
        if (entryDate == null) {
            throw ApiException.validation("Please correct the highlighted fields.",
                    List.of(new ApiException.FieldError("entryDate", "Choose a date.")));
        }
        if (entryDate.isAfter(dates.today())) {
            throw ApiException.unprocessable(ErrorCode.FUTURE_DATE,
                    "The date cannot be in the future (today is " + dates.today() + ").",
                    List.of(new ApiException.FieldError("entryDate", "Choose today or an earlier date.")));
        }

        java.math.BigDecimal amount = money.parsePositive(request.amount(), "amount");

        // Option and detail are stored as separate fields; only active admin options are valid.
        String option = resolveOption(request);
        String detail = request.detail() == null || request.detail().isBlank() ? null : request.detail().trim();
        if (detail == null && request.notes() != null && !request.notes().isBlank()) {
            // Legacy clients sent `notes` as "Option — detail"; keep the tail as the detail.
            String notes = request.notes().trim();
            int split = notes.indexOf('\u2014') >= 0 ? notes.indexOf('\u2014') : notes.indexOf('-');
            if (split > 0) {
                String tail = notes.substring(split + 1).trim();
                detail = tail.isEmpty() ? null : tail;
            }
        }

        boolean pending = actor.role() == UserRole.USER;
        LedgerTransaction entry = new LedgerTransaction();
        entry.setUser(target);
        entry.setEntryDate(entryDate);
        entry.setKind(kind);
        entry.setAmount(amount);
        entry.setOptionName(option);
        entry.setDetail(detail);
        if (request.bookId() != null) {
            books.findById(request.bookId()).ifPresent(entry::setBook);
        }
        entry.setCustomerId(blankToNull(request.customerId()));
        entry.setBankDetails(blankToNull(request.bankDetails()));
        entry.setReferenceNumber(blankToNull(request.referenceNumber()));
        entry.setPaymentMethod(blankToNull(request.paymentMethod()) == null ? null
                : blankToNull(request.paymentMethod()).toUpperCase());
        entry.setApprovalStatus(pending ? ApprovalStatus.PENDING : ApprovalStatus.APPROVED);
        entry.setCreatedBy(actorUser);
        if (!pending) {
            entry.setReviewedBy(actorUser);
            entry.setReviewedAt(java.time.Instant.now());
        }
        transactions.save(entry);

        audit.record("TRANSACTION_CREATED", "LedgerTransaction", entry.getId(), actorUser, Map.of(
                "userId", target.getId(),
                "kind", kind.name(),
                "amount", money.format(amount),
                "entryDate", entryDate.toString(),
                "option", option,
                "approvalStatus", entry.getApprovalStatus().name()));

        return new TransactionDtos.TransactionResponse(toView(entry), ledger.summarize(target), false);
    }

    /** Approves a pending entry exactly once (race-safe). */
    @Transactional
    public TransactionDtos.ApproveResponse approve(Long entryId, CurrentUser actor) {
        UserAccount reviewer = users.findById(actor.id())
                .orElseThrow(() -> ApiException.unauthorized("You must be signed in."));

        LedgerTransaction entry = transactions.findByIdForUpdate(entryId)
                .orElseThrow(() -> ApiException.notFound("Transaction not found."));

        UserAccount target = entry.getUser();
        if (!target.isActive()) {
            throw ApiException.unprocessable(ErrorCode.ACCOUNT_INACTIVE,
                    "This account is inactive. Reactivate it before approving entries.",
                    List.of(new ApiException.FieldError("accountId", "Account is inactive.")));
        }

        if (entry.getApprovalStatus() == ApprovalStatus.APPROVED) {
            return new TransactionDtos.ApproveResponse(toView(entry), ledger.summarize(target), true, false);
        }
        if (entry.getApprovalStatus() == ApprovalStatus.REJECTED) {
            throw ApiException.conflict(ErrorCode.ALREADY_REJECTED,
                    "This entry has already been rejected and cannot be approved.");
        }

        entry.setApprovalStatus(ApprovalStatus.APPROVED);
        entry.setReviewedBy(reviewer);
        entry.setReviewedAt(java.time.Instant.now());
        entry.setRejectionReason(null);
        transactions.save(entry);

        audit.record("TRANSACTION_APPROVED", "LedgerTransaction", entry.getId(), reviewer, Map.of(
                "userId", target.getId(),
                "kind", entry.getKind().name(),
                "amount", money.format(entry.getAmount())));

        return new TransactionDtos.ApproveResponse(toView(entry), ledger.summarize(target), false, false);
    }

    /** Rejects a pending entry exactly once (race-safe). Rejected entries never affect balances. */
    @Transactional
    public TransactionDtos.RejectResponse reject(Long entryId, TransactionDtos.RejectRequest request, CurrentUser actor) {
        UserAccount reviewer = users.findById(actor.id())
                .orElseThrow(() -> ApiException.unauthorized("You must be signed in."));

        LedgerTransaction entry = transactions.findByIdForUpdate(entryId)
                .orElseThrow(() -> ApiException.notFound("Transaction not found."));
        UserAccount target = entry.getUser();

        if (entry.getApprovalStatus() == ApprovalStatus.REJECTED) {
            return new TransactionDtos.RejectResponse(toView(entry), ledger.summarize(target), true, false);
        }
        if (entry.getApprovalStatus() == ApprovalStatus.APPROVED) {
            throw ApiException.conflict(ErrorCode.ALREADY_APPROVED,
                    "This entry has already been approved and cannot be rejected.");
        }

        String reason = request.reason() == null ? "" : request.reason().trim();
        entry.setApprovalStatus(ApprovalStatus.REJECTED);
        entry.setReviewedBy(reviewer);
        entry.setReviewedAt(java.time.Instant.now());
        entry.setRejectionReason(reason.isEmpty() ? null : reason);
        transactions.save(entry);

        audit.record("TRANSACTION_REJECTED", "LedgerTransaction", entry.getId(), reviewer, Map.of(
                "userId", target.getId(),
                "amount", money.format(entry.getAmount()),
                "reason", reason));

        return new TransactionDtos.RejectResponse(toView(entry), ledger.summarize(target), false, false);
    }

    /** Admin transaction list with filters. */
    @Transactional(readOnly = true)
    public TransactionDtos.TransactionListResponse list(String approvalStatus, Long userId, String type,
                                                        String includeReversals,
                                                        String from, String to, int page, int pageSize) {
        ApprovalStatus status = null;
        if (approvalStatus != null && !approvalStatus.isBlank()) {
            status = ApprovalStatus.valueOf(approvalStatus.trim().toUpperCase());
        }
        TransactionKind kind = null;
        if (type != null && !type.isBlank()) {
            kind = parseKind(type);
        }
        LocalDate fromDate = dates.parseDate(from);
        LocalDate toDate = dates.parseDate(to);
        boolean withReversals = includeReversals == null || !includeReversals.trim().equalsIgnoreCase("false");
        Page<LedgerTransaction> result = transactions.search(status, withReversals, userId, kind, fromDate, toDate,
                PageRequest.of(Math.max(0, page - 1), Math.min(Math.max(1, pageSize), 100), Sort.by(Sort.Direction.DESC, "entryDate", "id")));
        List<TransactionDtos.TransactionView> items = result.getContent().stream().map(this::toView).toList();
        return new TransactionDtos.TransactionListResponse(items,
                new CommonDtos.Pagination(result.getNumber() + 1, result.getSize(), result.getTotalElements(), result.getTotalPages()));
    }

    /** One entry, visible to admins and (only) to the owning user. */
    @Transactional(readOnly = true)
    public TransactionDtos.TransactionView get(Long id, CurrentUser actor) {
        LedgerTransaction entry = transactions.findByIdWithUsers(id)
                .orElseThrow(() -> ApiException.notFound("Transaction not found."));
        if (actor.role() != UserRole.ADMIN && !entry.getUser().getId().equals(actor.id())) {
            throw ApiException.notFound("Transaction not found.");
        }
        return toView(entry);
    }

    public TransactionDtos.TransactionView toView(LedgerTransaction entry) {
        UserAccount target = entry.getUser();
        UserAccount reviewedBy = entry.getReviewedBy();
        boolean isReversal = entry.getReversalOfId() != null;
        boolean isReversed = entry.getReversedById() != null;
        String type = isReversal ? "REVERSAL" : entry.getKind().name();
        String typeLabel = isReversal ? "Reversal"
                : entry.getKind() == TransactionKind.DEPOSIT ? "Deposit" : "Withdrawal";
        return new TransactionDtos.TransactionView(
                entry.getId(),
                entry.getEntryDate().toString(),
                type,
                typeLabel,
                "RECEIVABLE",
                entry.getKind() == TransactionKind.DEPOSIT ? "INCREASE" : "DECREASE",
                money.format(entry.getAmount()),
                entry.getOptionName(),
                entry.getDetail(),
                entry.getBook() == null ? null : entry.getBook().getId(),
                entry.getBook() == null ? null : entry.getBook().getName(),
                entry.getCustomerId(),
                entry.getBankDetails(),
                entry.buildDescription(),
                entry.getPaymentMethod(),
                entry.getPaymentMethod() == null ? entry.getOptionName() : paymentMethodLabel(entry.getPaymentMethod()),
                entry.getReferenceNumber(),
                entry.buildDescription(),
                entry.getReversalOfId(),
                entry.getReversedById(),
                isReversal,
                isReversed,
                entry.getApprovalStatus().name(),
                reviewedBy == null ? null : new TransactionDtos.UserRef(reviewedBy.getId(), reviewedBy.getName()),
                entry.getReviewedAt() == null ? null : DateTimeFormatter.ISO_INSTANT.format(entry.getReviewedAt()),
                entry.getRejectionReason(),
                new TransactionDtos.AccountRef(target.getId(), target.getAccountCode(), target.getName(), "CUSTOMER", "User"),
                entry.getCreatedBy() == null ? null : entry.getCreatedBy().getId(),
                DateTimeFormatter.ISO_INSTANT.format(entry.getCreatedAt()));
    }

    /** Display label for a payment-method code. */
    public static String paymentMethodLabel(String code) {
        return switch (code.toUpperCase()) {
            case "CASH" -> "Cash";
            case "UPI" -> "UPI";
            case "BANK_TRANSFER" -> "Bank Transfer";
            case "OTHER" -> "Other";
            default -> code;
        };
    }

    /**
     * Reverses an approved entry by posting an offsetting entry (admin only).
     * The original can be reversed exactly once; the reversal itself cannot be reversed.
     */
    @Transactional
    public TransactionDtos.ReversalResponse reverse(Long entryId, TransactionDtos.ReversalRequest request, CurrentUser actor) {
        UserAccount reviewer = users.findById(actor.id())
                .orElseThrow(() -> ApiException.unauthorized("You must be signed in."));

        LedgerTransaction original = transactions.findByIdForUpdate(entryId)
                .orElseThrow(() -> ApiException.notFound("Transaction not found."));

        if (original.getReversalOfId() != null) {
            throw ApiException.badRequest("Reversal entries cannot be reversed again.");
        }
        if (original.getReversedById() != null) {
            throw ApiException.conflict(ErrorCode.CONFLICT, "This entry has already been reversed.");
        }
        if (original.getApprovalStatus() != ApprovalStatus.APPROVED) {
            throw ApiException.unprocessable(ErrorCode.CONFLICT,
                    "Only approved entries can be reversed.",
                    List.of(new ApiException.FieldError("id", "Entry must be approved first.")));
        }
        UserAccount target = original.getUser();
        if (!target.isActive()) {
            throw ApiException.unprocessable(ErrorCode.ACCOUNT_INACTIVE,
                    "This account is inactive. Reactivate it before recording transactions.",
                    List.of(new ApiException.FieldError("accountId", "Account is inactive.")));
        }

        LocalDate entryDate = request.entryDate() == null || request.entryDate().isBlank()
                ? dates.today() : dates.parseDate(request.entryDate());
        if (entryDate.isAfter(dates.today())) {
            throw ApiException.unprocessable(ErrorCode.FUTURE_DATE,
                    "The date cannot be in the future (today is " + dates.today() + ").",
                    List.of(new ApiException.FieldError("entryDate", "Choose today or an earlier date.")));
        }
        String reason = request.reason().trim();

        LedgerTransaction reversal = new LedgerTransaction();
        reversal.setUser(target);
        reversal.setEntryDate(entryDate);
        reversal.setKind(original.getKind() == TransactionKind.DEPOSIT
                ? TransactionKind.WITHDRAWAL : TransactionKind.DEPOSIT);
        reversal.setAmount(original.getAmount());
        reversal.setOptionName(original.getOptionName());
        reversal.setDetail("Reversal of entry #" + original.getId() + " — " + reason);
        reversal.setPaymentMethod(original.getPaymentMethod());
        reversal.setReferenceNumber(original.getReferenceNumber());
        reversal.setApprovalStatus(ApprovalStatus.APPROVED);
        reversal.setCreatedBy(reviewer);
        reversal.setReviewedBy(reviewer);
        reversal.setReviewedAt(Instant.now());
        reversal.setReversalOfId(original.getId());
        transactions.save(reversal);

        original.setReversedById(reversal.getId());
        transactions.save(original);

        audit.record("TRANSACTION_REVERSED", "LedgerTransaction", original.getId(), reviewer, Map.of(
                "reversalId", reversal.getId(),
                "userId", target.getId(),
                "amount", money.format(original.getAmount()),
                "reason", reason));

        return new TransactionDtos.ReversalResponse(
                toView(reversal),
                new TransactionDtos.OriginalRef(original.getId(), true, reversal.getId()),
                ledger.summarize(target),
                false);
    }

    /**
     * Maps transaction kinds. Accepts DEPOSIT/WITHDRAWAL plus the legacy internal
     * type names so old clients keep working.
     */
    public static TransactionKind parseKind(String raw) {
        if (raw == null || raw.isBlank()) {
            throw ApiException.badRequest("Choose a valid transaction type.");
        }
        String value = raw.trim().toUpperCase().replace('-', '_');
        return switch (value) {
            case "DEPOSIT", "CREDIT_SALE", "CREDIT_PURCHASE", "INCREASE", "PAYMENT_RECEIVED_IN" -> TransactionKind.DEPOSIT;
            case "WITHDRAWAL", "PAYMENT_RECEIVED", "PAYMENT_MADE", "CUSTOMER_CREDIT_ADJUSTMENT",
                 "SUPPLIER_CREDIT_ADJUSTMENT", "REVERSAL", "DECREASE" -> TransactionKind.WITHDRAWAL;
            default -> throw ApiException.badRequest("Choose a valid transaction type.");
        };
    }

    private String resolveOption(TransactionDtos.CreateTransactionRequest request) {
        if (request.option() != null && !request.option().isBlank()) {
            return entryOptions.validateActiveOption(request.option());
        }
        // Legacy clients sent `notes` as "Option — detail".
        String notes = request.notes() == null ? "" : request.notes().trim();
        if (notes.isEmpty()) {
            throw ApiException.unprocessable(ErrorCode.INVALID_ENTRY_OPTION,
                    "Please select a valid option configured by the Administrator.",
                    List.of(new ApiException.FieldError("option", "Select an option from the list set by Admin.")));
        }
        int split = notes.indexOf('—') >= 0 ? notes.indexOf('—') : notes.indexOf('-');
        String optionPart = split > 0 ? notes.substring(0, split).trim() : notes;
        String detailPart = split > 0 ? notes.substring(split + 1).trim() : null;
        String option = entryOptions.validateActiveOption(optionPart);
        if (detailPart != null && !detailPart.isEmpty() && (request.detail() == null || request.detail().isBlank())) {
            // keep legacy combined text in the detail field
            return option;
        }
        return option;
    }

    private static String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
