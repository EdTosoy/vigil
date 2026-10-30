import { parseArgs } from 'node:util';
import { authPool, type Role } from '../apps/ops/server/auth-service';
import { seedAccount } from '../apps/ops/server/seed-account';
import { visitor } from '../apps/ops/visitor';

async function main() {
  const { values } = parseArgs({
    options: {
      visitor: { type: 'boolean' },
      email: { type: 'string' },
      name: { type: 'string' },
      role: { type: 'string' },
      book: { type: 'string', multiple: true },
    },
  });
  const url = process.env['DATABASE_AUTH_SEED_URL'];
  if (
    !url ||
    url === process.env['DATABASE_ADMIN_URL'] ||
    url === process.env['DATABASE_OPERATIONS_URL']
  )
    throw new Error(
      'A separate DATABASE_AUTH_SEED_URL with only flow_auth_seeder is required',
    );
  const pool = authPool(url);
  try {
    await seedAccount(pool, {
      email: values.visitor ? visitor.email : (values.email ?? ''),
      name: values.visitor ? visitor.name : (values.name ?? ''),
      password: values.visitor
        ? visitor.password
        : (process.env['VIGIL_SEED_PASSWORD'] ?? ''),
      role: (values.visitor ? 'Viewer' : values.role) as Role,
      books: values.book ?? [],
      visitor: Boolean(values.visitor),
    });
    console.log(
      'Account created with explicit book grants. Existing accounts are never overwritten.',
    );
  } finally {
    await pool.end();
  }
}
main().catch(() => {
  // PostgreSQL/library exceptions may contain input values or connection details.
  console.error(
    'Account seed failed. Check unique email, role, book IDs and the scoped seed credential. No credentials were printed.',
  );
  process.exitCode = 1;
});
