-- Agent template architecture.
-- This migration is intentionally additive so it can be applied to existing dev
-- databases that were previously updated with prisma db push.

CREATE TABLE IF NOT EXISTS "model_providers" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "base_url" TEXT,
  "api_key" TEXT,
  "models" JSONB NOT NULL DEFAULT '[]',
  "config" JSONB NOT NULL DEFAULT '{}',
  "is_active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "model_providers_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "channels" ADD COLUMN IF NOT EXISTS "agent_template_id" TEXT;
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "model_provider_id" TEXT;
ALTER TABLE "ai_backends" ADD COLUMN IF NOT EXISTS "model_provider_id" TEXT;
ALTER TABLE "ai_backends" ADD COLUMN IF NOT EXISTS "runtime_type" TEXT NOT NULL DEFAULT 'openclaw';
ALTER TABLE "ai_backends" ADD COLUMN IF NOT EXISTS "skills" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "ai_backends" ADD COLUMN IF NOT EXISTS "workspace" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "ai_backends" ADD COLUMN IF NOT EXISTS "knowledge_base" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS "model_providers_tenant_id_idx" ON "model_providers"("tenant_id");
CREATE INDEX IF NOT EXISTS "channels_agent_template_id_idx" ON "channels"("agent_template_id");
CREATE INDEX IF NOT EXISTS "ai_backends_model_provider_id_idx" ON "ai_backends"("model_provider_id");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'model_providers_tenant_id_fkey') THEN
    ALTER TABLE "model_providers"
      ADD CONSTRAINT "model_providers_tenant_id_fkey"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'channels_agent_template_id_fkey') THEN
    ALTER TABLE "channels"
      ADD CONSTRAINT "channels_agent_template_id_fkey"
      FOREIGN KEY ("agent_template_id") REFERENCES "ai_backends"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'conversations_model_provider_id_fkey') THEN
    ALTER TABLE "conversations"
      ADD CONSTRAINT "conversations_model_provider_id_fkey"
      FOREIGN KEY ("model_provider_id") REFERENCES "model_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_backends_model_provider_id_fkey') THEN
    ALTER TABLE "ai_backends"
      ADD CONSTRAINT "ai_backends_model_provider_id_fkey"
      FOREIGN KEY ("model_provider_id") REFERENCES "model_providers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

