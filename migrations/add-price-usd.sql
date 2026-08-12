-- ============================================
-- Migration: add price_usd for dual currency pricing (INR via Razorpay, USD via PayPal)
-- Safe to run on an already-deployed database — uses IF NOT EXISTS.
-- ============================================

ALTER TABLE courses ADD COLUMN IF NOT EXISTS price_usd DECIMAL(10, 2);

COMMENT ON COLUMN courses.price IS 'INR price, charged via Razorpay';
COMMENT ON COLUMN courses.price_usd IS 'USD price, charged via PayPal (NULL = PayPal disabled for this course)';
