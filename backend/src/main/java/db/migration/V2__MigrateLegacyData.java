package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * V2: maps data from the legacy Express/Prisma schema (tables {@code AdminUser},
 * {@code Account}, {@code LedgerEntry}, {@code AppSetting}) into the new schema.
 *
 * <p>Safety rules:</p>
 * <ul>
 *   <li>Runs as a no-op when no legacy tables exist (fresh installs).</li>
 *   <li>Never drops or modifies the legacy tables - existing production data is preserved.</li>
 *   <li>Amounts and signs are preserved exactly:
 *       old {@code INCREASE} entries become DEPOSIT (+), {@code DECREASE} become WITHDRAWAL (-).</li>
 *   <li>Old internal type names are mapped to the two user-facing kinds.</li>
 * </ul>
 */
public class V2__MigrateLegacyData extends BaseJavaMigration {

    @Override
    public void migrate(Context context) throws Exception {
        Connection connection = context.getConnection();
        if (!tableExists(connection, "AdminUser") || !tableExists(connection, "Account")) {
            // Fresh database: nothing legacy to migrate.
            return;
        }

        Map<Integer, Long> accountToUser = new HashMap<>();

        // ---- 1. AdminUser rows without an account (typically the administrator) ----
        try (Statement st = connection.createStatement();
             ResultSet rs = st.executeQuery(
                     "SELECT id, username, passwordHash, role FROM AdminUser WHERE accountId IS NULL")) {
            while (rs.next()) {
                String username = rs.getString("username");
                if (userExists(connection, username)) {
                    continue;
                }
                Long newId = insertUser(connection, username, rs.getString("passwordHash"),
                        rs.getString("role") == null ? "ADMIN" : rs.getString("role"), null, true);
                accountToUser.put(-rs.getInt("id"), newId); // negative key for admin-only logins
            }
        }

        // ---- 2. Accounts (each becomes one user/ledger) ----
        try (Statement st = connection.createStatement();
             ResultSet rs = st.executeQuery(
                     "SELECT id, accountCode, name, phone, email, address, notes, isActive FROM Account")) {
            while (rs.next()) {
                String name = rs.getString("name");
                if (userExists(connection, name)) {
                    continue;
                }
                String accountCode = rs.getString("accountCode");
                String role = "USER";
                String passwordHash = null;
                try (PreparedStatement ps = connection.prepareStatement(
                        "SELECT passwordHash, role FROM AdminUser WHERE accountId = ? LIMIT 1")) {
                    ps.setInt(1, rs.getInt("id"));
                    try (ResultSet login = ps.executeQuery()) {
                        if (login.next()) {
                            passwordHash = login.getString("passwordHash");
                            String legacyRole = login.getString("role");
                            if ("ADMIN".equalsIgnoreCase(legacyRole)) {
                                role = "ADMIN";
                            }
                        }
                    }
                }
                if (passwordHash == null) {
                    // Unusable hash (no known password) - the admin must reset it.
                    passwordHash = "$2a$12$legacyMigratedAccountWithoutKnownPasswordHash................";
                }
                Long newId = insertUserWithCode(connection, name, passwordHash, role, accountCode,
                        rs.getString("phone"), rs.getString("email"), rs.getString("address"), rs.getString("notes"),
                        rs.getBoolean("isActive"));
                accountToUser.put(rs.getInt("id"), newId);
            }
        }

        // ---- 3. Ledger entries (signs preserved: INCREASE -> DEPOSIT, DECREASE -> WITHDRAWAL) ----
        if (tableExists(connection, "LedgerEntry") && !tableExists(connection, "transactions_migrated_marker")) {
            long migrated = 0;
            try (Statement st = connection.createStatement();
                 ResultSet rs = st.executeQuery(
                         "SELECT accountId, entryDate, direction, amount, paymentMethod, referenceNumber, notes, " +
                                 "approvalStatus, reviewedById, reviewedAt, rejectionReason, createdById, createdAt, type " +
                                 "FROM LedgerEntry")) {
                while (rs.next()) {
                    Long userId = accountToUser.get(rs.getInt("accountId"));
                    if (userId == null) {
                        continue;
                    }
                    String kind = "DECREASE".equalsIgnoreCase(rs.getString("direction")) ? "WITHDRAWAL" : "DEPOSIT";
                    String option = legacyOption(rs.getString("type"), rs.getString("paymentMethod"), kind);
                    String detail = rs.getString("notes");
                    if (detail != null && detail.startsWith(option)) {
                        detail = detail.substring(option.length()).replaceFirst("^[\\s—-]+", "").trim();
                        if (detail.isEmpty()) {
                            detail = null;
                        }
                    }
                    String status = rs.getString("approvalStatus");
                    if (status == null) {
                        status = "APPROVED";
                    }
                    try (PreparedStatement ps = connection.prepareStatement(
                            "INSERT INTO transactions (user_id, entry_date, kind, amount, option_name, detail, " +
                                    "reference_number, approval_status, reviewed_by_id, reviewed_at, rejection_reason, " +
                                    "created_by_id, created_at, updated_at) " +
                                    "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")) {
                        ps.setLong(1, userId);
                        ps.setDate(2, rs.getDate("entryDate"));
                        ps.setString(3, kind);
                        ps.setBigDecimal(4, rs.getBigDecimal("amount"));
                        ps.setString(5, option);
                        ps.setString(6, detail);
                        ps.setString(7, rs.getString("referenceNumber"));
                        ps.setString(8, status);
                        ps.setObject(9, mapUser(accountToUser, rs.getInt("reviewedById"), rs.wasNull()));
                        ps.setTimestamp(10, rs.getTimestamp("reviewedAt"));
                        ps.setString(11, rs.getString("rejectionReason"));
                        ps.setObject(12, mapUser(accountToUser, rs.getInt("createdById"), rs.wasNull()));
                        ps.setTimestamp(13, rs.getTimestamp("createdAt"));
                        ps.setTimestamp(14, rs.getTimestamp("createdAt"));
                        ps.executeUpdate();
                        migrated++;
                    }
                }
            }
            System.out.println("[V2] Migrated " + migrated + " legacy ledger entries.");
        }

        // ---- 4. App settings ----
        if (tableExists(connection, "AppSetting")) {
            try (Statement st = connection.createStatement();
                 ResultSet rs = st.executeQuery(
                         "SELECT businessName, businessAddress, businessPhone, businessEmail, currencySymbol, timezone " +
                                 "FROM AppSetting WHERE id = 1")) {
                if (rs.next()) {
                    try (PreparedStatement ps = connection.prepareStatement(
                            "INSERT INTO app_settings (id, business_name, business_address, business_phone, business_email, " +
                                    "currency_symbol, timezone, updated_at) VALUES (1,?,?,?,?,?,?,CURRENT_TIMESTAMP) " +
                                    "ON DUPLICATE KEY UPDATE business_name = VALUES(business_name)")) {
                        ps.setString(1, rs.getString("businessName"));
                        ps.setString(2, rs.getString("businessAddress"));
                        ps.setString(3, rs.getString("businessPhone"));
                        ps.setString(4, rs.getString("businessEmail"));
                        ps.setString(5, rs.getString("currencySymbol"));
                        ps.setString(6, rs.getString("timezone"));
                        ps.executeUpdate();
                    }
                }
            }
        }

        // ---- 5. Legacy JSON entry options -> entry_options rows ----
        if (tableExists(connection, "AppSetting")) {
            String json = null;
            try (Statement st = connection.createStatement();
                 ResultSet rs = st.executeQuery("SELECT userEntryOptions FROM AppSetting WHERE id = 1")) {
                if (rs.next()) {
                    json = rs.getString("userEntryOptions");
                }
            } catch (Exception ignored) {
                // column may not exist in older schemas
            }
            if (json != null && json.trim().startsWith("[")) {
                int order = 0;
                for (String part : json.trim().substring(1, json.trim().length() - 1).split(",")) {
                    String name = part.trim().replaceFirst("^\"", "").replaceFirst("\"$", "").replace("\\\"", "\"");
                    if (name.isEmpty()) {
                        continue;
                    }
                    try (PreparedStatement ps = connection.prepareStatement(
                            "INSERT INTO entry_options (name, name_normalized, sort_order, is_active, created_at, updated_at) " +
                                    "VALUES (?,?,?,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)")) {
                        ps.setString(1, name);
                        ps.setString(2, name.toLowerCase(Locale.ROOT));
                        ps.setInt(3, order++);
                        ps.executeUpdate();
                    } catch (Exception duplicate) {
                        // already seeded - ignore
                    }
                }
            }
        }
    }

