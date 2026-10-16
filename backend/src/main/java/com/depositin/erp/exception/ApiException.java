package com.depositin.erp.exception;

import java.util.List;

/** API exception carrying a stable error code and optional field-level details. */
public class ApiException extends RuntimeException {

    private static final long serialVersionUID = 1L;

    private final ErrorCode code;
    private final List<FieldError> details;

    public record FieldError(String field, String message) {
    }

    public ApiException(ErrorCode code, String message) {
        this(code, message, null);
    }

    public ApiException(ErrorCode code, String message, List<FieldError> details) {
        super(message);
        this.code = code;
        this.details = details;
    }

    public ErrorCode getCode() {
        return code;
    }

    public List<FieldError> getDetails() {
        return details;
    }

    public static ApiException badRequest(String message) {
        return new ApiException(ErrorCode.BAD_REQUEST, message);
    }

    public static ApiException validation(String message, List<FieldError> details) {
        return new ApiException(ErrorCode.VALIDATION_FAILED, message, details);
    }

    public static ApiException unauthorized(String message) {
        return new ApiException(ErrorCode.UNAUTHORIZED, message);
    }

    public static ApiException forbidden(String message) {
        return new ApiException(ErrorCode.FORBIDDEN, message);
    }

    public static ApiException notFound(String message) {
        return new ApiException(ErrorCode.NOT_FOUND, message);
    }

    public static ApiException conflict(ErrorCode code, String message) {
        return new ApiException(code, message);
    }

    public static ApiException unprocessable(ErrorCode code, String message, List<FieldError> details) {
        return new ApiException(code, message, details);
    }
}
