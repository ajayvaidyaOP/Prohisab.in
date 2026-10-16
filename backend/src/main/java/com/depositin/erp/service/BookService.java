package com.depositin.erp.service;

import com.depositin.erp.dto.CommonDtos;
import com.depositin.erp.entity.Book;
import com.depositin.erp.entity.UserAccount;
import com.depositin.erp.repository.BookRepository;
import com.depositin.erp.repository.LedgerTransactionRepository;
import com.depositin.erp.security.CurrentUser;
import com.depositin.erp.security.SecurityUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Map;

@Service
public class BookService {

    private final BookRepository books;
    private final LedgerTransactionRepository transactions;
    private final UserService users;
    private final AuditService audit;

    public BookService(BookRepository books, LedgerTransactionRepository transactions,
                       UserService users, AuditService audit) {
        this.books = books;
        this.transactions = transactions;
        this.users = users;
        this.audit = audit;
    }

    @Transactional(readOnly = true)
    public List<Book> listAll() {
        SecurityUtils.requireUser();
        return books.findAllByOrderByCreatedAtAsc();
    }

    @Transactional(readOnly = true)
    public List<Book> listActive() {
        SecurityUtils.requireUser();
        return books.findByStatusOrderByCreatedAtAsc(Book.Status.ACTIVE);
    }

    @Transactional
    public Book create(String name, CurrentUser actor) {
        SecurityUtils.requireAdmin();
        Book b = new Book();
        b.setName(name.trim());
        b.setStatus(Book.Status.ACTIVE);
        b = books.save(b);
        audit.record("BOOK_CREATED", "Book", b.getId(), users.requireUser(actor.id()), Map.of("name", b.getName()));
        return b;
    }

    @Transactional
    public Book archive(Long id, CurrentUser actor) {
        SecurityUtils.requireAdmin();
        Book b = books.findById(id).orElseThrow(() -> new IllegalArgumentException("Book not found"));
        b.setStatus(Book.Status.ARCHIVED);
        b = books.save(b);
        audit.record("BOOK_ARCHIVED", "Book", b.getId(), users.requireUser(actor.id()), Map.of("name", b.getName()));
        return b;
    }

    @Transactional
    public Book restore(Long id, CurrentUser actor) {
        SecurityUtils.requireAdmin();
        Book b = books.findById(id).orElseThrow(() -> new IllegalArgumentException("Book not found"));
        b.setStatus(Book.Status.ACTIVE);
        b = books.save(b);
        audit.record("BOOK_RESTORED", "Book", b.getId(), users.requireUser(actor.id()), Map.of("name", b.getName()));
        return b;
    }
}
