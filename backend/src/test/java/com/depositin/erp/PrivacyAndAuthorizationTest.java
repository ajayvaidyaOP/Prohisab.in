package com.depositin.erp;

import com.depositin.erp.support.ApiTestBase;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

import java.nio.charset.StandardCharsets;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Privacy + authorization: USER isolation, password control, admin-only PDFs.
 */
class PrivacyAndAuthorizationTest extends ApiTestBase {

    private record Fixture(CookieSession admin, CookieSession userA, String idA, CookieSession userB, String idB) {
    }

    private Fixture twoUsers() throws Exception {
        CookieSession admin = login("admin", "AdminPass123");
        String nameA = uniqueName("Alice");
        String idA = createUser(nameA, "secret123", admin);
        CookieSession userA = login(nameA, "secret123");
        String nameB = uniqueName("Bob");
        String idB = createUser(nameB, "secret123", admin);
        CookieSession userB = login(nameB, "secret123");
        return new Fixture(admin, userA, idA, userB, idB);
    }

    @Test
    void userCannotListOtherUsers() throws Exception {
        Fixture f = twoUsers();
        mockMvc.perform(authed(f.userA, get("/api/accounts")))
                .andExpect(status().isForbidden());
    }

    @Test
    void userCannotAccessAnotherUsersLedger() throws Exception {
        Fixture f = twoUsers();
        mockMvc.perform(authed(f.userA, get("/api/accounts/" + f.idB + "/ledger")))
                .andExpect(status().isForbidden());
    }

    @Test
    void userCanAccessOwnLedger() throws Exception {
        Fixture f = twoUsers();
        mockMvc.perform(authed(f.userA, get("/api/accounts/" + f.idA + "/ledger")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.account.id").value(Long.parseLong(f.idA)));
    }

    @Test
    void userCannotOpenDashboard() throws Exception {
        Fixture f = twoUsers();
        mockMvc.perform(authed(f.userA, get("/api/dashboard")))
                .andExpect(status().isForbidden());
    }

    @Test
    void userCannotChangeOwnPassword() throws Exception {
        Fixture f = twoUsers();
        mockMvc.perform(authed(f.userA, post("/api/auth/change-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"currentPassword\":\"secret123\",\"newPassword\":\"newSecret123\"}")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.error.code").value("PASSWORD_CHANGE_DISABLED"));
    }

    @Test
    void adminCanResetUserPasswordImmediately() throws Exception {
        Fixture f = twoUsers();
        mockMvc.perform(authed(f.admin, post("/api/accounts/" + f.idA + "/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"newPassword\":\"resetPass1\",\"confirmPassword\":\"resetPass1\"}")))
                .andExpect(status().isNoContent());

        // Old password no longer works.
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Requested-With", "XMLHttpRequest")
                        .content("{\"username\":\"" + f.userA.user().get("username").asText() + "\",\"password\":\"secret123\"}"))
                .andExpect(status().isUnauthorized());

        // New password works immediately.
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Requested-With", "XMLHttpRequest")
                        .content("{\"username\":\"" + f.userA.user().get("username").asText() + "\",\"password\":\"resetPass1\"}"))
                .andExpect(status().isOk());
    }

    @Test
    void passwordResetConfirmationMustMatch() throws Exception {
        Fixture f = twoUsers();
        mockMvc.perform(authed(f.admin, post("/api/accounts/" + f.idA + "/reset-password")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"newPassword\":\"resetPass1\",\"confirmPassword\":\"different\"}")))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error.code").value("VALIDATION_FAILED"));
    }

    @Test
    void pdfEndpointsAreAdminOnly() throws Exception {
        Fixture f = twoUsers();
        mockMvc.perform(authed(f.userA, get("/api/accounts/" + f.idA + "/ledger.pdf")))
                .andExpect(status().isForbidden());
        mockMvc.perform(authed(f.userA, get("/api/dashboard/summary.pdf")))
                .andExpect(status().isForbidden());
    }

    @Test
    void adminLedgerPdfIsValidPdf() throws Exception {
        Fixture f = twoUsers();
        MvcResult result = mockMvc.perform(authed(f.admin, get("/api/accounts/" + f.idA + "/ledger.pdf")))
                .andExpect(status().isOk())
                .andReturn();
        byte[] body = result.getResponse().getContentAsByteArray();
        assertThat(body.length).isGreaterThan(100);
        assertThat(new String(body, 0, 4, StandardCharsets.US_ASCII)).isEqualTo("%PDF");
    }

    @Test
    void adminSummaryPdfIsValidPdfWithPeriodFilter() throws Exception {
        Fixture f = twoUsers();
        MvcResult result = mockMvc.perform(authed(f.admin, get("/api/dashboard/summary.pdf?period=this-month")))
                .andExpect(status().isOk())
                .andReturn();
        byte[] body = result.getResponse().getContentAsByteArray();
        assertThat(body.length).isGreaterThan(100);
        assertThat(new String(body, 0, 4, StandardCharsets.US_ASCII)).isEqualTo("%PDF");
    }

    @Test
    void userCannotSeeAuditLogs() throws Exception {
        Fixture f = twoUsers();
        mockMvc.perform(authed(f.userA, get("/api/audit-logs")))
                .andExpect(status().isForbidden());
    }

    @Test
    void userCannotManageEntryOptions() throws Exception {
        Fixture f = twoUsers();
        mockMvc.perform(authed(f.userA, post("/api/settings/entry-options")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Sneaky Option\"}")))
                .andExpect(status().isForbidden());
    }

