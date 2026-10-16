package com.depositin.erp.controller;

import com.depositin.erp.dto.DashboardDtos;
import com.depositin.erp.security.SecurityUtils;
import com.depositin.erp.service.DashboardService;
import com.depositin.erp.service.DateService;
import com.depositin.erp.service.PdfService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.time.LocalDate;

/** Admin dashboard and the All Users Summary PDF. */
@RestController
@RequestMapping("/api/dashboard")
public class DashboardController {

    private final DashboardService dashboard;
    private final PdfService pdf;
    private final DateService dates;

    public DashboardController(DashboardService dashboard, PdfService pdf, DateService dates) {
        this.dashboard = dashboard;
        this.pdf = pdf;
        this.dates = dates;
    }

    @GetMapping
    public DashboardDtos.DashboardData data() {
        SecurityUtils.requireAdmin();
        return dashboard.data();
    }

    @GetMapping("/summary.pdf")
    public ResponseEntity<byte[]> summaryPdf(@RequestParam(required = false) String from,
                                             @RequestParam(required = false) String to,
                                             @RequestParam(required = false) String period) throws IOException {
        SecurityUtils.requireAdmin();
        LocalDate[] range = dates.resolvePeriod(period, from, to);
        byte[] bytes = pdf.allUsersSummaryPdf(range[0], range[1]);
        String filename = "all-users-summary.pdf";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(MediaType.APPLICATION_PDF)
                .body(bytes);
    }
}
