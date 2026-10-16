package com.depositin.erp.exception;

import java.util.List;

/** Error response envelope: {@code {"error": {"code", "message", "details", "requestId"}}}. */
public record ErrorResponse(ErrorBody error) {

    public record ErrorBody(String code, String message, List<ApiException.FieldError> details, String requestId) {
    }

    public static ErrorResponse of(String code, String message, List<ApiException.FieldError> details, String requestId) {
        return new ErrorResponse(new ErrorBody(code, message, details, requestId));
    }
}
