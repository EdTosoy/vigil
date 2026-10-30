import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { Pool } from 'pg';
import { checkAuthCredential, type Role } from './auth-service';
import { visitor } from '../visitor';

export async function seedAccount(
  pool: Pool,
  input: {
    email: string;
    password: string;
    name: string;
    role: Role;
    books: string[];
    visitor?: boolean;
  },
) {
  await checkAuthCredential(pool, true);
  if (
    !['Admin', 'Operator', 'Viewer'].includes(input.role) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
    input.password.length < 12 ||
    input.password.length > 128 ||
    !input.name.trim() ||
    !input.books.length ||
    input.books.length > 100 ||
    input.books.some(
      (book) => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(book),
    )
  )
    throw new Error('Invalid account seed inputs');
  const isVisitor = input.email.toLowerCase() === visitor.email;
  if (
    Boolean(input.visitor) !== isVisitor ||
    (isVisitor &&
      (input.role !== 'Viewer' || input.password !== visitor.password))
  )
    throw new Error(
      'The shared visitor identity must remain a synthetic-only Viewer',
    );
  if (!isVisitor && input.password === visitor.password)
    throw new Error('Staff must use a private password');
  // Use Better Auth's password implementation; never implement hashing ourselves.
  const password = await hashPassword(input.password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const book of input.books) {
      const { rows } = await client.query<{ allowed: boolean }>(
        'SELECT app_auth.seed_book($1,$2) AS allowed',
        [book, isVisitor],
      );
      if (!rows[0]?.allowed)
        throw new Error(
          'Book missing or not synthetic; account was not created',
        );
    }
    const id = randomUUID();
    await client.query(
      'INSERT INTO app_auth."user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,false,now(),now())',
      [id, input.name, input.email.toLowerCase()],
    );
    await client.query(
      'INSERT INTO app_auth.account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,\'credential\',$2,$3,now(),now())',
      [randomUUID(), id, password],
    );
    await client.query(
      'INSERT INTO app_auth.principal(user_id,role,synthetic_only) VALUES($1,$2,$3)',
      [id, input.role, isVisitor],
    );
    for (const book of new Set(input.books))
      await client.query(
        'INSERT INTO app_auth.book_grant(user_id,book_id) VALUES($1,$2)',
        [id, book],
      );
    await client.query('COMMIT');
    return id;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
import 'server-only';
