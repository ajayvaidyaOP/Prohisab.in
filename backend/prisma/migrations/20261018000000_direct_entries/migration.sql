-- Direct posting replaces the approval queue. Rejected historical rows stay excluded.
ALTER TABLE transactions ADD COLUMN edited_at DATETIME NULL;
ALTER TABLE transactions ALTER COLUMN approval_status SET DEFAULT 'APPROVED';
UPDATE transactions t SET edited_at = (
  SELECT MAX(a.created_at) FROM audit_logs a
  WHERE a.entity_type IN ('LedgerTransaction', 'LedgerEntry') AND a.entity_id = CAST(t.id AS CHAR)
    AND a.action = 'TRANSACTION_EDITED'
);
INSERT INTO audit_logs (action, entity_type, entity_id, details)
SELECT 'TRANSACTION_AUTO_POSTED', 'LedgerTransaction', CAST(id AS CHAR),
  '{"previousStatus":"PENDING","reason":"Approval workflow removed"}'
FROM transactions t WHERE approval_status = 'PENDING' AND NOT EXISTS (
  SELECT 1 FROM audit_logs a WHERE a.action = 'TRANSACTION_AUTO_POSTED'
    AND a.entity_type = 'LedgerTransaction' AND a.entity_id = CAST(t.id AS CHAR)
);
UPDATE transactions SET approval_status = 'APPROVED', reviewed_at = CURRENT_TIMESTAMP,
  rejection_reason = NULL WHERE approval_status = 'PENDING';
