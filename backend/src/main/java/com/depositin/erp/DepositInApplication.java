package com.depositin.erp;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

/**
 * deposit.in ERP - deposit/withdrawal ledger with admin approval workflow.
 */
@SpringBootApplication
@ConfigurationPropertiesScan
public class DepositInApplication {

    public static void main(String[] args) {
        SpringApplication.run(DepositInApplication.class, args);
    }
}
