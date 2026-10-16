package com.depositin.erp.service;

import com.depositin.erp.dto.TransactionDtos;
import com.depositin.erp.entity.ApprovalStatus;
import com.depositin.erp.entity.LedgerTransaction;
import com.depositin.erp.entity.TransactionKind;
import com.depositin.erp.entity.UserAccount;
import com.depositin.erp.entity.UserRole;
import com.depositin.erp.repository.LedgerTransactionRepository;
import com.depositin.erp.repository.UserRepository;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.font.PDFont;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.awt.Color;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * PDF reports generated with Apache PDFBox:
 * - Individual user ledger (period totals + date-wise entries)
 * - All users summary (deposits, withdrawals, balance per user)
 */
@Service
public class PdfService {

    private static final float MARGIN = 40f;
    private static final float ROW_HEIGHT = 16f;
    private static final PDFont FONT = PDType1Font.HELVETICA;
    private static final PDFont FONT_BOLD = PDType1Font.HELVETICA_BOLD;

    private final UserRepository users;
    private final LedgerTransactionRepository transactions;
    private final MoneyService money;
    private final DateService dates;

    public PdfService(UserRepository users, LedgerTransactionRepository transactions,
                      MoneyService money, DateService dates) {
        this.users = users;
        this.transactions = transactions;
        this.money = money;
        this.dates = dates;
    }

    /** Individual user ledger PDF. */
    @Transactional(readOnly = true)
    public byte[] userLedgerPdf(Long userId, LocalDate from, LocalDate to) throws IOException {
        UserAccount user = users.findById(userId)
                .orElseThrow(() -> com.depositin.erp.exception.ApiException.notFound("User account not found."));
        List<LedgerTransaction> rows = transactions.ledgerRows(userId, from, to);

        BigDecimal deposits = transactions.sumApprovedByUserAndKind(userId, TransactionKind.DEPOSIT, from, to);
        BigDecimal withdrawals = transactions.sumApprovedByUserAndKind(userId, TransactionKind.WITHDRAWAL, from, to);
        BigDecimal balance = deposits.subtract(withdrawals);
        String period = dates.periodLabel(null, from, to);

        try (PDDocument doc = new PDDocument()) {
            PdfWriter w = new PdfWriter(doc,
                    new String[]{"Date", "Option", "Detail", "Status", "Deposit (+)", "Withdrawal (-)", "Balance"},
                    new float[]{58f, 118f, 112f, 52f, 68f, 72f, 64f});

            w.text(FONT_BOLD, 16, "User Ledger Report");
            w.text(FONT, 11, "User: " + sanitize(user.getName()) + "  (" + user.getAccountCode() + ")");
            w.text(FONT, 11, "Report period: " + period);
            w.text(FONT, 11, "Generated: " + dates.formatInstant(Instant.now()) + " (" + dates.businessZone() + ")");
            w.text(FONT, 11, "Total Deposits (+): " + money.format(deposits)
                    + "    Total Withdrawals (-): " + money.format(withdrawals)
                    + "    Balance: " + money.format(balance));
            w.spacer(8);
            w.startTable();

            BigDecimal running = BigDecimal.ZERO;
            for (LedgerTransaction row : rows) {
                boolean approved = row.getApprovalStatus() == ApprovalStatus.APPROVED;
                if (approved) {
                    running = row.getKind() == TransactionKind.DEPOSIT
                            ? running.add(row.getAmount())
                            : running.subtract(row.getAmount());
                }
                String deposit = row.getKind() == TransactionKind.DEPOSIT ? money.format(row.getAmount()) : "";
                String withdrawal = row.getKind() == TransactionKind.WITHDRAWAL ? money.format(row.getAmount()) : "";
                w.row(
                        row.getEntryDate().toString(),
                        sanitize(row.getOptionName()),
                        sanitize(row.getDetail() == null ? "" : row.getDetail()),
                        row.getApprovalStatus().name(),
                        deposit,
                        withdrawal,
                        money.format(running));
            }
            w.close();
            return toBytes(doc);
        }
    }

    /** All users summary PDF with per-user totals. */
    @Transactional(readOnly = true)
    public byte[] allUsersSummaryPdf(LocalDate from, LocalDate to) throws IOException {
        return allUsersSummaryPdf(from, to, null, null);
    }

