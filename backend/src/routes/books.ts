import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db/prisma.ts';
import { audit } from '../lib/audit.ts';
import { errors } from '../lib/errors.ts';
import { id, num, parse } from '../lib/validation.ts';
import { actor, requireAdmin, requireAuth } from '../middleware/auth.ts';

export const booksRouter = Router();
booksRouter.use(requireAuth);
async function bookView(book: { id: bigint; name: string; status: string }) {
  return { id: num(book.id), name: book.name, status: book.status,
    entryCount: await prisma.transaction.count({ where: { bookId: book.id } }) };
}
booksRouter.get('/', async (req, res) => {
  const viewer = actor(req);
  const books = await prisma.book.findMany({ where: viewer.role === 'ADMIN' ? {} :
    { status: 'ACTIVE', members: { some: { userId: viewer.id } } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  res.json(await Promise.all(books.map(bookView)));
});
booksRouter.post('/', requireAdmin, async (req, res) => {
  const { name } = parse(z.object({ name: z.string().trim().min(2).max(150) }), req.body);
  const book = await prisma.$transaction(async (tx) => {
    const created = await tx.book.create({ data: { name, status: 'ACTIVE' } });
    await audit(tx, 'BOOK_CREATED', 'Book', created.id, actor(req).id, { name });
    return created;
  });
  res.status(201).json(await bookView(book));
});
async function setStatus(bookId: bigint, status: 'ACTIVE' | 'ARCHIVED', actorId: bigint) {
  const book = await prisma.book.findUnique({ where: { id: bookId } });
  if (!book) throw errors.notFound('Book not found.');
  const changed = await prisma.$transaction(async (tx) => {
    const row = await tx.book.update({ where: { id: bookId }, data: { status } });
    await audit(tx, status === 'ARCHIVED' ? 'BOOK_ARCHIVED' : 'BOOK_RESTORED', 'Book', bookId, actorId, { name: row.name });
    return row;
  });
  return bookView(changed);
}
booksRouter.post('/:id/archive', requireAdmin, async (req, res) => res.json(await setStatus(id(req.params.id), 'ARCHIVED', actor(req).id)));
booksRouter.post('/:id/restore', requireAdmin, async (req, res) => res.json(await setStatus(id(req.params.id), 'ACTIVE', actor(req).id)));
