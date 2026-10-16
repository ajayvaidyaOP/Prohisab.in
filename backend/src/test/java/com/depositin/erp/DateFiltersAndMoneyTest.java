package com.depositin.erp;

import com.depositin.erp.service.MoneyService;
import com.depositin.erp.service.TransactionService;
import com.depositin.erp.entity.TransactionKind;
import com.depositin.erp.support.ApiTestBase;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Date filtering (This Month / Last Month / All Time) and money parsing rules.
 */
class DateFiltersAndMoneyTest extends ApiTestBase {

    @Test
    void ledgerSupportsDateRangeFilters() throws Exception {
        CookieSession admin = login("admin", "AdminPass123");
        String name = uniqueName("DateFilter");
        String userId = createUser(name, "secret123", admin);

        // One entry in the previous month and one in this month.
        LocalDate today = LocalDate.now(ZoneId.of("Asia/Kolkata"));
        LocalDate lastMonth = today.minusMonths(1).withDayOfMonth(10);
        LocalDate thisMonth = today.withDayOfMonth(Math.min(5, today.getDayOfMonth()));

        for (LocalDate date : new LocalDate[]{lastMonth, thisMonth}) {
            MvcResult created = mockMvc.perform(authed(admin, post("/api/transactions")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"accountId\":" + userId
                                    + ",\"type\":\"DEPOSIT\",\"entryDate\":\"" + date + "\",\"amount\":\"100.00\","
                                    + "\"option\":\"Cash Deposit\",\"detail\":\"\"}")))
                    .andExpect(status().isCreated())
                    .andReturn();
            long id = readJson(created).get("transaction").get("id").asLong();
            mockMvc.perform(authed(admin, post("/api/transactions/" + id + "/approve")))
                    .andExpect(status().isOk());
        }

        // All time: both entries.
        mockMvc.perform(authed(admin, get("/api/accounts/" + userId + "/ledger?from=&to=")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totals.entryCount").value(2));

        // This month only.
        String monthStart = today.withDayOfMonth(1).toString();
        String monthEnd = today.withDayOfMonth(today.lengthOfMonth()).toString();
        mockMvc.perform(authed(admin, get("/api/accounts/" + userId + "/ledger?from=" + monthStart + "&to=" + monthEnd)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totals.entryCount").value(1));

        // Last month only.
        String lastStart = today.minusMonths(1).withDayOfMonth(1).toString();
        String lastEnd = today.minusMonths(1).withDayOfMonth(today.minusMonths(1).lengthOfMonth()).toString();
        mockMvc.perform(authed(admin, get("/api/accounts/" + userId + "/ledger?from=" + lastStart + "&to=" + lastEnd)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totals.entryCount").value(1));
    }

    @Test
    void pdfAcceptsPeriodPresets() throws Exception {
        CookieSession admin = login("admin", "AdminPass123");
        for (String period : new String[]{"this-month", "last-month", "all-time"}) {
            mockMvc.perform(authed(admin, get("/api/accounts/1/ledger.pdf?period=" + period)))
                    .andExpect(status().isOk());
        }
        for (String period : new String[]{"this-month", "last-month", "all-time"}) {
            mockMvc.perform(authed(admin, get("/api/dashboard/summary.pdf?period=" + period)))
                    .andExpect(status().isOk());
        }
    }

    @Test
    void moneyParsingRules() {
        MoneyService money = new MoneyService();
        assertThat(money.parsePositive("1,500.50", "amount")).isEqualByComparingTo(new BigDecimal("1500.50"));
        assertThat(money.parsePositive("250", "amount")).isEqualByComparingTo(new BigDecimal("250.00"));
        assertThat(money.format(new BigDecimal("10.5"))).isEqualTo("10.50");
        assertThatThrownBy(() -> money.parsePositive("0", "amount")).hasMessageContaining("greater than zero");
        assertThatThrownBy(() -> money.parsePositive("-5", "amount")).hasMessageContaining("greater than zero");
        assertThatThrownBy(() -> money.parsePositive("10.999", "amount")).hasMessageContaining("two decimals");
    }

    @Test
    void legacyTypeNamesMapToSimpleKinds() {
        assertThat(TransactionService.parseKind("DEPOSIT")).isEqualTo(TransactionKind.DEPOSIT);
        assertThat(TransactionService.parseKind("WITHDRAWAL")).isEqualTo(TransactionKind.WITHDRAWAL);
        assertThat(TransactionService.parseKind("CREDIT_SALE")).isEqualTo(TransactionKind.DEPOSIT);
        assertThat(TransactionService.parseKind("PAYMENT_RECEIVED")).isEqualTo(TransactionKind.WITHDRAWAL);
        assertThatThrownBy(() -> TransactionService.parseKind("SOMETHING_ELSE")).isInstanceOf(RuntimeException.class);
    }

    @Test
    void healthEndpointIsPublic() throws Exception {
        mockMvc.perform(get("/api/health"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.database").value("up"));
    }

    @Test
    void validationErrorsCarryFieldDetails() throws Exception {
        CookieSession admin = login("admin", "AdminPass123");
        mockMvc.perform(authed(admin, post("/api/accounts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"x\"}")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.error.details").isArray());
    }

    @Test
    void transactionListFiltersByStatus() throws Exception {
        CookieSession admin = login("admin", "AdminPass123");
        String name = uniqueName("ListFilter");
        String userId = createUser(name, "secret123", admin);

        mockMvc.perform(authed(admin, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + userId
                                + ",\"type\":\"DEPOSIT\",\"entryDate\":\"2026-09-01\",\"amount\":\"10.00\","
                                + "\"option\":\"Cash Deposit\",\"detail\":\"\"}")))
                .andExpect(status().isCreated());

        mockMvc.perform(authed(admin, get("/api/transactions").param("approvalStatus", "PENDING")))
                .andExpect(status().isOk());
    }
}
