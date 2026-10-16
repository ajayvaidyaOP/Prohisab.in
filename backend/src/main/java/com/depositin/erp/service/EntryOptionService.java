package com.depositin.erp.service;

import com.depositin.erp.dto.SettingsDtos;
import com.depositin.erp.entity.EntryOption;
import com.depositin.erp.entity.UserAccount;
import com.depositin.erp.exception.ApiException;
import com.depositin.erp.exception.ErrorCode;
import com.depositin.erp.repository.EntryOptionRepository;
import com.depositin.erp.repository.LedgerTransactionRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Admin-managed dropdown options for deposit/withdrawal entries.
 * Options can be renamed, reordered and safely deactivated (never hard-deleted
 * while history references them).
 */
@Service
public class EntryOptionService {

    /** Seeded defaults, used when the table is empty. */
    static final List<String> DEFAULT_OPTIONS = List.of(
            "Cash Deposit",
            "UPI / Bank Deposit",
            "Cash Withdrawal",
            "UPI / Bank Withdrawal",
            "Site Material",
            "Petrol / Transport",
            "Hardware Bill",
            "Office Expense");

    private final EntryOptionRepository options;
    private final LedgerTransactionRepository transactions;
    private final AuditService audit;

    public EntryOptionService(EntryOptionRepository options, LedgerTransactionRepository transactions, AuditService audit) {
        this.options = options;
        this.transactions = transactions;
        this.audit = audit;
    }

    @Transactional
    public void seedDefaultsIfEmpty() {
        if (options.count() == 0) {
            int order = 0;
            for (String name : DEFAULT_OPTIONS) {
                EntryOption option = new EntryOption();
                option.setName(name);
                option.setNameNormalized(EntryOption.normalize(name));
                option.setSortOrder(order++);
                option.setActive(true);
                options.save(option);
            }
        }
    }

    @Transactional(readOnly = true)
    public List<SettingsDtos.EntryOptionView> listAll() {
        return options.findAllByOrderBySortOrderAscIdAsc().stream().map(this::toView).toList();
    }

    @Transactional(readOnly = true)
    public List<SettingsDtos.EntryOptionView> listActive() {
        return options.findByActiveTrueOrderBySortOrderAscIdAsc().stream().map(this::toView).toList();
    }

    @Transactional(readOnly = true)
    public List<String> activeNames() {
        return options.findByActiveTrueOrderBySortOrderAscIdAsc().stream().map(EntryOption::getName).toList();
    }

    /**
     * Replaces the active entry-option list with the given names (admin bulk edit).
     * Names that stay keep their identity; missing names are deactivated (or deleted
     * when unused); new names are created. Returns the resulting active names in order.
     */
    @Transactional
    public java.util.List<String> replaceAll(java.util.List<String> names, UserAccount actor) {
        java.util.List<String> cleaned = new java.util.ArrayList<>();
        for (String raw : names) {
            String name = raw == null ? "" : raw.trim();
            if (name.isEmpty()) {
                continue;
            }
            if (name.length() > 120) {
                throw ApiException.validation("Option names must be 120 characters or fewer.",
                        java.util.List.of(new ApiException.FieldError("options", "Option name is too long.")));
            }
            boolean dup = cleaned.stream().anyMatch(c -> c.equalsIgnoreCase(name));
            if (!dup) {
                cleaned.add(name);
            }
        }
        if (cleaned.isEmpty()) {
            throw ApiException.validation("Keep at least one entry option.",
                    java.util.List.of(new ApiException.FieldError("options", "Keep at least one entry option.")));
        }

        java.util.List<EntryOption> existing = options.findAll();
        java.util.Map<String, EntryOption> byName = new java.util.LinkedHashMap<>();
        for (EntryOption option : existing) {
            byName.put(option.getName().toLowerCase(), option);
        }

        java.util.Set<String> keep = new java.util.HashSet<>();
        for (String name : cleaned) {
            keep.add(name.toLowerCase());
        }

        for (EntryOption option : existing) {
            if (!keep.contains(option.getName().toLowerCase()) && option.isActive()) {
                option.setActive(false);
                options.save(option);
            }
        }

        java.util.List<String> result = new java.util.ArrayList<>();
        for (String name : cleaned) {
            EntryOption match = byName.get(name.toLowerCase());
            if (match == null) {
                EntryOption created = new EntryOption();
                created.setName(name);
                created.setNameNormalized(EntryOption.normalize(name));
                created.setSortOrder(1000 + result.size());
                created.setActive(true);
                options.save(created);
                result.add(created.getName());
            } else {
                if (!match.isActive()) {
                    match.setActive(true);
                    options.save(match);
                }
                if (!match.getName().equals(name)) {
                    match.setName(name);
                    options.save(match);
                }
                result.add(match.getName());
            }
        }

        audit.record("ENTRY_OPTIONS_REPLACED", "EntryOption", null, actor,
                java.util.Map.of("options", String.join(", ", result)));
        return result;
    }

