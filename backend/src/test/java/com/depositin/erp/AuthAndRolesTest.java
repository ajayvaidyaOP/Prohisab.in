package com.depositin.erp;

import com.depositin.erp.support.ApiTestBase;
import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MvcResult;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Authentication and role coverage: admin login, user login by name,
 * admin-only user creation, and role authorization errors.
 */
class AuthAndRolesTest extends ApiTestBase {

    @Test
    void adminLoginSucceeds() throws Exception {
        CookieSession admin = login("admin", "AdminPass123");
        assertThat(admin.role()).isEqualTo("ADMIN");
        assertThat(admin.user().get("accountId").isNull()).isTrue();
    }

    @Test
    void userLoginByNameIsCaseInsensitive() throws Exception {
        CookieSession admin = login("admin", "AdminPass123");
        String name = uniqueName("CaseUser");
        createUser(name, "secret123", admin);

        CookieSession user = login(name.toUpperCase(), "secret123");
        assertThat(user.role()).isEqualTo("USER");
        assertThat(user.user().get("accountId").asLong()).isEqualTo(user.id());
    }

    @Test
    void wrongPasswordIsRejectedWithGenericMessage() throws Exception {
        CookieSession admin = login("admin", "AdminPass123");
        String name = uniqueName("WrongPass");
        createUser(name, "secret123", admin);

        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Requested-With", "XMLHttpRequest")
                        .content("{\"username\":\"" + name + "\",\"password\":\"nope\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.error.code").value("UNAUTHORIZED"))
                .andExpect(jsonPath("$.error.message").value("Invalid name or password."));
    }

    @Test
    void loginRequiresCsrfHeader() throws Exception {
        mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"username\":\"admin\",\"password\":\"AdminPass123\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void onlyAdminCanCreateUsers() throws Exception {
        CookieSession admin = login("admin", "AdminPass123");
        String name = uniqueName("Creator");
        createUser(name, "secret123", admin);
        CookieSession user = login(name, "secret123");

        mockMvc.perform(authed(user, post("/api/accounts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Should Fail\",\"password\":\"secret123\"}")))
                .andExpect(status().isForbidden());
    }

    @Test
    void duplicateNameIsRejectedCaseInsensitively() throws Exception {
        CookieSession admin = login("admin", "AdminPass123");
        String name = uniqueName("DupName");
        createUser(name, "secret123", admin);

        MvcResult result = mockMvc.perform(authed(admin, post("/api/accounts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"" + name.toUpperCase() + "\",\"password\":\"secret123\"}")))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.error.code").value("DUPLICATE_RECORD"))
                .andReturn();
        assertThat(result.getResponse().getContentAsString()).contains("already exists");
    }

    @Test
    void userCreationRequiresNameAndPasswordOnly() throws Exception {
        CookieSession admin = login("admin", "AdminPass123");
        String name = uniqueName("Minimal");

        // Name + Password only: no email/phone/opening balance required.
        mockMvc.perform(authed(admin, post("/api/accounts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"" + name + "\",\"password\":\"secret123\"}")))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.account.name").value(name))
                .andExpect(jsonPath("$.account.openingBalance").value("0.00"));
    }

    @Test
    void weakPasswordIsRejected() throws Exception {
        CookieSession admin = login("admin", "AdminPass123");
        mockMvc.perform(authed(admin, post("/api/accounts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"" + uniqueName("Weak") + "\",\"password\":\"abc\"}")))
                .andExpect(status().isUnprocessableEntity())
                .andExpect(jsonPath("$.error.code").value("PASSWORD_TOO_WEAK"));
    }

    @Test
    void meReturnsCurrentUser() throws Exception {
        CookieSession admin = login("admin", "AdminPass123");
        mockMvc.perform(authed(admin, get("/api/auth/me")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.user.username").value("admin"));
    }

    @Test
    void unauthenticatedRequestsAreRejected() throws Exception {
        mockMvc.perform(get("/api/dashboard"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void logoutClearsSession() throws Exception {
        CookieSession admin = login("admin", "AdminPass123");
        mockMvc.perform(authed(admin, post("/api/auth/logout")))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/auth/me").header("Cookie", admin.cookie()))
                .andExpect(status().isUnauthorized());
    }
}
