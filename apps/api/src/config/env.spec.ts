/**
 * The production fail-fast is a security control: a prod deploy must not boot
 * with shipped default secrets. These tests pin that contract.
 */
describe('loadEnv production fail-fast', () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
    jest.resetModules();
  });

  function freshLoad() {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('./env').loadEnv;
  }

  it('refuses to start in production with a default JWT secret', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'change-me-in-production';
    process.env.JWT_REFRESH_SECRET = 'a-strong-refresh-secret';
    process.env.POSTGRES_PASSWORD = 'a-strong-db-password';
    process.env.S3_SECRET_KEY = 'a-strong-s3-secret';
    expect(() => freshLoad()()).toThrow(/JWT_SECRET/);
  });

  it('refuses to start in production with the demo database password', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-strong-secret';
    process.env.JWT_REFRESH_SECRET = 'a-strong-refresh-secret';
    process.env.POSTGRES_PASSWORD = 'bnp_secret';
    process.env.S3_SECRET_KEY = 'a-strong-s3-secret';
    expect(() => freshLoad()()).toThrow(/POSTGRES_PASSWORD/);
  });

  it('boots in production when all secrets are set to non-defaults', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-strong-secret';
    process.env.JWT_REFRESH_SECRET = 'a-strong-refresh-secret';
    process.env.POSTGRES_PASSWORD = 'a-strong-db-password';
    process.env.S3_SECRET_KEY = 'a-strong-s3-secret';
    process.env.CORS_ORIGINS = 'https://bnp.example.health';
    const env = freshLoad()();
    expect(env.cors.origins).toEqual(['https://bnp.example.health']);
  });

  it('applies local defaults and does not throw outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    delete process.env.POSTGRES_PASSWORD;
    const env = freshLoad()();
    expect(env.cors.origins).toContain('http://localhost:3000');
  });
});
