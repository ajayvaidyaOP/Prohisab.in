package com.depositin.erp.controller;

import com.depositin.erp.dto.SettingsDtos;
import com.depositin.erp.entity.UserAccount;
import com.depositin.erp.exception.ApiException;
import com.depositin.erp.exception.ErrorCode;
import com.depositin.erp.security.CurrentUser;
import com.depositin.erp.security.SecurityUtils;
import com.depositin.erp.service.EntryOptionService;
import com.depositin.erp.service.SettingsService;
import com.depositin.erp.service.UserService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * Settings + admin-controlled entry options.
 * GET is available to any signed-in user (they need the active options list);
 * every write is ADMIN-only. User password change is completely unavailable.
 */
@RestController
@RequestMapping("/api/settings")
public class SettingsController {

    private final SettingsService settings;
    private final EntryOptionService entryOptions;
    private final UserService userService;

    public SettingsController(SettingsService settings, EntryOptionService entryOptions, UserService userService) {
        this.settings = settings;
        this.entryOptions = entryOptions;
        this.userService = userService;
    }

    @GetMapping
    public SettingsDtos.SettingsView get() {
        CurrentUser user = SecurityUtils.requireUser();
        return settings.view(user.name());
    }

    @PutMapping
    public SettingsDtos.BusinessView update(@Valid @RequestBody SettingsDtos.UpdateSettingsRequest request) {
        CurrentUser admin = SecurityUtils.requireAdmin();
        return settings.update(request, userService.requireUser(admin.id()));
    }

    // --------------------------------------------------------------
    // Entry options management (ADMIN)
    // --------------------------------------------------------------

    /** Bulk replace of the user entry-option list (Settings > Entry Options). */
    @PutMapping("/entry-options")
    public SettingsDtos.EntryOptionsBulkResponse replaceOptions(
            @Valid @RequestBody SettingsDtos.ReplaceEntryOptionsRequest request) {
        CurrentUser admin = SecurityUtils.currentUser();
        SecurityUtils.requireAdmin();
        var names = entryOptions.replaceAll(request.options(), userService.requireUser(admin.id()));
        return new SettingsDtos.EntryOptionsBulkResponse(
                settings.view(admin.name()).business(), names);
    }

    @GetMapping("/entry-options")
    public SettingsDtos.EntryOptionListResponse listOptions() {
        CurrentUser user = SecurityUtils.requireUser();
        List<SettingsDtos.EntryOptionView> items = user.isAdmin() ? entryOptions.listAll() : entryOptions.listActive();
        return new SettingsDtos.EntryOptionListResponse(items);
    }

    @PostMapping("/entry-options")
    @ResponseStatus(HttpStatus.CREATED)
    public SettingsDtos.EntryOptionResponse createOption(@Valid @RequestBody SettingsDtos.CreateEntryOptionRequest request) {
        CurrentUser admin = SecurityUtils.requireAdmin();
        return new SettingsDtos.EntryOptionResponse(entryOptions.create(request, userService.requireUser(admin.id())));
    }

    @PatchMapping("/entry-options/{id}")
    public SettingsDtos.EntryOptionResponse updateOption(@PathVariable Long id,
                                                         @Valid @RequestBody SettingsDtos.UpdateEntryOptionRequest request) {
        CurrentUser admin = SecurityUtils.requireAdmin();
        return new SettingsDtos.EntryOptionResponse(entryOptions.update(id, request, userService.requireUser(admin.id())));
    }

    @PostMapping("/entry-options/{id}/deactivate")
    public SettingsDtos.EntryOptionResponse deactivateOption(@PathVariable Long id) {
        CurrentUser admin = SecurityUtils.requireAdmin();
        return new SettingsDtos.EntryOptionResponse(entryOptions.deactivate(id, userService.requireUser(admin.id())));
    }

    @DeleteMapping("/entry-options/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void deleteOption(@PathVariable Long id) {
        CurrentUser admin = SecurityUtils.requireAdmin();
        entryOptions.delete(id, userService.requireUser(admin.id()));
    }
}
