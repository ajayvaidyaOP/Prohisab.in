package com.depositin.erp.config;

import com.depositin.erp.entity.UserAccount;
import com.depositin.erp.entity.UserRole;
import com.depositin.erp.repository.UserRepository;
import com.depositin.erp.service.EntryOptionService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.env.Environment;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.util.HexFormat;

/**
 * Creates the initial administrator account when the users table is empty.
 *
 * <p>Provide {@code ADMIN_NAME} / {@code ADMIN_PASSWORD} environment variables for a
 * controlled seed. When ADMIN_PASSWORD is not set, a strong random password is
 * generated and printed ONCE to the console - store it safely and change it after
 * the first sign-in.</p>
 */
@Component
public class DataSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(DataSeeder.class);

    private final UserRepository users;
    private final EntryOptionService entryOptions;
    private final Environment environment;

    public DataSeeder(UserRepository users, EntryOptionService entryOptions, Environment environment) {
        this.users = users;
        this.entryOptions = entryOptions;
        this.environment = environment;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        entryOptions.seedDefaultsIfEmpty();

        if (users.countByRoleAndActiveTrue(UserRole.ADMIN) > 0 || users.count() > 0) {
            return;
        }

        String name = environment.getProperty("ADMIN_NAME", "admin");
        String password = environment.getProperty("ADMIN_PASSWORD");
        boolean generated = false;
        if (password == null || password.isBlank()) {
            password = generatePassword();
            generated = true;
        }

        UserAccount admin = new UserAccount();
        admin.setName(name.trim());
        admin.setNameNormalized(UserAccount.normalizeName(name));
        admin.setPasswordHash(new BCryptPasswordEncoder(12).encode(password));
        admin.setRole(UserRole.ADMIN);
        admin.setAccountCode("ADM-000001");
        admin.setActive(true);
        users.save(admin);

        log.warn("===========================================================================");
        log.warn(" Seeded initial administrator account.");
        log.warn("   Login name : {}", admin.getName());
        if (generated) {
            log.warn("   Password   : {}   (generated - copy it NOW, it will not be shown again)", password);
        } else {
            log.warn("   Password   : (from ADMIN_PASSWORD environment variable)");
        }
        log.warn(" IMPORTANT: sign in and reset this password immediately on production systems.");
        log.warn("===========================================================================");
    }

    private String generatePassword() {
        SecureRandom random = new SecureRandom();
        byte[] bytes = new byte[9];
        random.nextBytes(bytes);
        return "Init-" + HexFormat.of().formatHex(bytes);
    }
}
