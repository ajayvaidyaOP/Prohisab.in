package com.depositin.erp.controller;

import com.depositin.erp.entity.Book;
import com.depositin.erp.security.CurrentUser;
import com.depositin.erp.security.SecurityUtils;
import com.depositin.erp.service.BookService;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/books")
public class BookController {

    private final BookService books;

    public BookController(BookService books) {
        this.books = books;
    }

    @GetMapping
    public List<Book> list() {
        return books.listFor(SecurityUtils.requireUser());
    }

    @PostMapping
    public Book create(@RequestBody Map<String, String> body) {
        CurrentUser admin = SecurityUtils.requireAdmin();
        return books.create(body.get("name"), admin);
    }

    @PostMapping("/{id}/archive")
    public Book archive(@PathVariable Long id) {
        CurrentUser admin = SecurityUtils.requireAdmin();
        return books.archive(id, admin);
    }

    @PostMapping("/{id}/restore")
    public Book restore(@PathVariable Long id) {
        CurrentUser admin = SecurityUtils.requireAdmin();
        return books.restore(id, admin);
    }
}
