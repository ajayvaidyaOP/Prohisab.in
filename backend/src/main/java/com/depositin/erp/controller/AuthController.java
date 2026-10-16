package com.depositin.erp.controller;

import com.depositin.erp.dto.CommonDtos;
import com.depositin.erp.exception.ApiException;
import com.depositin.erp.exception.ErrorCode;
import com.depositin.erp.security.CurrentUser;
import com.depositin.erp.security.SecurityUtils;
import com.depositin.erp.security.SessionService;
import com.depositin.erp.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** Login/logout/session endpoints. Auth uses a secure HttpOnly cookie only. */
@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final AuthService auth;
    private final SessionService sessions;

    public AuthController(AuthService auth, SessionService sessions) {
        this.auth = auth;
        this.sessions = sessions;
    }

    @PostMapping("/login")
    public CommonDtos.AuthUserResponse login(@Valid @RequestBody CommonDtos.LoginRequest request,
                                             HttpServletRequest httpRequest,
                                             HttpServletResponse httpResponse) {
        String ip = clientIp(httpRequest);
        String userAgent = httpRequest.getHeader("User-Agent");
        AuthService.LoginResult result = auth.login(request, ip, userAgent);
        sessions.writeCookie(httpResponse, result.token());
        return new CommonDtos.AuthUserResponse(result.user());
    }

    @PostMapping("/pin-login")
    public CommonDtos.AuthUserResponse pinLogin(@Valid @RequestBody CommonDtos.PinLoginRequest request,
                                                HttpServletRequest httpRequest,
                                                HttpServletResponse httpResponse) {
        String ip = clientIp(httpRequest);
        String userAgent = httpRequest.getHeader("User-Agent");
        AuthService.LoginResult result = auth.loginByPin(request, ip, userAgent);
        sessions.writeCookie(httpResponse, result.token());
        return new CommonDtos.AuthUserResponse(result.user());
    }

    /**
     * Password change is completely unavailable: users must ask the admin to
     * reset their password. This endpoint exists only to give a clear error.
     */
    @PostMapping("/change-password")
    public void changePassword(@Valid @RequestBody CommonDtos.ChangePasswordRequest request) {
        CurrentUser current = SecurityUtils.requireUser();
        if (!current.isAdmin()) {
            throw new ApiException(ErrorCode.PASSWORD_CHANGE_DISABLED,
                    "Password changes are disabled. Ask the Administrator to reset your password.");
        }
        auth.changePassword(current.id(), request);
    }

    @PostMapping("/logout")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void logout(HttpServletRequest httpRequest, HttpServletResponse httpResponse) {
        String token = sessions.readCookie(httpRequest);
        CurrentUser currentUser = SecurityUtils.currentUser();
        auth.logout(token, currentUser);
        sessions.writeCookie(httpResponse, null);
    }

    @GetMapping("/me")
    public CommonDtos.AuthUserResponse me() {
        CurrentUser user = SecurityUtils.requireUser();
        Long accountId = user.role() == com.depositin.erp.entity.UserRole.USER ? user.id() : null;
        return new CommonDtos.AuthUserResponse(new CommonDtos.AuthUser(
                user.id(), user.name(), user.role().name(), accountId, user.name()));
    }

    private String clientIp(HttpServletRequest request) {
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded != null && !forwarded.isBlank()) {
            return forwarded.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
