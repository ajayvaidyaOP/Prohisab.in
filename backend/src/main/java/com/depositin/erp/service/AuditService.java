package com.depositin.erp.service;

import com.depositin.erp.entity.UserAccount;
import com.depositin.erp.repository.AuditLogRepository;
import com.depositin.erp.entity.AuditLog;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import com.fasterxml.jackson.databind.ObjectMapper;

import java.util.Map;

/**
 * Writes audit trail entries. Never log passwords, tokens or cookies.
 */
@Service
public class AuditService {

    private static final Logger log = LoggerFactory.getLogger(AuditService.class);

    private final AuditLogRepository auditLogs;
    private final ObjectMapper objectMapper;

    public AuditService(AuditLogRepository auditLogs, ObjectMapper objectMapper) {
        this.auditLogs = auditLogs;
        this.objectMapper = objectMapper;
    }

    public void record(String action, String entityType, Object entityId, UserAccount actor, Map<String, Object> details) {
        try {
            AuditLog entry = new AuditLog();
            entry.setAction(action);
            entry.setEntityType(entityType);
            entry.setEntityId(String.valueOf(entityId));
            entry.setActor(actor);
            if (details != null && !details.isEmpty()) {
                String json = objectMapper.writeValueAsString(details);
                entry.setDetails(json.length() > 2000 ? json.substring(0, 2000) : json);
            }
            auditLogs.save(entry);
        } catch (Exception e) {
            // Audit failures must never break the main flow.
            log.warn("Could not write audit log for action {}: {}", action, e.getMessage());
        }
    }
}
