package com.depositin.erp.service;

import com.depositin.erp.config.AppProperties;
import com.depositin.erp.entity.AppSetting;
import com.depositin.erp.repository.AppSettingRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAdjusters;

/**
 * Business date helpers. All "today"/period calculations use the business timezone
 * (Asia/Kolkata by default); timestamps are stored in UTC and rendered in the business zone.
 */
@Service
public class DateService {

    private final AppSettingRepository settings;
    private final AppProperties properties;
    private final Clock clock;

    @org.springframework.beans.factory.annotation.Autowired
    public DateService(AppSettingRepository settings, AppProperties properties) {
        this(settings, properties, Clock.systemUTC());
    }

    public DateService(AppSettingRepository settings, AppProperties properties, Clock clock) {
        this.settings = settings;
        this.properties = properties;
        this.clock = clock;
    }

    public ZoneId businessZone() {
        String tz = properties.timezone();
        try {
            AppSetting row = settings.findById(1L).orElse(null);
            if (row != null && row.getTimezone() != null && !row.getTimezone().isBlank()) {
                tz = row.getTimezone();
            }
        } catch (Exception ignored) {
            // settings table may not exist yet during startup
        }
        try {
            return ZoneId.of(tz);
        } catch (Exception e) {
            return ZoneId.of("Asia/Kolkata");
        }
    }

    public LocalDate today() {
        return LocalDate.now(clock.withZone(businessZone()));
    }

    /** Inclusive date range for period presets. Returns {from, to} with nulls meaning unbounded. */
    public LocalDate[] resolvePeriod(String period, String from, String to) {
        LocalDate today = today();
        if (period != null && !period.isBlank()) {
            switch (period.trim().toLowerCase()) {
                case "this-month":
                    return new LocalDate[]{today.withDayOfMonth(1), today.with(TemporalAdjusters.lastDayOfMonth())};
                case "last-month": {
                    LocalDate firstPrev = today.minusMonths(1).withDayOfMonth(1);
                    return new LocalDate[]{firstPrev, firstPrev.with(TemporalAdjusters.lastDayOfMonth())};
                }
                case "all-time":
                case "all":
                    return new LocalDate[]{null, null};
                default:
                    break;
            }
        }
        LocalDate fromDate = parseDate(from);
        LocalDate toDate = parseDate(to);
        return new LocalDate[]{fromDate, toDate};
    }

    public LocalDate parseDate(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return LocalDate.parse(value.trim(), DateTimeFormatter.ISO_LOCAL_DATE);
    }

    public String periodLabel(String period, LocalDate from, LocalDate to) {
        if (period != null && !period.isBlank()) {
            switch (period.trim().toLowerCase()) {
                case "this-month":
                    return "This Month (" + today().format(DateTimeFormatter.ofPattern("MMMM yyyy", java.util.Locale.ENGLISH)) + ")";
                case "last-month":
                    return "Last Month (" + today().minusMonths(1).format(DateTimeFormatter.ofPattern("MMMM yyyy", java.util.Locale.ENGLISH)) + ")";
                case "all-time":
                case "all":
                    return "All Time";
                default:
                    break;
            }
        }
        if (from == null && to == null) {
            return "All Time";
        }
        String fromText = from == null ? "Beginning" : from.toString();
        String toText = to == null ? "Today" : to.toString();
        return fromText + " to " + toText;
    }

    public String formatInstant(java.time.Instant instant) {
        if (instant == null) {
            return null;
        }
        return instant.atZone(businessZone()).format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")) ;
    }
}
