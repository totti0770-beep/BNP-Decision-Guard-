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
    process.env.MAIL_PROVIDER = 'smtp';
    process.env.MAIL_HOST = 'smtp.example.health';
    const env = freshLoad()();
    expect(env.cors.origins).toEqual(['https://bnp.example.health']);
    // Reset links resolve against the configured web origin by default.
    expect(env.appBaseUrl).toBe('https://bnp.example.health');
  });

  it('still boots in production with log-only mail (degraded, not fatal)', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-strong-secret';
    process.env.JWT_REFRESH_SECRET = 'a-strong-refresh-secret';
    process.env.POSTGRES_PASSWORD = 'a-strong-db-password';
    process.env.S3_SECRET_KEY = 'a-strong-s3-secret';
    delete process.env.MAIL_PROVIDER;
    expect(() => freshLoad()()).not.toThrow();
  });

  it('refuses an explicitly selected smtp provider with no host', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-strong-secret';
    process.env.JWT_REFRESH_SECRET = 'a-strong-refresh-secret';
    process.env.POSTGRES_PASSWORD = 'a-strong-db-password';
    process.env.S3_SECRET_KEY = 'a-strong-s3-secret';
    process.env.MAIL_PROVIDER = 'smtp';
    delete process.env.MAIL_HOST;
    expect(() => freshLoad()()).toThrow(/MAIL_HOST/);
  });

  it('applies local defaults and does not throw outside production', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.JWT_SECRET;
    delete process.env.POSTGRES_PASSWORD;
    const env = freshLoad()();
    expect(env.cors.origins).toContain('http://localhost:3000');
  });
});

/**
 * Token lifetimes come from the environment as free text, so an unparseable
 * value used to reach `jwt.sign` and fail on the first login rather than at
 * boot. Validating here is also what lets the value be typed for
 * jsonwebtoken 9, whose types no longer accept a bare `string`.
 */
describe('JWT lifetime validation', () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
    jest.resetModules();
  });

  function freshLoad() {
    jest.resetModules();
    return require('./env').loadEnv;
  }

  it('defaults to 1h / 7d when unset', () => {
    delete process.env.JWT_EXPIRES_IN;
    delete process.env.JWT_REFRESH_EXPIRES_IN;
    const env = freshLoad()();
    expect(env.jwt.expiresIn).toBe('1h');
    expect(env.jwt.refreshExpiresIn).toBe('7d');
  });

  it.each(['30s', '15m', '1h', '7d', '2w', '1y', '1.5h'])(
    'accepts %s',
    (value) => {
      process.env.JWT_EXPIRES_IN = value;
      expect(freshLoad()().jwt.expiresIn).toBe(value);
    },
  );

  it('reads a bare number as seconds', () => {
    process.env.JWT_EXPIRES_IN = '900';
    expect(freshLoad()().jwt.expiresIn).toBe(900);
  });

  it.each(['1 hour', 'forever', '7 days', 'd7', ''])(
    'rejects %s at boot rather than at the first login',
    (value) => {
      process.env.JWT_EXPIRES_IN = value;
      const load = freshLoad();
      // An empty string is falsy and legitimately falls back to the default;
      // everything else must name the offending variable and the valid forms.
      if (value === '') {
        expect(load().jwt.expiresIn).toBe('1h');
      } else {
        expect(() => load()).toThrow(/JWT_EXPIRES_IN/);
      }
    },
  );

  it('validates the refresh lifetime too, not only the access one', () => {
    process.env.JWT_REFRESH_EXPIRES_IN = 'a fortnight';
    expect(() => freshLoad()()).toThrow(/JWT_REFRESH_EXPIRES_IN/);
  });
});

