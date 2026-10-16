package com.depositin.erp.dto;

import java.util.List;

/** Audit log shapes. */
public final class AuditDtos {

    private AuditDtos() {
    }

    public record AuditItem(Long id, String action, String entityType, String entityId, String actor, Object details, String createdAt) {
    }

    public record AuditListResponse(List<AuditItem> items, CommonDtos.Pagination pagination) {
    }
}
