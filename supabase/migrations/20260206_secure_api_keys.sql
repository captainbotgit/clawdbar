-- Migration: Secure API Key Storage
-- Date: 2026-02-06
-- Author: Forge (DevOps Agent)
-- 
-- SECURITY FIX: Move from plaintext API keys to bcrypt hashes
-- 
-- Changes:
-- 1. Add api_key_hash column (stores bcrypt hash)
-- 2. Add api_key_prefix column (first 16 chars for efficient lookup)
-- 3. Drop old api_key column (plaintext - INSECURE)
-- 4. Add index on api_key_prefix for fast lookups

-- Step 1: Add new secure columns
ALTER TABLE agents 
ADD COLUMN IF NOT EXISTS api_key_hash TEXT,
ADD COLUMN IF NOT EXISTS api_key_prefix VARCHAR(16);

-- Step 2: Add index for efficient prefix lookups
CREATE INDEX IF NOT EXISTS idx_agents_api_key_prefix 
ON agents(api_key_prefix);

-- Step 3: IMPORTANT - Existing agents need new keys!
-- Option A: Force re-registration (recommended for security)
-- Option B: Generate new keys and email them (if email available)
-- 
-- For now, we'll mark existing agents as needing key regeneration
-- by setting their api_key_hash to NULL (they'll fail auth until reset)

-- Step 4: Drop the insecure plaintext column
-- DANGER: This invalidates ALL existing API keys!
-- Run this AFTER notifying existing agents to re-register
-- 
-- ALTER TABLE agents DROP COLUMN IF EXISTS api_key;

-- MANUAL STEP REQUIRED:
-- 1. Deploy code changes first
-- 2. Notify existing agents to re-register
-- 3. Uncomment and run the DROP COLUMN above
-- 4. Remove this comment block

-- Notes for production:
-- - All existing agents will need to re-register to get new keys
-- - Consider a grace period where both old and new auth work
-- - Monitor for failed auth attempts after migration
