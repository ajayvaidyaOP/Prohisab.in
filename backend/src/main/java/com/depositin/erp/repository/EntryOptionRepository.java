package com.depositin.erp.repository;

import com.depositin.erp.entity.EntryOption;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface EntryOptionRepository extends JpaRepository<EntryOption, Long> {

    List<EntryOption> findAllByOrderBySortOrderAscIdAsc();

    List<EntryOption> findByActiveTrueOrderBySortOrderAscIdAsc();

    Optional<EntryOption> findByNameNormalized(String nameNormalized);

    boolean existsByNameNormalized(String nameNormalized);

    boolean existsByNameNormalizedAndIdNot(String nameNormalized, Long id);
}
