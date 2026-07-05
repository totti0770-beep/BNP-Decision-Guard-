import { MigrationInterface, QueryRunner } from 'typeorm';

const EMBEDDING_DIM = 384;

export class InitialSchema1720000000000 implements MigrationInterface {
  name = 'InitialSchema1720000000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS vector`);

    await q.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        email varchar(255) NOT NULL UNIQUE,
        password_hash varchar(255) NOT NULL,
        full_name varchar(255) NOT NULL,
        is_active boolean NOT NULL DEFAULT true,
        mfa_enabled boolean NOT NULL DEFAULT false,
        mfa_secret varchar(255),
        last_login_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE roles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(100) NOT NULL UNIQUE,
        description varchar(500),
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(100) NOT NULL UNIQUE,
        description varchar(500),
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE role_permissions (
        role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, permission_id)
      )`);

    await q.query(`
      CREATE TABLE user_roles (
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        PRIMARY KEY (user_id, role_id)
      )`);

    await q.query(`
      CREATE TABLE documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        title varchar(500) NOT NULL,
        description text,
        category varchar(50) NOT NULL,
        status varchar(20) NOT NULL DEFAULT 'DRAFT',
        version_number int NOT NULL DEFAULT 1,
        file_name varchar(500) NOT NULL,
        mime_type varchar(100) NOT NULL DEFAULT 'application/pdf',
        size_bytes bigint NOT NULL DEFAULT 0,
        storage_key varchar(1000) NOT NULL,
        uploaded_by_id uuid REFERENCES users(id),
        approved_by_id uuid REFERENCES users(id),
        approval_date timestamptz,
        expiry_date timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_documents_status ON documents(status)`);
    await q.query(`CREATE INDEX idx_documents_category ON documents(category)`);

    await q.query(`
      CREATE TABLE document_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        version_number int NOT NULL,
        file_name varchar(500) NOT NULL,
        size_bytes bigint NOT NULL DEFAULT 0,
        storage_key varchar(1000) NOT NULL,
        change_note text,
        created_by_id uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (document_id, version_number)
      )`);

    await q.query(`
      CREATE TABLE document_chunks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        version_number int NOT NULL DEFAULT 1,
        chunk_index int NOT NULL,
        page_number int,
        content text NOT NULL,
        embedding vector(${EMBEDDING_DIM}),
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_chunks_document ON document_chunks(document_id)`);
    await q.query(
      `CREATE INDEX idx_chunks_embedding ON document_chunks
       USING hnsw (embedding vector_cosine_ops)`,
    );

    await q.query(`
      CREATE TABLE document_approvals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        action varchar(30) NOT NULL,
        from_status varchar(20) NOT NULL,
        to_status varchar(20) NOT NULL,
        actor_id uuid REFERENCES users(id),
        comment text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE ai_questions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid REFERENCES users(id),
        question text NOT NULL,
        assistant_type varchar(30) NOT NULL DEFAULT 'NURSING',
        category varchar(50),
        channel varchar(20) NOT NULL DEFAULT 'WEB',
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE ai_answers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        question_id uuid NOT NULL REFERENCES ai_questions(id) ON DELETE CASCADE,
        short_answer text NOT NULL,
        steps jsonb NOT NULL DEFAULT '[]',
        warnings jsonb NOT NULL DEFAULT '[]',
        confidence varchar(10) NOT NULL DEFAULT 'NONE',
        refused boolean NOT NULL DEFAULT false,
        model varchar(100),
        latency_ms int,
        review_status varchar(20) NOT NULL DEFAULT 'UNREVIEWED',
        reviewed_by_id uuid REFERENCES users(id),
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE citations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        answer_id uuid NOT NULL REFERENCES ai_answers(id) ON DELETE CASCADE,
        document_id uuid REFERENCES documents(id) ON DELETE SET NULL,
        chunk_id uuid REFERENCES document_chunks(id) ON DELETE SET NULL,
        document_title varchar(500) NOT NULL,
        page_number int,
        approval_date timestamptz,
        similarity real NOT NULL DEFAULT 0,
        snippet text,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE dose_formulas (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(255) NOT NULL,
        drug_name varchar(255) NOT NULL,
        formula_type varchar(30) NOT NULL,
        dose_per_kg numeric(12,4),
        fixed_dose numeric(12,4),
        max_single_dose numeric(12,4),
        max_daily_dose numeric(12,4),
        unit varchar(20) NOT NULL DEFAULT 'mg',
        default_route varchar(20),
        default_frequency_per_day int,
        notes text,
        source_document_id uuid REFERENCES documents(id),
        status varchar(20) NOT NULL DEFAULT 'DRAFT',
        created_by_id uuid REFERENCES users(id),
        approved_by_id uuid REFERENCES users(id),
        approved_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE dose_calculations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid REFERENCES users(id),
        formula_id uuid REFERENCES dose_formulas(id),
        inputs jsonb NOT NULL,
        steps jsonb NOT NULL DEFAULT '[]',
        final_dose_mg numeric(12,4),
        volume_ml numeric(12,4),
        warnings jsonb NOT NULL DEFAULT '[]',
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE audit_logs (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        actor_id uuid,
        actor_email varchar(255),
        action varchar(100) NOT NULL,
        resource_type varchar(100),
        resource_id varchar(100),
        metadata jsonb,
        ip varchar(64),
        user_agent varchar(500),
        created_at timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX idx_audit_created ON audit_logs(created_at DESC)`);
    await q.query(`CREATE INDEX idx_audit_action ON audit_logs(action)`);

    await q.query(`
      CREATE TABLE notifications (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid REFERENCES users(id) ON DELETE CASCADE,
        type varchar(50) NOT NULL,
        title varchar(255) NOT NULL,
        message text NOT NULL,
        is_read boolean NOT NULL DEFAULT false,
        metadata jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )`);

    await q.query(`
      CREATE TABLE settings (
        key varchar(100) PRIMARY KEY,
        value jsonb NOT NULL,
        description varchar(500),
        updated_by_id uuid REFERENCES users(id),
        updated_at timestamptz NOT NULL DEFAULT now()
      )`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of [
      'settings',
      'notifications',
      'audit_logs',
      'dose_calculations',
      'dose_formulas',
      'citations',
      'ai_answers',
      'ai_questions',
      'document_approvals',
      'document_chunks',
      'document_versions',
      'documents',
      'user_roles',
      'role_permissions',
      'permissions',
      'roles',
      'users',
    ]) {
      await q.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
  }
}
