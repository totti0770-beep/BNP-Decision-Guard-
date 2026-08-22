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
    process.env.S3_ACCESS_KEY = 'a-strong-s3-access-key';
    expect(() => freshLoad()()).toThrow(/JWT_SECRET/);
  });

  it('refuses to start in production with the demo database password', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-strong-secret';
    process.env.JWT_REFRESH_SECRET = 'a-strong-refresh-secret';
    process.env.POSTGRES_PASSWORD = 'bnp_secret';
    process.env.S3_SECRET_KEY = 'a-strong-s3-secret';
    process.env.S3_ACCESS_KEY = 'a-strong-s3-access-key';
    expect(() => freshLoad()()).toThrow(/POSTGRES_PASSWORD/);
  });

  it('boots in production when all secrets are set to non-defaults', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-strong-secret';
    process.env.JWT_REFRESH_SECRET = 'a-strong-refresh-secret';
    process.env.POSTGRES_PASSWORD = 'a-strong-db-password';
    process.env.S3_SECRET_KEY = 'a-strong-s3-secret';
    process.env.S3_ACCESS_KEY = 'a-strong-s3-access-key';
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
    process.env.S3_ACCESS_KEY = 'a-strong-s3-access-key';
    delete process.env.MAIL_PROVIDER;
    expect(() => freshLoad()()).not.toThrow();
  });

  it('refuses an explicitly selected smtp provider with no host', () => {
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-strong-secret';
    process.env.JWT_REFRESH_SECRET = 'a-strong-refresh-secret';
    process.env.POSTGRES_PASSWORD = 'a-strong-db-password';
    process.env.S3_SECRET_KEY = 'a-strong-s3-secret';
    process.env.S3_ACCESS_KEY = 'a-strong-s3-access-key';
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

/**
 * `NODE_ENV` selects the entire security posture — secret fail-fast, CORS
 * fail-closed, 5xx suppression, the reset-token refusal, the seed refusal and
 * the demo-account sweep all read it. A value it does not recognise used to
 * mean "development" silently, on whatever host that happened to be.
 */
describe('loadEnv NODE_ENV validation', () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL };
    jest.resetModules();
  });
  function freshLoad() {
    jest.resetModules();
    return require('./env').loadEnv;
  }

  it.each(['Production', 'prod', 'staging', 'PRODUCTION', 'production '.trim() + 'x'])(
    'refuses to boot on NODE_ENV=%s',
    (value) => {
      process.env.NODE_ENV = value;
      expect(() => freshLoad()()).toThrow(/NODE_ENV/);
    },
  );

  it.each(['production', 'development', 'test'])('accepts NODE_ENV=%s', (value) => {
    process.env.NODE_ENV = value;
    process.env.JWT_SECRET = 'a-strong-secret';
    process.env.JWT_REFRESH_SECRET = 'a-strong-refresh-secret';
    process.env.POSTGRES_PASSWORD = 'a-strong-db-password';
    process.env.S3_SECRET_KEY = 'a-strong-s3-secret';
    process.env.S3_ACCESS_KEY = 'a-strong-s3-access-key';
    expect(freshLoad()().nodeEnv).toBe(value);
  });

  it('treats an unset NODE_ENV as development, the documented local default', () => {
    delete process.env.NODE_ENV;
    expect(freshLoad()().nodeEnv).toBe('development');
  });
});

describe('S3_ACCESS_KEY fail-fast', () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL };
    jest.resetModules();
  });
  function prodEnv() {
    jest.resetModules();
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'a-strong-secret';
    process.env.JWT_REFRESH_SECRET = 'a-strong-refresh-secret';
    process.env.POSTGRES_PASSWORD = 'a-strong-db-password';
    process.env.S3_SECRET_KEY = 'a-strong-s3-secret';
    return require('./env').loadEnv;
  }

  // A demo access key with a real secret cannot reach the bucket at all, so
  // omitting it from the fail-fast only moved the failure to the first upload.
  it('refuses the shipped demo access key in production', () => {
    process.env.S3_ACCESS_KEY = 'bnp_minio';
    expect(() => prodEnv()()).toThrow(/S3_ACCESS_KEY/);
  });

  it('refuses a missing access key in production', () => {
    delete process.env.S3_ACCESS_KEY;
    expect(() => prodEnv()()).toThrow(/S3_ACCESS_KEY/);
  });
});

/**
 * The refusal threshold is the softest control in the clinical safety
 * contract. Both of its old failure modes were silent, and they failed in
 * opposite directions: a non-numeric value refused every question, a negative
 * one answered from chunks that had qualified for nothing.
 */
describe('ragMinSimilarity', () => {
  const ORIGINAL = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL };
    jest.resetModules();
  });
  function fresh() {
    jest.resetModules();
    return require('./env').ragMinSimilarity;
  }

  it('defaults to 0.25 when unset', () => {
    delete process.env.RAG_MIN_SIMILARITY;
    expect(fresh()()).toBe(0.25);
  });

  it.each(['0', '0.25', '0.6', '1'])('accepts %s', (value) => {
    process.env.RAG_MIN_SIMILARITY = value;
    expect(fresh()()).toBe(Number(value));
  });

  // This is the regression pin. `parseFloat('abc')` was NaN, `score >= NaN` is
  // always false, and the assistant refused every question — indistinguishable
  // from an empty corpus, with nothing logged. The old behaviour must be gone,
  // not merely improved.
  it.each(['abc', '', ' ', 'NaN', 'Infinity', '0.3-oops'])(
    'refuses %p instead of silently refusing every question',
    (value) => {
      process.env.RAG_MIN_SIMILARITY = value;
      const read = fresh();
      if (value.trim() === '') {
        // Empty is indistinguishable from unset and takes the default.
        expect(read()).toBe(0.25);
      } else {
        expect(() => read()).toThrow(/RAG_MIN_SIMILARITY/);
      }
    },
  );

  it.each(['-1', '-0.01', '2', '1.5'])(
    'refuses %s, which is outside the range cosine similarity can produce',
    (value) => {
      process.env.RAG_MIN_SIMILARITY = value;
      expect(() => fresh()()).toThrow(/\[0, 1\]/);
    },
  );

  it('fails the boot rather than waiting for the first question', () => {
    jest.resetModules();
    process.env.NODE_ENV = 'development';
    process.env.RAG_MIN_SIMILARITY = 'abc';
    expect(() => require('./env').loadEnv()).toThrow(/RAG_MIN_SIMILARITY/);
  });
});
