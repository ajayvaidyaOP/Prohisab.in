package com.depositin.erp.service;

import com.depositin.erp.exception.ApiException;
import com.depositin.erp.exception.ErrorCode;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

/**
 * Money parsing/formatting. Never uses floating point: BigDecimal end to end,
 * DECIMAL(15,2) in MySQL, two decimals on the wire.
 */
@Service
public class MoneyService {

    public static final BigDecimal MAX_AMOUNT = new BigDecimal("99999999999.99");
    public static final BigDecimal ZERO = BigDecimal.ZERO.setScale(2, RoundingMode.UNNECESSARY);

    /** Parses "1,500.50" / "1500.5" / "1500" into a 2-decimal BigDecimal. */
    public BigDecimal parsePositive(String raw, String field) {
        BigDecimal value = parse(raw, field, true);
        if (value.signum() <= 0) {
            throw ApiException.unprocessable(ErrorCode.INVALID_AMOUNT,
                    "Amount must be greater than zero.",
                    List.of(new ApiException.FieldError(field, "Amount must be greater than zero.")));
        }
        return value;
    }

    public BigDecimal parse(String raw, String field, boolean required) {
        if (raw == null || raw.isBlank()) {
            if (required) {
                throw ApiException.validation("Please correct the highlighted fields.",
                        List.of(new ApiException.FieldError(field, "Enter an amount.")));
            }
            return null;
        }
        String cleaned = raw.trim().replace(",", "");
        BigDecimal value;
        try {
            value = new BigDecimal(cleaned);
        } catch (NumberFormatException e) {
            throw ApiException.validation("Please correct the highlighted fields.",
                    List.of(new ApiException.FieldError(field, "Enter a valid amount (for example 1500.00).")));
        }
        if (value.scale() > 2) {
            throw ApiException.unprocessable(ErrorCode.INVALID_AMOUNT,
                    "Amounts can have at most two decimals.",
                    List.of(new ApiException.FieldError(field, "Use at most two decimals.")));
        }
        if (value.abs().compareTo(MAX_AMOUNT) > 0) {
            throw ApiException.unprocessable(ErrorCode.INVALID_AMOUNT,
                    "Amount is too large.",
                    List.of(new ApiException.FieldError(field, "Amount is too large.")));
        }
        return value.setScale(2, RoundingMode.UNNECESSARY);
    }

    /** Formats as a plain 2-decimal string ("1500.00"). */
    public String format(BigDecimal value) {
        if (value == null) {
            return "0.00";
        }
        return value.setScale(2, RoundingMode.UNNECESSARY).toPlainString();
    }
}
