package com.depositin.erp.entity;

/**
 * User-facing transaction kinds. The old internal accounting type names are
 * migrated into these two kinds; users only ever see "Deposit" and "Withdrawal".
 */
public enum TransactionKind {
    /** Money coming in (+). Increases the user's balance. */
    DEPOSIT,
    /** Money going out (-). Decreases the user's balance. */
    WITHDRAWAL
}
