package com.depositin.erp.config;

import com.depositin.erp.exception.ErrorCode;
import com.depositin.erp.exception.ErrorResponse;
import com.depositin.erp.security.CsrfWriteProtectionFilter;
import com.depositin.erp.security.SessionAuthenticationFilter;
import com.depositin.erp.security.SessionService;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

import java.util.UUID;

/**
 * Cookie-session security. Writes require the CSRF header + same-origin check;
 * role rules are enforced here and again inside services (never only in the UI).
 */
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http,
                                                   SessionService sessionService,
                                                   AppProperties properties,
                                                   ObjectMapper objectMapper) throws Exception {
        SessionAuthenticationFilter sessionFilter = new SessionAuthenticationFilter(sessionService);
        CsrfWriteProtectionFilter csrfFilter = new CsrfWriteProtectionFilter(properties, objectMapper);

        http
                .csrf(AbstractHttpConfigurer::disable) // replaced by CsrfWriteProtectionFilter
                .httpBasic(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth
                        // Public endpoints
                        .requestMatchers(HttpMethod.GET, "/api/health").permitAll()
                        .requestMatchers(HttpMethod.POST, "/api/auth/login").permitAll()
                        // Admin-only surfaces
                        .requestMatchers("/api/dashboard/**").hasRole("ADMIN")
                        .requestMatchers("/api/audit-logs/**").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.GET, "/api/accounts").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.GET, "/api/accounts/options").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.POST, "/api/accounts").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.PATCH, "/api/accounts/**").hasRole("ADMIN")
                        .requestMatchers("/api/accounts/*/reset-password").hasRole("ADMIN")
                        .requestMatchers("/api/accounts/*/ledger.pdf").hasRole("ADMIN")
                        .requestMatchers("/api/accounts/*/ledger.csv").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.GET, "/api/transactions").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.POST, "/api/transactions/*/approve").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.POST, "/api/transactions/*/reject").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.POST, "/api/transactions/*/reversal").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.PUT, "/api/settings").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.POST, "/api/settings/**").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.PATCH, "/api/settings/**").hasRole("ADMIN")
                        .requestMatchers(HttpMethod.DELETE, "/api/settings/**").hasRole("ADMIN")
                        // Everything else needs a session; ownership is checked in services.
                        .anyRequest().authenticated())
                .exceptionHandling(ex -> ex
                        .authenticationEntryPoint((request, response, authException) ->
                                writeError(response, HttpServletResponse.SC_UNAUTHORIZED,
                                        ErrorCode.UNAUTHORIZED, "You must be signed in."))
                        .accessDeniedHandler((request, response, accessDeniedException) ->
                                writeError(response, HttpServletResponse.SC_FORBIDDEN,
                                        ErrorCode.FORBIDDEN, "You do not have permission to perform this action.")))
                .addFilterBefore(csrfFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterBefore(sessionFilter, CsrfWriteProtectionFilter.class);
        return http.build();
    }

    private void writeError(HttpServletResponse response, int status, ErrorCode code, String message) throws java.io.IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        new ObjectMapper().writeValue(response.getWriter(),
                ErrorResponse.of(code.name(), message, null, UUID.randomUUID().toString()));
    }
}
