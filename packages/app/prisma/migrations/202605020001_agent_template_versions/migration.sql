CREATE TABLE IF NOT EXISTS "agent_template_versions" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "agent_template_id" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "name" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "notes" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "agent_template_versions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "agent_template_version_id" TEXT;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "agent_template_version_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "agent_template_versions_agent_template_id_version_key"
  ON "agent_template_versions"("agent_template_id", "version");
CREATE INDEX IF NOT EXISTS "agent_template_versions_tenant_id_idx"
  ON "agent_template_versions"("tenant_id");
CREATE INDEX IF NOT EXISTS "agent_template_versions_agent_template_id_idx"
  ON "agent_template_versions"("agent_template_id");
CREATE INDEX IF NOT EXISTS "channels_agent_template_version_id_idx"
  ON "channels"("agent_template_version_id");
CREATE INDEX IF NOT EXISTS "conversations_agent_template_version_id_idx"
  ON "conversations"("agent_template_version_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_template_versions_tenant_id_fkey') THEN
    ALTER TABLE "agent_template_versions"
      ADD CONSTRAINT "agent_template_versions_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agent_template_versions_agent_template_id_fkey') THEN
    ALTER TABLE "agent_template_versions"
      ADD CONSTRAINT "agent_template_versions_agent_template_id_fkey"
      FOREIGN KEY ("agent_template_id") REFERENCES "ai_backends"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'channels_agent_template_version_id_fkey') THEN
    ALTER TABLE "channels"
      ADD CONSTRAINT "channels_agent_template_version_id_fkey"
      FOREIGN KEY ("agent_template_version_id") REFERENCES "agent_template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_agent_template_version_id_fkey') THEN
    ALTER TABLE "conversations"
      ADD CONSTRAINT "conversations_agent_template_version_id_fkey"
      FOREIGN KEY ("agent_template_version_id") REFERENCES "agent_template_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
