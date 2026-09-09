-- 0009: Migrar canal 2FA de 'sms' → 'whatsapp' (Meta Graph API)
-- ───────────────────────────────────────────────────────────────
-- Atualiza dados existentes, remove a constraint antiga e recria com 'whatsapp'.

UPDATE login_challenges SET channel = 'whatsapp' WHERE channel = 'sms';

ALTER TABLE login_challenges
  DROP CONSTRAINT IF EXISTS login_challenges_channel_check;

ALTER TABLE login_challenges
  ADD CONSTRAINT login_challenges_channel_check
  CHECK (channel IN ('whatsapp'));
