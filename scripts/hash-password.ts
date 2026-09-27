/**
 * Generate Argon2id password hash for testing
 * Usage: bun run scripts/hash-password.ts "password123"
 *
 * Outputs: $argon2id$v=19$m=19456,t=2,p=1$...
 */
import { hash } from '@node-rs/argon2';

const password = process.argv[2];
if (!password) {
  console.error('Usage: bun run scripts/hash-password.ts "password"');
  process.exit(1);
}

try {
  const hashed = await hash(password, {
    memoryCost: 19456,  // 19 MiB (OWASP minimum)
    timeCost: 2,
    parallelism: 1,
    version: 19,
  });
  console.log(hashed);
} catch (err) {
  console.error('Error hashing password:', err);
  process.exit(1);
}