    private Long mapUser(Map<Integer, Long> map, int legacyId, boolean wasNull) {
        if (wasNull) {
            return null;
        }
        return map.get(legacyId);
    }

    /** Maps legacy type + payment method to a readable option name. */
    private String legacyOption(String legacyType, String paymentMethod, String kind) {
        if (paymentMethod != null && !paymentMethod.isBlank()) {
            return switch (paymentMethod) {
                case "CASH" -> "DEPOSIT".equals(kind) ? "Cash Deposit" : "Cash Withdrawal";
                case "UPI" -> "UPI / Bank Deposit";
                case "BANK_TRANSFER" -> "Bank Deposit";
                default -> "Other";
            };
        }
        return "DEPOSIT".equals(kind) ? "Cash Deposit" : "Cash Withdrawal";
    }

    private boolean tableExists(Connection connection, String table) throws Exception {
        DatabaseMetaData meta = connection.getMetaData();
        try (ResultSet rs = meta.getTables(null, null, table, new String[]{"TABLE"})) {
            if (rs.next()) {
                return true;
            }
        }
        try (ResultSet rs = meta.getTables(null, null, table.toLowerCase(Locale.ROOT), new String[]{"TABLE"})) {
            return rs.next();
        }
    }

    private boolean userExists(Connection connection, String name) throws Exception {
        try (PreparedStatement ps = connection.prepareStatement(
                "SELECT 1 FROM users WHERE name_normalized = ? LIMIT 1")) {
            ps.setString(1, name == null ? null : name.trim().toLowerCase(Locale.ROOT));
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next();
            }
        }
    }

    private Long insertUser(Connection connection, String name, String passwordHash, String role,
                            String accountCode, boolean active) throws Exception {
        return insertUserWithCode(connection, name, passwordHash, role, accountCode, null, null, null, null, active);
    }

    private Long insertUserWithCode(Connection connection, String name, String passwordHash, String role,
                                    String accountCode, String phone, String email, String address, String notes,
                                    boolean active) throws Exception {
        String code = accountCode;
        if (code == null || code.isBlank()) {
            code = "MIG-" + System.nanoTime() % 1_000_000;
        }
        try (PreparedStatement ps = connection.prepareStatement(
                "INSERT INTO users (name, name_normalized, password_hash, role, account_code, phone, email, address, notes, " +
                        "is_active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)",
                Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, name);
            ps.setString(2, name == null ? null : name.trim().toLowerCase(Locale.ROOT));
            ps.setString(3, passwordHash);
            ps.setString(4, role == null ? "USER" : role);
            ps.setString(5, code);
            ps.setString(6, phone);
            ps.setString(7, email);
            ps.setString(8, address);
            ps.setString(9, notes);
            ps.setBoolean(10, active);
            ps.executeUpdate();
            try (ResultSet keys = ps.getGeneratedKeys()) {
                if (keys.next()) {
                    return keys.getLong(1);
                }
            }
        }
        return null;
    }
}