    @Test
    void userCanReadActiveEntryOptions() throws Exception {
        Fixture f = twoUsers();
        mockMvc.perform(authed(f.userA, get("/api/settings/entry-options")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items").isArray());
    }

    @Test
    void userCannotPostToAnotherUsersLedger() throws Exception {
        Fixture f = twoUsers();
        mockMvc.perform(authed(f.userA, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.idB
                                + ",\"type\":\"DEPOSIT\",\"entryDate\":\"2026-10-01\",\"amount\":\"10.00\","
                                + "\"option\":\"Cash Deposit\",\"detail\":\"\"}")))
                .andExpect(status().isForbidden());
    }

    @Test
    void deactivatedUserCannotLogin() throws Exception {
        CookieSession admin = login("admin", "AdminPass123");
        String name = uniqueName("Deactivated");
        String id = createUser(name, "secret123", admin);

        mockMvc.perform(authed(admin, patch("/api/accounts/" + id + "/status")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"isActive\":false}")))
                .andExpect(status().isOk());

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Requested-With", "XMLHttpRequest")
                        .content("{\"username\":\"" + name + "\",\"password\":\"secret123\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void adminSeesUsersOverviewOnDashboard() throws Exception {
        Fixture f = twoUsers();
        mockMvc.perform(authed(f.admin, get("/api/dashboard")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.usersOverview").isArray())
                .andExpect(jsonPath("$.userLedgerTotals").exists());
    }

    @Test
    void userCannotReverseEntries() throws Exception {
        Fixture f = twoUsers();
        // Create + approve one entry so there is something to reverse.
        MvcResult created = mockMvc.perform(authed(f.admin, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.idA
                                + ",\"type\":\"DEPOSIT\",\"entryDate\":\"2026-10-10\""
                                + ",\"amount\":\"100.00\",\"option\":\"Cash Deposit\"}")))
                .andReturn();
        long id = readJson(created).get("transaction").get("id").asLong();
        mockMvc.perform(authed(f.userA, post("/api/transactions/" + id + "/reversal")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"nope\"}")))
                .andExpect(status().isForbidden());
    }

    @Test
    void entryOptionsBulkReplaceIsAdminOnly() throws Exception {
        Fixture f = twoUsers();
        mockMvc.perform(authed(f.userA, put("/api/settings/entry-options")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"options\":[\"Cash Deposit\",\"Site Material\"]}")))
                .andExpect(status().isForbidden());
        mockMvc.perform(authed(f.admin, put("/api/settings/entry-options")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"options\":[\"Cash Deposit\",\"Custom Option\"]}")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userEntryOptions[0]").value("Cash Deposit"))
                .andExpect(jsonPath("$.userEntryOptions[1]").value("Custom Option"));
        // New option is accepted when creating an entry.
        mockMvc.perform(authed(f.userA, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.idA
                                + ",\"type\":\"DEPOSIT\",\"entryDate\":\"2026-10-10\""
                                + ",\"amount\":\"10.00\",\"option\":\"Custom Option\"}")))
                .andExpect(status().isCreated());
    }
}
