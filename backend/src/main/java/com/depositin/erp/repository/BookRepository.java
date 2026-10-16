package com.depositin.erp.repository;

import com.depositin.erp.entity.Book;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface BookRepository extends JpaRepository<Book, Long> {
    long countByStatus(Book.Status status);
    List<Book> findByStatusOrderByCreatedAtAsc(Book.Status status);
    List<Book> findAllByOrderByCreatedAtAsc();
}
