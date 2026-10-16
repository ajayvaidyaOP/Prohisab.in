package com.depositin.erp.controller;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

/** Public health check used by monitoring and the VPS setup guide. */
@RestController
@RequestMapping("/api/health")
public class HealthController {

    private final JdbcTemplate jdbcTemplate;

    public HealthController(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @GetMapping
    public Map<String, Object> health() {
        String database = "down";
        try {
            jdbcTemplate.queryForObject("SELECT 1", Integer.class);
            database = "up";
        } catch (Exception ignored) {
            // leave "down"
        }
        return Map.of("status", database.equals("up") ? "ok" : "degraded", "database", database);
    }
}
