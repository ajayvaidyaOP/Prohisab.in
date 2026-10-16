package com.depositin.erp.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.List;

/** Settings and entry-option shapes. */
public final class SettingsDtos {

    private SettingsDtos() {
    }

    public record BusinessView(
            String businessName,
            String businessAddress,
            String businessPhone,
            String businessEmail,
            String currencySymbol,
            String timezone,
            String logoUrl,
            List<String> userEntryOptions,
            String updatedAt) {
    }

    public record SessionView(int idleTimeoutMinutes, int maxSessionHours) {
    }

    public record UserRef(String username) {
    }

    public record SettingsView(BusinessView business, String today, UserRef user, SessionView session) {
    }

    public record ReplaceEntryOptionsRequest(
            @NotNull(message = "Provide the option list.") java.util.List<String> options) {
    }

    public record EntryOptionsBulkResponse(BusinessView business, java.util.List<String> userEntryOptions) {
    }

    public record UpdateSettingsRequest(
            @NotBlank(message = "Business name is required.") @Size(max = 150) String businessName,
            @Size(max = 500) String businessAddress,
            @Size(max = 30) String businessPhone,
            @Size(max = 190) String businessEmail,
            @NotBlank(message = "Currency symbol is required.") @Size(max = 8) String currencySymbol,
            @NotBlank(message = "Timezone is required.") @Size(max = 64) String timezone,
            @Size(max = 500) String logoUrl) {
    }

    public record EntryOptionView(Long id, String name, int sortOrder, boolean isActive, long usageCount) {
    }

    public record EntryOptionListResponse(List<EntryOptionView> items) {
    }

    public record CreateEntryOptionRequest(
            @NotBlank(message = "Option name is required.") @Size(min = 2, max = 120) String name) {
    }

    public record UpdateEntryOptionRequest(
            @Size(min = 2, max = 120) String name,
            Boolean isActive,
            Integer sortOrder) {
    }

    public record EntryOptionResponse(EntryOptionView option) {
    }
}
