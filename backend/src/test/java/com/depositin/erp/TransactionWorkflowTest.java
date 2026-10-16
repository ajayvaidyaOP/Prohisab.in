package com.depositin.erp;

import com.depositin.erp.support.ApiTestBase;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

import java.math.BigDecimal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Deposit/withdrawal workflow: PENDING start for USER, option validation,
 * balance effects of PENDING/APPROVED/REJECTED, and single-decision approval.
 */
class TransactionWorkflowTest extends ApiTestBase {

    private record Fixture(CookieSession admin, CookieSession user, String userId) {
    }

    private Fixture newFixture(String prefix) throws Exception {
        CookieSession admin = login("admin", "AdminPass123");
        String name = uniqueName(prefix);
        String userId = createUser(name, "secret123", admin);
        CookieSession user = login(name, "secret123");
        return new Fixture(admin, user, userId);
    }

    private BigDecimal balanceOf(Fixture f) throws Exception {
        MvcResult result = mockMvc.perform(authed(f.admin, get("/api/accounts/" + f.userId)))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode account = readJson(result).get("account");
        return new BigDecimal(account.get("pendingBalance").asText());
    }

    private int createEntry(Fixture f, String kind, String amount, String option, String detail) throws Exception {
        MvcResult result = mockMvc.perform(authed(f.user, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.userId
                                + ",\"type\":\"" + kind
                                + "\",\"entryDate\":\"" + java.time.LocalDate.now(java.time.ZoneId.of("Asia/Kolkata"))
                                + "\",\"amount\":\"" + amount
                                + "\",\"option\":\"" + option
                                + "\",\"detail\":\"" + (detail == null ? "" : detail) + "\"}")))
                .andReturn();
        return result.getResponse().getStatus();
    }

    @Test
    void depositRequestStartsPending() throws Exception {
        Fixture f = newFixture("DepPending");
        MvcResult result = mockMvc.perform(authed(f.user, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.userId
                                + ",\"type\":\"DEPOSIT\",\"entryDate\":\"2026-10-01\",\"amount\":\"1500.00\","
                                + "\"option\":\"Cash Deposit\",\"detail\":\"October payment\"}")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.transaction.approvalStatus").value("PENDING"))
                .andExpect(jsonPath("$.transaction.type").value("DEPOSIT"))
                .andExpect(jsonPath("$.transaction.description").value("Cash Deposit — October payment"))
                .andReturn();
        long id = readJson(result).get("transaction").get("id").asLong();
        assertThat(id).isPositive();
    }

    @Test
    void withdrawalRequestStartsPending() throws Exception {
        Fixture f = newFixture("WitPending");
        mockMvc.perform(authed(f.user, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.userId
                                + ",\"type\":\"WITHDRAWAL\",\"entryDate\":\"2026-10-01\",\"amount\":\"250.50\","
                                + "\"option\":\"Cash Withdrawal\",\"detail\":\"\"}")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.transaction.approvalStatus").value("PENDING"))
                .andExpect(jsonPath("$.transaction.type").value("WITHDRAWAL"));
    }

    @Test
    void invalidOptionIsRejected() throws Exception {
        Fixture f = newFixture("BadOption");
        mockMvc.perform(authed(f.user, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.userId
                                + ",\"type\":\"DEPOSIT\",\"entryDate\":\"2026-10-01\",\"amount\":\"100.00\","
                                + "\"option\":\"Not An Admin Option\",\"detail\":\"\"}")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("INVALID_ENTRY_OPTION"));
    }

    @Test
    void inactiveOptionIsRejected() throws Exception {
        Fixture f = newFixture("InactiveOpt");
        // Create a fresh option then deactivate it.
        MvcResult created = mockMvc.perform(authed(f.admin, post("/api/settings/entry-options")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"" + uniqueName("TempOpt") + "\"}")))
                .andExpect(status().isCreated())
                .andReturn();
        JsonNode option = readJson(created).get("option");
        String optionName = option.get("name").asText();
        long optionId = option.get("id").asLong();

        mockMvc.perform(authed(f.admin, post("/api/settings/entry-options/" + optionId + "/deactivate")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.option.isActive").value(false));

        mockMvc.perform(authed(f.user, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.userId
                                + ",\"type\":\"DEPOSIT\",\"entryDate\":\"2026-10-01\",\"amount\":\"100.00\","
                                + "\"option\":\"" + optionName + "\",\"detail\":\"\"}")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("INVALID_ENTRY_OPTION"));
    }

    @Test
    void pendingEntryDoesNotAffectBalance() throws Exception {
        Fixture f = newFixture("PendingNoBal");
        BigDecimal before = balanceOf(f);
        createEntry(f, "DEPOSIT", "1000.00", "Cash Deposit", "");
        BigDecimal after = balanceOf(f);
        assertThat(after).isEqualByComparingTo(before);
    }

    @Test
    void approvedEntryAffectsBalanceExactlyOnce() throws Exception {
        Fixture f = newFixture("ApproveOnce");
        BigDecimal before = balanceOf(f);
        MvcResult created = mockMvc.perform(authed(f.user, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.userId
                                + ",\"type\":\"DEPOSIT\",\"entryDate\":\"2026-10-01\",\"amount\":\"1000.00\","
                                + "\"option\":\"Cash Deposit\",\"detail\":\"\"}")))
                .andExpect(status().isCreated())
                .andReturn();
        long id = readJson(created).get("transaction").get("id").asLong();

        mockMvc.perform(authed(f.admin, post("/api/transactions/" + id + "/approve")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.transaction.approvalStatus").value("APPROVED"))
                .andExpect(jsonPath("$.alreadyApproved").value(false));

        BigDecimal after = balanceOf(f);
        assertThat(after).isEqualByComparingTo(before.add(new BigDecimal("1000.00")));

        // Second approval must not change the balance again.
        mockMvc.perform(authed(f.admin, post("/api/transactions/" + id + "/approve")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.alreadyApproved").value(true));
        assertThat(balanceOf(f)).isEqualByComparingTo(after);
    }

    @Test
    void rejectedEntryDoesNotAffectBalance() throws Exception {
        Fixture f = newFixture("RejectNoBal");
        BigDecimal before = balanceOf(f);
        MvcResult created = mockMvc.perform(authed(f.user, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.userId
                                + ",\"type\":\"DEPOSIT\",\"entryDate\":\"2026-10-01\",\"amount\":\"750.00\","
                                + "\"option\":\"Cash Deposit\",\"detail\":\"\"}")))
                .andExpect(status().isCreated())
                .andReturn();
        long id = readJson(created).get("transaction").get("id").asLong();

        mockMvc.perform(authed(f.admin, post("/api/transactions/" + id + "/reject")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"Duplicate request\"}")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.transaction.approvalStatus").value("REJECTED"));

        assertThat(balanceOf(f)).isEqualByComparingTo(before);
    }

    @Test
    void approveAfterRejectIsBlocked() throws Exception {
        Fixture f = newFixture("ApproveAfterReject");
        MvcResult created = mockMvc.perform(authed(f.user, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.userId
                                + ",\"type\":\"DEPOSIT\",\"entryDate\":\"2026-10-01\",\"amount\":\"100.00\","
                                + "\"option\":\"Cash Deposit\",\"detail\":\"\"}")))
                .andExpect(status().isCreated())
                .andReturn();
        long id = readJson(created).get("transaction").get("id").asLong();

        mockMvc.perform(authed(f.admin, post("/api/transactions/" + id + "/reject")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"No\"}")))
                .andExpect(status().isOk());

        mockMvc.perform(authed(f.admin, post("/api/transactions/" + id + "/approve")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("ALREADY_REJECTED"));
    }

    @Test
    void concurrentDuplicateApprovalIsBlocked() throws Exception {
        Fixture f = newFixture("Concurrent");
        MvcResult created = mockMvc.perform(authed(f.user, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.userId
                                + ",\"type\":\"DEPOSIT\",\"entryDate\":\"2026-10-01\",\"amount\":\"500.00\","
                                + "\"option\":\"Cash Deposit\",\"detail\":\"\"}")))
                .andExpect(status().isCreated())
                .andReturn();
        long id = readJson(created).get("transaction").get("id").asLong();

        // Two approvals racing: exactly one performs the transition.
        final int[] decided = {0, 0};
        Runnable approve = () -> {
            try {
                MvcResult result = mockMvc.perform(authed(f.admin, post("/api/transactions/" + id + "/approve"))).andReturn();
                JsonNode body = readJson(result);
                if (result.getResponse().getStatus() == 200 && body.has("alreadyApproved")
                        && !body.get("alreadyApproved").asBoolean()) {
                    decided[0]++;
                } else {
                    decided[1]++;
                }
            } catch (Exception e) {
                decided[1]++;
            }
        };
        Thread t1 = new Thread(approve);
        Thread t2 = new Thread(approve);
        t1.start();
        t2.start();
        t1.join(15_000);
        t2.join(15_000);

        assertThat(decided[0]).as("exactly one approval must perform the transition").isEqualTo(1);
        BigDecimal expected = new BigDecimal("500.00");
        assertThat(balanceOf(f)).isEqualByComparingTo(expected);
    }

    @Test
    void zeroAndNegativeAmountsAreRejected() throws Exception {
        Fixture f = newFixture("BadAmount");
        mockMvc.perform(authed(f.user, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.userId
                                + ",\"type\":\"DEPOSIT\",\"entryDate\":\"2026-10-01\",\"amount\":\"0\","
                                + "\"option\":\"Cash Deposit\",\"detail\":\"\"}")))
                .andExpect(status().isUnprocessableEntity());

        mockMvc.perform(authed(f.user, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.userId
                                + ",\"type\":\"DEPOSIT\",\"entryDate\":\"2026-10-01\",\"amount\":\"-5\","
                                + "\"option\":\"Cash Deposit\",\"detail\":\"\"}")))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    void futureDateIsRejected() throws Exception {
        Fixture f = newFixture("FutureDate");
        mockMvc.perform(authed(f.user, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.userId
                                + ",\"type\":\"DEPOSIT\",\"entryDate\":\"2099-01-01\",\"amount\":\"10.00\","
                                + "\"option\":\"Cash Deposit\",\"detail\":\"\"}")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("FUTURE_DATE"));
    }

    @Test
    void adminCreatedEntryIsApprovedImmediately() throws Exception {
        Fixture f = newFixture("AdminCreate");
        mockMvc.perform(authed(f.admin, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.userId
                                + ",\"type\":\"DEPOSIT\",\"entryDate\":\"2026-10-01\",\"amount\":\"900.00\","
                                + "\"option\":\"Cash Deposit\",\"detail\":\"admin entry\"}")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.transaction.approvalStatus").value("APPROVED"));
        assertThat(balanceOf(f)).isEqualByComparingTo(new BigDecimal("900.00"));
    }

    @Test
    void withdrawalReducesBalance() throws Exception {
        Fixture f = newFixture("WithdrawReduce");
        createEntryAndApprove(f, "DEPOSIT", "1000.00");
        createEntryAndApprove(f, "WITHDRAWAL", "400.00");
        assertThat(balanceOf(f)).isEqualByComparingTo(new BigDecimal("600.00"));
    }

    private void createEntryAndApprove(Fixture f, String kind, String amount) throws Exception {
        MvcResult created = mockMvc.perform(authed(f.user, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.userId
                                + ",\"type\":\"" + kind + "\",\"entryDate\":\"2026-10-01\",\"amount\":\"" + amount + "\","
                                + "\"option\":\"" + ("DEPOSIT".equals(kind) ? "Cash Deposit" : "Cash Withdrawal") + "\",\"detail\":\"\"}")))
                .andExpect(status().isCreated())
                .andReturn();
        long id = readJson(created).get("transaction").get("id").asLong();
        mockMvc.perform(authed(f.admin, post("/api/transactions/" + id + "/approve")))
                .andExpect(status().isOk());
    }

    @Test
    void legacyKindNamesMapToDepositAndWithdrawal() throws Exception {
        Fixture f = newFixture("LegacyMap");
        // Legacy credit-sale name means a deposit; payment-received means a withdrawal.
        mockMvc.perform(authed(f.admin, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.userId
                                + ",\"type\":\"CREDIT_SALE\",\"entryDate\":\"2026-10-10\""
                                + ",\"amount\":\"500.00\",\"optionName\":\"Cash Deposit\",\"detail\":\"legacy\"}")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.transaction.type").value("DEPOSIT"));
        mockMvc.perform(authed(f.admin, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.userId
                                + ",\"type\":\"PAYMENT_RECEIVED\",\"entryDate\":\"2026-10-11\""
                                + ",\"amount\":\"200.00\",\"optionName\":\"Cash Withdrawal\",\"detail\":\"legacy\"}")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.transaction.type").value("WITHDRAWAL"));
        // UserPortal-style combined notes ("Option — detail") are split on the server.
        mockMvc.perform(authed(f.user, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.userId
                                + ",\"type\":\"DEPOSIT\",\"entryDate\":\"2026-10-12\""
                                + ",\"amount\":\"50.00\",\"notes\":\"Cash Deposit — site advance\"}")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.transaction.option").value("Cash Deposit"))
                .andExpect(jsonPath("$.transaction.detail").value("site advance"))
                .andExpect(jsonPath("$.transaction.description").value("Cash Deposit — site advance"));
    }

    @Test
    void reversalOffsetsEntryExactlyOnce() throws Exception {
        Fixture f = newFixture("Reversal");
        // Admin-created entries are approved immediately.
        MvcResult created = mockMvc.perform(authed(f.admin, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.userId
                                + ",\"type\":\"DEPOSIT\",\"entryDate\":\"2026-10-10\""
                                + ",\"amount\":\"750.00\",\"option\":\"Cash Deposit\",\"detail\":\"oops\"}")))
                .andExpect(status().isCreated())
                .andReturn();
        long id = readJson(created).get("transaction").get("id").asLong();
        assertThat(balanceOf(f)).isEqualByComparingTo("750.00");

        MvcResult rev = mockMvc.perform(authed(f.admin, post("/api/transactions/" + id + "/reversal")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"Entered twice\"}")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.reversal.type").value("REVERSAL"))
                .andExpect(jsonPath("$.original.isReversed").value(true))
                .andExpect(jsonPath("$.reversedById").doesNotExist())
                .andReturn();
        long revId = readJson(rev).get("reversal").get("id").asLong();
        assertThat(revId).isNotEqualTo(id);

        // Balance is back to zero; the original is marked reversed.
        assertThat(balanceOf(f)).isEqualByComparingTo("0.00");
        mockMvc.perform(authed(f.admin, get("/api/transactions/" + id)))
                .andExpect(status().isOk());
        mockMvc.perform(authed(f.admin, get("/api/transactions")
                        .param("accountId", f.userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.id==" + id + ")]").isNotEmpty());

        // A second reversal of the same entry must fail.
        mockMvc.perform(authed(f.admin, post("/api/transactions/" + id + "/reversal")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"again\"}")))
                .andExpect(status().isConflict());

        // Reversal entries cannot be reversed again.
        mockMvc.perform(authed(f.admin, post("/api/transactions/" + revId + "/reversal")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"again\"}")))
                .andExpect(status().isBadRequest());
    }

    @Test
    void includeReversalsFalseHidesReversalRows() throws Exception {
        Fixture f = newFixture("HideRev");
        MvcResult created = mockMvc.perform(authed(f.admin, post("/api/transactions")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"accountId\":" + f.userId
                                + ",\"type\":\"DEPOSIT\",\"entryDate\":\"2026-10-10\""
                                + ",\"amount\":\"100.00\",\"option\":\"Cash Deposit\"}")))
                .andReturn();
        long id = readJson(created).get("transaction").get("id").asLong();
        mockMvc.perform(authed(f.admin, post("/api/transactions/" + id + "/reversal")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"reason\":\"test\"}")))
                .andExpect(status().isOk());

        mockMvc.perform(authed(f.admin, get("/api/transactions")
                        .param("accountId", f.userId)
                        .param("includeReversals", "false")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[?(@.isReversal==true)]").isEmpty());
    }
}
