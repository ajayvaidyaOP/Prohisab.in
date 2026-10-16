package com.depositin.erp.controller;

import com.depositin.erp.dto.AuditDtos;
import com.depositin.erp.dto.CommonDtos;
import com.depositin.erp.entity.AuditLog;
import com.depositin.erp.security.SecurityUtils;
import com.depositin.erp.repository.AuditLogRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.format.DateTimeFormatter;

/** Audit log viewer (ADMIN only). */
@RestController
@RequestMapping("/api/audit-logs")
public class AuditController {

    private final AuditLogRepository auditLogs;
    private final ObjectMapper objectMapper;

    public AuditController(AuditLogRepository auditLogs, ObjectMapper objectMapper) {
        this.auditLogs = auditLogs;
        this.objectMapper = objectMapper;
    }

    @GetMapping
    public AuditDtos.AuditListResponse list(@RequestParam(required = false) String entityType,
                                            @RequestParam(defaultValue = "1") int page,
                                            @RequestParam(defaultValue = "25") int pageSize) {
        SecurityUtils.requireAdmin();
        Page<AuditLog> result = auditLogs.search(entityType,
                PageRequest.of(Math.max(0, page - 1), Math.min(Math.max(1, pageSize), 100)));
        return new AuditDtos.AuditListResponse(
                result.getContent().stream().map(this::toView).toList(),
                new CommonDtos.Pagination(result.getNumber() + 1, result.getSize(), result.getTotalElements(), result.getTotalPages()));
    }

    private AuditDtos.AuditItem toView(AuditLog log) {
        Object details = null;
        if (log.getDetails() != null && !log.getDetails().isBlank()) {
            try {
                details = objectMapper.readValue(log.getDetails(), Object.class);
            } catch (Exception e) {
                details = log.getDetails();
            }
        }
        return new AuditDtos.AuditItem(
                log.getId(),
                log.getAction(),
                log.getEntityType(),
                log.getEntityId(),
                log.getActor() == null ? null : log.getActor().getName(),
                details,
                log.getCreatedAt() == null ? null : DateTimeFormatter.ISO_INSTANT.format(log.getCreatedAt()));
    }
}
