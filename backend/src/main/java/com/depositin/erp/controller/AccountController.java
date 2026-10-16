package com.depositin.erp.controller;

import com.depositin.erp.dto.AccountDtos;
import com.depositin.erp.security.CurrentUser;
import com.depositin.erp.security.SecurityUtils;
import com.depositin.erp.service.LedgerService;
import com.depositin.erp.service.UserService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * User/account management. Listing and creation are ADMIN-only (enforced by
 * security config as well); account detail is ADMIN or the account owner.
 */
@RestController
@RequestMapping("/api/accounts")
public class AccountController {

    private final UserService userService;
    private final LedgerService ledgerService;

    public AccountController(UserService userService, LedgerService ledgerService) {
        this.userService = userService;
        this.ledgerService = ledgerService;
    }

    @GetMapping
    public AccountDtos.AccountListResponse list(
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String type,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) String sort,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize) {
        SecurityUtils.requireAdmin();
        return ledgerService.listUsers(search, status, sort, page, Math.min(Math.max(1, pageSize), 100));
    }

    @GetMapping("/options")
    public AccountDtos.AccountOptionsResponse options(@RequestParam(required = false) String search) {
        SecurityUtils.requireAdmin();
        return new AccountDtos.AccountOptionsResponse(ledgerService.accountOptions(search));
    }

    @GetMapping("/{id}")
    public AccountDtos.AccountResponse get(@PathVariable Long id) {
        CurrentUser viewer = SecurityUtils.requireUser();
        requireVisible(id, viewer);
        return new AccountDtos.AccountResponse(ledgerService.summarize(userService.requireUser(id)));
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public AccountDtos.AccountResponse create(@Valid @RequestBody AccountDtos.CreateAccountRequest request) {
        CurrentUser admin = SecurityUtils.requireAdmin();
        return new AccountDtos.AccountResponse(userService.create(request, userService.requireUser(admin.id())));
    }

    @PatchMapping("/{id}")
    public AccountDtos.AccountResponse update(@PathVariable Long id,
                                              @Valid @RequestBody AccountDtos.UpdateAccountRequest request) {
        CurrentUser admin = SecurityUtils.requireAdmin();
        return new AccountDtos.AccountResponse(userService.update(id, request, userService.requireUser(admin.id())));
    }

    @PatchMapping("/{id}/status")
    public AccountDtos.AccountResponse setStatus(@PathVariable Long id, @RequestBody AccountDtos.StatusRequest request) {
        CurrentUser admin = SecurityUtils.requireAdmin();
        boolean active = Boolean.TRUE.equals(request.isActive());
        return new AccountDtos.AccountResponse(userService.setStatus(id, active, userService.requireUser(admin.id())));
    }

    @PostMapping("/{id}/reset-password")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void resetPassword(@PathVariable Long id, @Valid @RequestBody AccountDtos.ResetPasswordRequest request) {
        CurrentUser admin = SecurityUtils.requireAdmin();
        userService.resetPassword(id, request, userService.requireUser(admin.id()));
    }

    @PutMapping("/{id}/books")
    public AccountDtos.AccountResponse setBooks(@PathVariable Long id, @RequestBody List<Long> bookIds) {
        CurrentUser admin = SecurityUtils.requireAdmin();
        return new AccountDtos.AccountResponse(userService.setAllowedBooks(id, bookIds, userService.requireUser(admin.id())));
    }

    @PatchMapping("/{id}/back-date")
    public AccountDtos.AccountResponse setBackDate(@PathVariable Long id, @RequestBody Map<String, Boolean> body) {
        CurrentUser admin = SecurityUtils.requireAdmin();
        boolean allowed = Boolean.TRUE.equals(body.get("allowed"));
        return new AccountDtos.AccountResponse(userService.setBackDateEntry(id, allowed, userService.requireUser(admin.id())));
    }

    private void requireVisible(Long id, CurrentUser viewer) {
        if (!viewer.isAdmin() && !viewer.id().equals(id)) {
            throw com.depositin.erp.exception.ApiException.forbidden("You can only view your own account.");
        }
    }
}
