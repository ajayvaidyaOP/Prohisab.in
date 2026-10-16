package com.depositin.erp.security;

import com.depositin.erp.config.AppProperties;
import com.depositin.erp.exception.ErrorCode;
import com.depositin.erp.exception.ErrorResponse;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.net.URI;
import java.util.List;
import java.util.Locale;

/**
 * Same-origin write protection (CSRF defence in depth for cookie auth):
 * every state-changing request must carry {@code X-Requested-With: XMLHttpRequest}
 * and its Origin/Referer (when present) must match the server host or an allow-listed origin.
 */
public class CsrfWriteProtectionFilter extends OncePerRequestFilter {

    public static final String REQUIRED_HEADER = "X-Requested-With";
    public static final String REQUIRED_VALUE = "XMLHttpRequest";

    private final AppProperties properties;
    private final ObjectMapper objectMapper;

    public CsrfWriteProtectionFilter(AppProperties properties, ObjectMapper objectMapper) {
        this.properties = properties;
        this.objectMapper = objectMapper;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {
        if (isWrite(request)) {
            String header = request.getHeader(REQUIRED_HEADER);
            if (!REQUIRED_VALUE.equalsIgnoreCase(header)) {
                reject(response, "Missing " + REQUIRED_HEADER + " header. Cross-site writes are not allowed.");
                return;
            }
            if (!originAllowed(request)) {
                reject(response, "Cross-site write rejected (origin mismatch).");
                return;
            }
        }
        filterChain.doFilter(request, response);
    }

    private boolean isWrite(HttpServletRequest request) {
        String method = request.getMethod();
        return HttpMethod.POST.matches(method)
                || HttpMethod.PUT.matches(method)
                || HttpMethod.PATCH.matches(method)
                || HttpMethod.DELETE.matches(method);
    }

    private boolean originAllowed(HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        String referer = request.getHeader("Referer");
        String candidate = origin != null && !origin.isBlank() && !"null".equals(origin) ? origin : referer;
        if (candidate == null || candidate.isBlank()) {
            // Non-browser clients (curl without Origin) are accepted; browsers always send Origin on writes.
            return true;
        }
        String candidateHost = hostOf(candidate);
        if (candidateHost == null) {
            return false;
        }
        String requestHost = request.getHeader("Host");
        if (candidateHost.equalsIgnoreCase(requestHost)) {
            return true;
        }
        String allowed = properties.allowedOrigins();
        if (allowed != null && !allowed.isBlank()) {
            List<String> origins = List.of(allowed.split(","));
            for (String configured : origins) {
                String configuredHost = hostOf(configured.trim());
                if (configuredHost != null && configuredHost.equalsIgnoreCase(candidateHost)) {
                    return true;
                }
            }
        }
        return false;
    }

    private String hostOf(String url) {
        try {
            URI uri = URI.create(url);
            String host = uri.getHost();
            if (host == null) {
                return null;
            }
            return uri.getPort() == -1 ? host : host + ":" + uri.getPort();
        } catch (IllegalArgumentException e) {
            return null;
        }
    }

    private void reject(HttpServletResponse response, String message) throws IOException {
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setCharacterEncoding("UTF-8");
        objectMapper.writeValue(response.getWriter(),
                ErrorResponse.of(ErrorCode.FORBIDDEN.name(), message, null, java.util.UUID.randomUUID().toString()));
    }
}
