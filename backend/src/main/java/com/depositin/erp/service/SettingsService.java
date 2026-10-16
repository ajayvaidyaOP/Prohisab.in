package com.depositin.erp.service;

import com.depositin.erp.config.AppProperties;
import com.depositin.erp.dto.SettingsDtos;
import com.depositin.erp.entity.AppSetting;
import com.depositin.erp.entity.UserAccount;
import com.depositin.erp.repository.AppSettingRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.format.DateTimeFormatter;
import java.util.Map;

/** Application settings (business identity, currency, timezone). */
@Service
public class SettingsService {

    private final AppSettingRepository settings;
    private final EntryOptionService entryOptions;
    private final DateService dates;
    private final AppProperties properties;
    private final AuditService audit;

    public SettingsService(AppSettingRepository settings, EntryOptionService entryOptions,
                           DateService dates, AppProperties properties, AuditService audit) {
        this.settings = settings;
        this.entryOptions = entryOptions;
        this.dates = dates;
        this.properties = properties;
        this.audit = audit;
    }

    @Transactional
    public AppSetting getOrCreate() {
        return settings.findById(1L).orElseGet(() -> {
            AppSetting row = new AppSetting();
            row.setId(1L);
            row.setTimezone(properties.timezone());
            return settings.save(row);
        });
    }

    @Transactional(readOnly = true)
    public SettingsDtos.SettingsView view(String username) {
        AppSetting row = getOrCreate();
        return new SettingsDtos.SettingsView(
                toBusinessView(row),
                dates.today().toString(),
                new SettingsDtos.UserRef(username),
                new SettingsDtos.SessionView(properties.session().idleTimeoutMinutes(), properties.session().maxHours()));
    }

    @Transactional
    public SettingsDtos.BusinessView update(SettingsDtos.UpdateSettingsRequest request, UserAccount actor) {
        AppSetting before = getOrCreate();
        AppSetting row = getOrCreate();
        row.setBusinessName(request.businessName().trim());
        row.setBusinessAddress(emptyToNull(request.businessAddress()));
        row.setBusinessPhone(emptyToNull(request.businessPhone()));
        row.setBusinessEmail(emptyToNull(request.businessEmail()));
        row.setCurrencySymbol(request.currencySymbol().trim());
        row.setTimezone(request.timezone().trim());
        row.setLogoUrl(emptyToNull(request.logoUrl()));
        settings.save(row);
        audit.record("SETTINGS_UPDATED", "AppSetting", 1L, actor, Map.of(
                "businessName", Map.of("from", before.getBusinessName(), "to", row.getBusinessName()),
                "updatedAt", Instant.now().toString()));
        return toBusinessView(row);
    }

    private SettingsDtos.BusinessView toBusinessView(AppSetting row) {
        return new SettingsDtos.BusinessView(
                row.getBusinessName(),
                row.getBusinessAddress(),
                row.getBusinessPhone(),
                row.getBusinessEmail(),
                row.getCurrencySymbol(),
                row.getTimezone(),
                row.getLogoUrl(),
                entryOptions.activeNames(),
                row.getUpdatedAt() == null ? null : DateTimeFormatter.ISO_INSTANT.format(row.getUpdatedAt()));
    }

    private static String emptyToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }
}
