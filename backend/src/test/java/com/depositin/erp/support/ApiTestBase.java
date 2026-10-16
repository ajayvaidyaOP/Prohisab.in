package com.depositin.erp.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicLong;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** Shared MockMvc + H2 (MySQL mode) test harness with cookie login helpers. */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
public abstract class ApiTestBase {

    protected static final AtomicLong SEQ = new AtomicLong(System.nanoTime() % 100_000);

    @Autowired
    protected MockMvc mockMvc;

    @Autowired
    protected ObjectMapper objectMapper;

    /** Creates a unique name so parallel/serial tests never collide. */
    protected String uniqueName(String prefix) {
        return prefix + "-" + SEQ.incrementAndGet();
    }

    protected CookieSession login(String name, String password) throws Exception {
        MvcResult result = mockMvc.perform(post("/api/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header("X-Requested-With", "XMLHttpRequest")
                        .content("{\"username\":" + json(name) + ",\"password\":" + json(password) + "}"))
                .andExpect(status().isOk())
                .andReturn();
        String setCookie = result.getResponse().getHeader("Set-Cookie");
        if (setCookie == null) {
            throw new IllegalStateException("Login did not set a session cookie");
        }
        String cookie = setCookie.split(";")[0];
        JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
        return new CookieSession(cookie, body.get("user"));
    }

    protected MockHttpServletRequestBuilder authed(CookieSession session, MockHttpServletRequestBuilder builder) {
        String pair = session.cookie();
        int eq = pair.indexOf('=');
        jakarta.servlet.http.Cookie cookie =
                new jakarta.servlet.http.Cookie(pair.substring(0, eq), pair.substring(eq + 1));
        return builder
                .cookie(cookie)
                .header("X-Requested-With", "XMLHttpRequest");
    }

    protected JsonNode readJson(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsString(StandardCharsets.UTF_8));
    }

    protected String createUser(String name, String password, CookieSession admin) throws Exception {
        MvcResult result = mockMvc.perform(authed(admin, post("/api/accounts")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":" + json(name) + ",\"password\":" + json(password) + "}")))
                .andExpect(status().isCreated())
                .andReturn();
        return readJson(result).get("account").get("id").asText();
    }

    protected String json(String value) throws Exception {
        return objectMapper.writeValueAsString(value);
    }

    public record CookieSession(String cookie, JsonNode user) {
        public long id() {
            return user.get("id").asLong();
        }

        public String role() {
            return user.get("role").asText();
        }
    }
}