    /** Filtered summary PDF matching the dashboard's selected date range, book and staff member. */
    @Transactional(readOnly = true)
    public byte[] allUsersSummaryPdf(LocalDate from, LocalDate to, Long bookId, Long userId) throws IOException {
        List<UserAccount> everyone = new ArrayList<>(users.findByRoleOrderByCreatedAtAsc(UserRole.USER));
        if (userId != null) {
            everyone.removeIf(user -> !user.getId().equals(userId));
        }

        List<Object[]> grouped = transactions.sumApprovedByFiltersGrouped(from, to, bookId, userId);
        Map<Long, BigDecimal> depositMap = new HashMap<>();
        Map<Long, BigDecimal> withdrawalMap = new HashMap<>();
        for (Object[] row : grouped) {
            Long groupedUserId = (Long) row[0];
            TransactionKind kind = (TransactionKind) row[1];
            BigDecimal total = (BigDecimal) row[2];
            if (kind == TransactionKind.DEPOSIT) {
                depositMap.put(groupedUserId, total);
            } else {
                withdrawalMap.put(groupedUserId, total);
            }
        }

        String period = dates.periodLabel(null, from, to);
        BigDecimal grandDeposits = BigDecimal.ZERO;
        BigDecimal grandWithdrawals = BigDecimal.ZERO;

        try (PDDocument doc = new PDDocument()) {
            PdfWriter w = new PdfWriter(doc,
                    new String[]{"User", "Deposits (+)", "Withdrawals (-)", "Balance"},
                    new float[]{245f, 105f, 105f, 105f});

            w.text(FONT_BOLD, 16, userId == null ? "All Users Summary" : "Staff Deposit / Withdrawal Summary");
            w.text(FONT, 11, "Report period: " + period);
            if (bookId != null) {
                w.text(FONT, 11, "Book ID: " + bookId);
            }
            if (userId != null && !everyone.isEmpty()) {
                w.text(FONT, 11, "Staff: " + sanitize(everyone.get(0).getName()) + " (" + everyone.get(0).getAccountCode() + ")");
            }
            w.text(FONT, 11, "Generated: " + dates.formatInstant(Instant.now()) + " (" + dates.businessZone() + ")");
            w.spacer(8);
            w.startTable();

            for (UserAccount user : everyone) {
                BigDecimal dep = depositMap.getOrDefault(user.getId(), BigDecimal.ZERO);
                BigDecimal wit = withdrawalMap.getOrDefault(user.getId(), BigDecimal.ZERO);
                BigDecimal bal = dep.subtract(wit);
                grandDeposits = grandDeposits.add(dep);
                grandWithdrawals = grandWithdrawals.add(wit);
                w.row(sanitize(user.getName()) + " (" + user.getAccountCode() + ")",
                        money.format(dep), money.format(wit), money.format(bal));
            }
            w.rowBold("TOTAL", money.format(grandDeposits), money.format(grandWithdrawals),
                    money.format(grandDeposits.subtract(grandWithdrawals)));
            w.close();
            return toBytes(doc);
        }
    }

    /** Combined staff history PDF with the same filters as the multi-user report. */
    @Transactional(readOnly = true)
    public byte[] multiUserHistoryPdf(List<TransactionDtos.TransactionView> rows, List<Long> userIds,
                                      LocalDate from, LocalDate to, Long bookId) throws IOException {
        String period = dates.periodLabel(null, from, to);
        String staffLabel = "All staff";
        if (userIds != null && !userIds.isEmpty()) {
            staffLabel = users.findAllById(userIds).stream()
                    .filter(user -> user.getRole() == UserRole.USER)
                    .map(user -> sanitize(user.getName()))
                    .collect(java.util.stream.Collectors.joining(", "));
            if (staffLabel.isBlank()) staffLabel = "Selected staff";
        }

        try (PDDocument doc = new PDDocument()) {
            PdfWriter w = new PdfWriter(doc,
                    new String[]{"Entry date", "Staff", "Book", "Type", "Amount", "Status", "Description"},
                    new float[]{58f, 92f, 60f, 54f, 72f, 60f, 119f});
            w.text(FONT_BOLD, 16, "Multi-user History Report");
            w.text(FONT, 11, "Staff: " + staffLabel);
            w.text(FONT, 11, "Report period: " + period);
            if (bookId != null) w.text(FONT, 11, "Book ID: " + bookId);
            w.text(FONT, 11, "Generated: " + dates.formatInstant(Instant.now()) + " (" + dates.businessZone() + ")");
            w.text(FONT, 10, "Entries: " + rows.size());
            w.spacer(8);
            w.startTable();
            for (TransactionDtos.TransactionView row : rows) {
                w.row(
                        sanitize(row.entryDate()),
                        sanitize(row.account() == null ? "" : row.account().name()),
                        sanitize(row.bookName()),
                        sanitize(row.typeLabel()),
                        sanitize(row.amount()),
                        sanitize(row.approvalStatus()),
                        sanitize(row.description()));
            }
            w.close();
            return toBytes(doc);
        }
    }

