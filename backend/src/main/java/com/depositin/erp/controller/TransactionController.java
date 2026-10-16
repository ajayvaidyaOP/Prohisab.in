package com.depositin.erp.controller;

import com.depositin.erp.dto.TransactionDtos;
import com.depositin.erp.security.CurrentUser;
import com.depositin.erp.security.SecurityUtils;
import com.depositin.erp.service.TransactionService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * Deposit/withdrawal workflow. USER submits requests (PENDING); ADMIN creates
 * approved entries directly and approves/rejects pending ones.
 */
@RestController
@RequestMapping("/api/transactions")
public class TransactionController {

    private final TransactionService transactions;

    public TransactionController(TransactionService transactions) {
        this.transactions = transactions;
    }

    @GetMapping
    public TransactionDtos.TransactionListResponse list(
            @RequestParam(required = false) String approvalStatus,
            @RequestParam(required = false) Long accountId,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String includeReversals,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "25") int pageSize) {
        SecurityUtils.requireAdmin();
        return transactions.list(approvalStatus, accountId, type, includeReversals, from, to, page, pageSize);
    }

    @GetMapping("/multi-report")
    public List<TransactionDtos.TransactionView> multiReport(
            @RequestParam(required = false) List<Long> userIds,
            @RequestParam(required = false) String from,
            @RequestParam(required = false) String to) {
        SecurityUtils.requireAdmin();
        return transactions.multiReport(userIds, from, to);
    }

    @GetMapping("/{id}")
    public TransactionDtos.TransactionView get(@PathVariable Long id) {
        CurrentUser actor = SecurityUtils.requireUser();
        return transactions.get(id, actor);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public TransactionDtos.TransactionResponse create(@Valid @RequestBody TransactionDtos.CreateTransactionRequest request) {
        CurrentUser actor = SecurityUtils.requireUser();
        return transactions.create(request, actor);
    }

    @PostMapping("/{id}/approve")
    public TransactionDtos.ApproveResponse approve(@PathVariable Long id) {
        CurrentUser admin = SecurityUtils.requireAdmin();
        return transactions.approve(id, admin);
    }

    @PostMapping("/{id}/reject")
    public TransactionDtos.RejectResponse reject(@PathVariable Long id,
                                                 @Valid @RequestBody TransactionDtos.RejectRequest request) {
        CurrentUser admin = SecurityUtils.requireAdmin();
        return transactions.reject(id, request, admin);
    }

    /** Reverses an approved entry by posting an offsetting entry (admin only). */
    @PostMapping("/{id}/reversal")
    public TransactionDtos.ReversalResponse reverse(@PathVariable Long id,
                                                    @Valid @RequestBody TransactionDtos.ReversalRequest request) {
        CurrentUser admin = SecurityUtils.requireAdmin();
        return transactions.reverse(id, request, admin);
    }
}
