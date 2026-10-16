package com.depositin.erp.repository;

import com.depositin.erp.entity.ApprovalStatus;
import com.depositin.erp.entity.LedgerTransaction;
import com.depositin.erp.entity.TransactionKind;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import jakarta.persistence.LockModeType;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface LedgerTransactionRepository extends JpaRepository<LedgerTransaction, Long> {

    @Query("""
            select t from LedgerTransaction t
            join fetch t.user u
            left join fetch t.reviewedBy r
            left join fetch t.createdBy c
            where t.id = :id
            """)
    Optional<LedgerTransaction> findByIdWithUsers(@Param("id") Long id);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select t from LedgerTransaction t where t.id = :id")
    Optional<LedgerTransaction> findByIdForUpdate(@Param("id") Long id);

    /** Sum of APPROVED entries for one user and kind, optionally within a date range. */
    @Query("""
            select coalesce(sum(t.amount), 0) from LedgerTransaction t
            where t.user.id = :userId
              and t.kind = :kind
              and t.approvalStatus = com.depositin.erp.entity.ApprovalStatus.APPROVED
              and (:fromDate is null or t.entryDate >= :fromDate)
              and (:toDate is null or t.entryDate <= :toDate)
            """)
    BigDecimal sumApprovedByUserAndKind(@Param("userId") Long userId,
                                        @Param("kind") TransactionKind kind,
                                        @Param("fromDate") LocalDate fromDate,
                                        @Param("toDate") LocalDate toDate);

    /** Per-user totals for a whole date range (or all time when null). Returns [userId, kind, total]. */
    @Query("""
            select t.user.id, t.kind, coalesce(sum(t.amount), 0) from LedgerTransaction t
            where t.approvalStatus = com.depositin.erp.entity.ApprovalStatus.APPROVED
              and (:fromDate is null or t.entryDate >= :fromDate)
              and (:toDate is null or t.entryDate <= :toDate)
            group by t.user.id, t.kind
            """)
    List<Object[]> sumApprovedGroupByUserAndKind(@Param("fromDate") LocalDate fromDate,
                                                 @Param("toDate") LocalDate toDate);

    @Query("""
            select coalesce(sum(t.amount), 0) from LedgerTransaction t
            where t.approvalStatus = com.depositin.erp.entity.ApprovalStatus.APPROVED
              and t.kind = :kind
              and t.entryDate = :date
            """)
    BigDecimal sumApprovedByKindOnDate(@Param("kind") TransactionKind kind, @Param("date") LocalDate date);

    @Query("""
            select count(t) from LedgerTransaction t
            where t.approvalStatus = com.depositin.erp.entity.ApprovalStatus.APPROVED
              and t.kind = :kind
              and t.entryDate = :date
            """)
    long countApprovedByKindOnDate(@Param("kind") TransactionKind kind, @Param("date") LocalDate date);

    long countByApprovalStatus(ApprovalStatus status);

    @Query("""
            select coalesce(sum(t.amount), 0) from LedgerTransaction t
            where t.approvalStatus = com.depositin.erp.entity.ApprovalStatus.PENDING
              and t.kind = :kind
            """)
    BigDecimal sumPendingByKind(@Param("kind") TransactionKind kind);

    long countByUserIdAndApprovalStatus(Long userId, ApprovalStatus status);

    @Query("""
            select coalesce(sum(t.amount), 0) from LedgerTransaction t
            where t.user.id = :userId and t.approvalStatus = com.depositin.erp.entity.ApprovalStatus.PENDING
            """)
    BigDecimal sumPendingByUser(@Param("userId") Long userId);

    long countByOptionNameIgnoreCase(String optionName);

    long countByOptionNameIgnoreCaseAndIdNot(String optionName, Long id);

    @Query("""
            select t from LedgerTransaction t
            join fetch t.user u
            left join fetch t.reviewedBy r
            where (:approvalStatus is null or t.approvalStatus = :approvalStatus)
              and (:userId is null or t.user.id = :userId)
              and (:kind is null or t.kind = :kind)
              and (:includeReversals = true or t.reversalOfId is null)
              and (:fromDate is null or t.entryDate >= :fromDate)
              and (:toDate is null or t.entryDate <= :toDate)
            order by t.entryDate desc, t.id desc
            """)
    Page<LedgerTransaction> search(@Param("approvalStatus") ApprovalStatus approvalStatus,
                                 @Param("includeReversals") boolean includeReversals,
                                   @Param("userId") Long userId,
                                   @Param("kind") TransactionKind kind,
                                   @Param("fromDate") LocalDate fromDate,
                                   @Param("toDate") LocalDate toDate,
                                   Pageable pageable);

    @Query("""
            select t from LedgerTransaction t
            left join fetch t.reviewedBy r
            where t.user.id = :userId
              and (:fromDate is null or t.entryDate >= :fromDate)
              and (:toDate is null or t.entryDate <= :toDate)
            order by t.entryDate asc, t.id asc
            """)
    List<LedgerTransaction> ledgerRows(@Param("userId") Long userId,
                                       @Param("fromDate") LocalDate fromDate,
                                       @Param("toDate") LocalDate toDate);

    @Query("""
            select t from LedgerTransaction t
            left join fetch t.reviewedBy r
            where t.approvalStatus = com.depositin.erp.entity.ApprovalStatus.PENDING
            order by t.createdAt asc, t.id asc
            """)
    List<LedgerTransaction> findAllPending();

    @Query("select max(t.entryDate) from LedgerTransaction t where t.user.id = :userId")
    LocalDate findLastEntryDate(@Param("userId") Long userId);

    @Query("""
            select count(t) from LedgerTransaction t
            where t.approvalStatus = com.depositin.erp.entity.ApprovalStatus.APPROVED
            """)
    long countApproved();
}