    private static byte[] toBytes(PDDocument doc) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        doc.save(out);
        return out.toByteArray();
    }

    /** Replaces characters outside Latin-1 (e.g. rupee sign) for PDF core fonts. */
    static String sanitize(String value) {
        if (value == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder(value.length());
        for (char c : value.toCharArray()) {
            if (c == '\u20B9') {
                sb.append("Rs.");
            } else if (c == '\u2014' || c == '\u2013') {
                sb.append('-');
            } else if (c == '\u2018' || c == '\u2019') {
                sb.append('\'');
            } else if (c == '\u201C' || c == '\u201D') {
                sb.append('"');
            } else if (c > 255) {
                sb.append('?');
            } else {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    /** Multi-page text/table renderer on one PDDocument. */
    private static final class PdfWriter {
        final PDDocument doc;
        final String[] headers;
        final float[] widths;
        final float pageHeight = PDRectangle.A4.getHeight();
        final float pageWidth = PDRectangle.A4.getWidth();
        PDPage currentPage;
        PDPageContentStream content;
        float y;
        boolean tableStarted;

        PdfWriter(PDDocument doc, String[] headers, float[] widths) throws IOException {
            this.doc = doc;
            this.headers = headers;
            this.widths = widths;
            newPage();
        }

        private void newPage() throws IOException {
            currentPage = new PDPage(PDRectangle.A4);
            doc.addPage(currentPage);
            content = new PDPageContentStream(doc, currentPage);
            y = pageHeight - MARGIN;
        }

        void text(PDFont font, float size, String text) throws IOException {
            if (y - size - 8 < MARGIN) {
                content.close();
                newPage();
            }
            content.beginText();
            content.setFont(font, size);
            content.newLineAtOffset(MARGIN, y - size);
            content.showText(text);
            content.endText();
            y -= size + 8;
        }

        void spacer(float points) {
            y -= points;
        }

        void startTable() throws IOException {
            tableStarted = true;
            drawRow(headers, true);
        }

        void row(String... cells) throws IOException {
            row(cells, false);
        }

        void rowBold(String... cells) throws IOException {
            row(cells, true);
        }

        void row(String[] cells, boolean bold) throws IOException {
            if (!tableStarted) {
                startTable();
            }
            if (y - ROW_HEIGHT < MARGIN) {
                content.close();
                newPage();
                drawRow(headers, true);
            }
            drawRow(cells, bold);
        }

        void drawRow(String[] cells, boolean bold) throws IOException {
            PDFont font = bold ? FONT_BOLD : FONT;
            float x = MARGIN;
            content.setStrokingColor(Color.LIGHT_GRAY);
            content.moveTo(MARGIN, y + 4);
            content.lineTo(pageWidth - MARGIN, y + 4);
            content.stroke();
            for (int i = 0; i < headers.length; i++) {
                String text = i < cells.length ? cells[i] : "";
                content.beginText();
                content.setFont(font, 8.5f);
                content.newLineAtOffset(x + 2, y - 9);
                content.showText(clip(text, widths[i], font));
                content.endText();
                x += widths[i];
            }
            y -= ROW_HEIGHT;
        }

        void close() throws IOException {
            content.close();
        }

        String clip(String text, float width, PDFont font) throws IOException {
            String value = text == null ? "" : text;
            float maxWidth = width - 4;
            if (font.getStringWidth(value) / 1000f * 8.5f <= maxWidth) {
                return value;
            }
            String ellipsis = "...";
            for (int i = value.length(); i > 0; i--) {
                String candidate = value.substring(0, i) + ellipsis;
                if (font.getStringWidth(candidate) / 1000f * 8.5f <= maxWidth) {
                    return candidate;
                }
            }
            return ellipsis;
        }
    }
}
