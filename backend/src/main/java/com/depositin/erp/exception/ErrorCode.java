package com.depositin.erp.exception;

import org.springframework.http.HttpStatus;

/** Stable API error codes (see docs/API.md). */
public enum ErrorCode {
    VALIDATION_FAILED(HttpStatus.BAD_REQUEST),
    BAD_REQUEST(HttpStatus.BAD_REQUEST),
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED),
    FORBIDDEN(HttpStatus.FORBIDDEN),
    NOT_FOUND(HttpStatus.NOT_FOUND),
    DUPLICATE_RECORD(HttpStatus.CONFLICT),
    ALREADY_APPROVED(HttpStatus.OK),
    ALREADY_REJECTED(HttpStatus.CONFLICT),
    CONFLICT(HttpStatus.CONFLICT),
    ACCOUNT_INACTIVE(HttpStatus.UNPROCESSABLE_ENTITY),
    INVALID_ENTRY_OPTION(HttpStatus.UNPROCESSABLE_ENTITY),
    FUTURE_DATE(HttpStatus.UNPROCESSABLE_ENTITY),
    INVALID_AMOUNT(HttpStatus.UNPROCESSABLE_ENTITY),
    PASSWORD_CHANGE_DISABLED(HttpStatus.FORBIDDEN),
    PASSWORD_TOO_WEAK(HttpStatus.UNPROCESSABLE_ENTITY),
    TOO_MANY_REQUESTS(HttpStatus.TOO_MANY_REQUESTS),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR);

    private final HttpStatus status;

    ErrorCode(HttpStatus status) {
        this.status = status;
    }

    public HttpStatus status() {
        return status;
    }
}
