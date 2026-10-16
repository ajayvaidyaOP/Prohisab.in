package com.depositin.erp.repository;

import com.depositin.erp.entity.UserAccount;
import com.depositin.erp.entity.UserRole;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface UserRepository extends JpaRepository<UserAccount, Long> {

    Optional<UserAccount> findByNameNormalized(String nameNormalized);

    boolean existsByNameNormalized(String nameNormalized);

    boolean existsByNameNormalizedAndIdNot(String nameNormalized, Long id);

    long countByRoleAndActiveTrue(UserRole role);

    List<UserAccount> findByRoleOrderByCreatedAtAsc(UserRole role);
}
