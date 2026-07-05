import { AppDataSource } from '../config/data-source';

async function main() {
  const ds = await AppDataSource.initialize();
  const applied = await ds.runMigrations();
  console.log(
    applied.length
      ? `Applied migrations: ${applied.map((m) => m.name).join(', ')}`
      : 'Database schema is up to date.',
  );
  await ds.destroy();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