    public SettingsDtos.EntryOptionView create(SettingsDtos.CreateEntryOptionRequest request, UserAccount actor) {
        String name = request.name().trim();
        String normalized = EntryOption.normalize(name);
        if (options.existsByNameNormalized(normalized)) {
            throw ApiException.conflict(ErrorCode.DUPLICATE_RECORD, "An option with this name already exists.");
        }
        int maxOrder = options.findAllByOrderBySortOrderAscIdAsc().stream().mapToInt(EntryOption::getSortOrder).max().orElse(-1);
        EntryOption option = new EntryOption();
        option.setName(name);
        option.setNameNormalized(normalized);
        option.setSortOrder(maxOrder + 1);
        option.setActive(true);
        options.save(option);
        audit.record("ENTRY_OPTION_CREATED", "EntryOption", option.getId(), actor, Map.of("name", name));
        return toView(option);
    }

    @Transactional
    public SettingsDtos.EntryOptionView update(Long id, SettingsDtos.UpdateEntryOptionRequest request, UserAccount actor) {
        EntryOption option = options.findById(id)
                .orElseThrow(() -> ApiException.notFound("Option not found."));
        Map<String, Object> changes = new java.util.HashMap<>();
        if (request.name() != null && !request.name().isBlank()) {
            String name = request.name().trim();
            String normalized = EntryOption.normalize(name);
            if (options.existsByNameNormalizedAndIdNot(normalized, id)) {
                throw ApiException.conflict(ErrorCode.DUPLICATE_RECORD, "An option with this name already exists.");
            }
            if (!name.equals(option.getName())) {
                changes.put("name", Map.of("from", option.getName(), "to", name));
            }
            option.setName(name);
            option.setNameNormalized(normalized);
        }
        if (request.isActive() != null && request.isActive() != option.isActive()) {
            changes.put("isActive", Map.of("from", option.isActive(), "to", request.isActive()));
            option.setActive(request.isActive());
        }
        if (request.sortOrder() != null && request.sortOrder() != option.getSortOrder()) {
            changes.put("sortOrder", Map.of("from", option.getSortOrder(), "to", request.sortOrder()));
            option.setSortOrder(request.sortOrder());
        }
        options.save(option);
        audit.record("ENTRY_OPTION_UPDATED", "EntryOption", id, actor, Map.of("changes", changes));
        return toView(option);
    }

    /**
     * Safe delete: deactivates the option (history keeps working).
     * A hard delete is only allowed when no transaction references it.
     */
    @Transactional
    public SettingsDtos.EntryOptionView deactivate(Long id, UserAccount actor) {
        EntryOption option = options.findById(id)
                .orElseThrow(() -> ApiException.notFound("Option not found."));
        option.setActive(false);
        options.save(option);
        audit.record("ENTRY_OPTION_DEACTIVATED", "EntryOption", id, actor, Map.of("name", option.getName()));
        return toView(option);
    }

    @Transactional
    public void delete(Long id, UserAccount actor) {
        EntryOption option = options.findById(id)
                .orElseThrow(() -> ApiException.notFound("Option not found."));
        long usage = transactions.countByOptionNameIgnoreCase(option.getName());
        if (usage > 0) {
            throw ApiException.conflict(ErrorCode.CONFLICT,
                    "This option is used by " + usage + " entries and cannot be deleted. Deactivate it instead.");
        }
        options.delete(option);
        audit.record("ENTRY_OPTION_DELETED", "EntryOption", id, actor, Map.of("name", option.getName()));
    }

    /** Server-side validation used by transaction creation: only active options are accepted. */
    @Transactional(readOnly = true)
    public String validateActiveOption(String rawName) {
        String name = rawName == null ? "" : rawName.trim();
        if (name.isEmpty()) {
            throw ApiException.unprocessable(ErrorCode.INVALID_ENTRY_OPTION,
                    "Please select a valid option configured by the Administrator.",
                    List.of(new ApiException.FieldError("option", "Select an option from the list set by Admin.")));
        }
        String normalized = EntryOption.normalize(name);
        EntryOption option = options.findByNameNormalized(normalized)
                .orElseThrow(() -> ApiException.unprocessable(ErrorCode.INVALID_ENTRY_OPTION,
                        "Please select a valid option configured by the Administrator.",
                        List.of(new ApiException.FieldError("option", "Select an option from the list set by Admin."))));
        if (!option.isActive()) {
            throw ApiException.unprocessable(ErrorCode.INVALID_ENTRY_OPTION,
                    "This option is no longer active. Please select another option.",
                    List.of(new ApiException.FieldError("option", "This option is inactive.")));
        }
        return option.getName();
    }

    private SettingsDtos.EntryOptionView toView(EntryOption option) {
        long usage = transactions.countByOptionNameIgnoreCase(option.getName());
        return new SettingsDtos.EntryOptionView(option.getId(), option.getName(), option.getSortOrder(), option.isActive(), usage);
    }

    public List<SettingsDtos.EntryOptionView> toViews(List<EntryOption> options) {
        List<SettingsDtos.EntryOptionView> views = new ArrayList<>();
        for (EntryOption option : options) {
            views.add(toView(option));
        }
        return views;
    }
}
