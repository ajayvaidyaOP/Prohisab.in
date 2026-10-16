package com.depositin.erp.controller;

import com.depositin.erp.dto.LedgerDtos;
import com.depositin.erp.entity.LedgerTransaction;
import com.depositin.erp.entity.TransactionKind;
import com.depositin.erp.exception.ApiException;
import com.depositin.erp.repository.LedgerTransactionRepository;
import com.depositin.erp.security.CurrentUser;
import com.depositin.erp.security.SecurityUtils;
import com.depositin.erp.service.DateService;
import com.depositin.erp.service.LedgerService;
import com.depositin.erp.service.MoneyService;
import com.depositin.erp.service.PdfService;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.math.BigDecimal;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.List;

/**
 * Per-user ledger views. The ledger and statement are visible to the owner and
 * to ADMIN; PDF/CSV exports are ADMIN-only.
 */
@RestController
@RequestMapping("/api/accounts")
public class LedgerController {

    private final LedgerService ledger;
    private final PdfService pdf;
    private final LedgerTransactionRepository transactions;
    private final DateService dates;
    private final MoneyService money;

    public LedgerController(LedgerService ledger, PdfService pdf, LedgerTransactionRepository transactions,
                            DateService dates, MoneyService money) {
        this.ledger = ledger;
        this.pdf = pdf;
        this.transactions = transactions;
        this.dates = dates;
        this.money = money;
    }

    @GetMapping("/{id}/ledger")
    public LedgerDtos.LedgerResponse ledger(@PathVariable Long id,
                                            @RequestParam(required = false) String from,
                                            @RequestParam(required = false) String to,
                                            @RequestParam(required = false) String search,
                                            @RequestParam(defaultValue = "1") int page,
                                            @RequestParam(defaultValue = "25") int pageSize) {
        CurrentUser viewer = SecurityUtils.requireUser();
        return ledger.ledgerPage(id, from, to, search, page, Math.min(Math.max(1, pageSize), 200), viewer);
    }

    @GetMapping("/{id}/statement")
    public LedgerDtos.StatementResponse statement(@PathVariable Long id,
                                                  @RequestParam(required = false) String from,
                                                  @RequestParam(required = false) String to,
                                                  @RequestParam(required = false) String search) {
        CurrentUser viewer = SecurityUtils.requireUser();
        return ledger.statement(id, from, to, search, viewer);
    }

    @GetMapping("/{id}/ledger.pdf")
    public ResponseEntity<byte[]> ledgerPdf(@PathVariable Long id,
                                            @RequestParam(required = false) String from,
                                            @RequestParam(required = false) String to,
                                            @RequestParam(required = false) String period) throws IOException {
        CurrentUser admin = SecurityUtils.requireAdmin();
        LocalDate[] range = dates.resolvePeriod(period, from, to);
        byte[] bytes = pdf.userLedgerPdf(id, range[0], range[1]);
        String filename = "ledger-user-" + id + ".pdf";
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                .contentType(MediaType.APPLICATION_PDF)
                .body(bytes);
    }

    @GetMapping("/{id}/ledger.csv")
    public ResponseEntity<byte[]> ledgerCsv(@PathVariable Long id,
                                            @RequestParam(required = false) String from,
                                            @RequestParam(required = false) String to) {
        SecurityUtils.requireAdmin();
        LocalDate fromDate = dates.parseDate(from);
        LocalDate toDate = dates.parseDate(to);
        List<LedgerTransaction> rows = transactions.ledgerRows(id, fromDate, toDate);
        StringBuilder sb = new StringBuilder("Date,Type,Option,Detail,Amount,Status,Balance\n");
        BigDecimal running = BigDecimal.ZERO;
        for (LedgerTransaction row : rows) {
            if (row.getApprovalStatus() == com.depositin.erp.entity.ApprovalStatus.APPROVED) {
                running = row.getKind() == TransactionKind.DEPOSIT
                        ? running.add(row.getAmount()) : running.subtract(row.getAmount());
            }
            sb.append(csv(row.getEntryDate().toString())).append(',')
                    .append(csv(row.getKind() == TransactionKind.DEPOSIT ? "Deposit" : "Withdrawal")).append(',')
                    .append(csv(row.getOptionName())).append(',')
                    .append(csv(row.getDetail())).append(',')
                    .append(csv(money.format(row.getAmount()))).append(',')
                    .append(csv(row.getApprovalStatus().name())).append(',')
                    .append(csv(money.format(running))).append('\n');
        }
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"ledger-user-" + id + ".csv\"")
                .contentType(MediaType.parseMediaType("text/csv;charset=UTF-8"))
                .body(sb.toString().getBytes(StandardCharsets.UTF_8));
    }

    private static String csv(String value) {
        if (value == null) {
            return "";
        }
        String escaped = value.replace("\"", "\"\"");
        return "\"" + escaped + "\"";
    }
}
