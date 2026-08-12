-- ============================================
-- PAYMENT INTEGRATION SCHEMA
-- Run this AFTER schema.sql and schema-extensions.sql.
--
-- Adds payment_orders (tracks pending/paid Razorpay + PayPal transactions)
-- and — importantly — CLOSES A SECURITY HOLE in the original schema:
-- user_courses previously had an RLS policy letting any authenticated
-- client INSERT a row with payment_status='completed' directly. Combined
-- with lms.js's old purchaseCourse() (which did exactly that client-side,
-- with no real payment behind it), this meant anyone could open devtools
-- and grant themselves any course for free — the "purchase" flow was
-- never actually gated by payment.
--
-- After this migration, only the service-role key (used exclusively by
-- /api/create-order.js, /api/verify-order.js, and /api/enroll-free.js) can
-- write to user_courses. Real payment or an explicit $0 request is the
-- only way in.
-- ============================================

-- ============================================
-- PAYMENT ORDERS — tracks each checkout attempt
-- ============================================
CREATE TABLE IF NOT EXISTS payment_orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id VARCHAR(64) UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    course_id UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
    provider VARCHAR(20) NOT NULL CHECK (provider IN ('razorpay', 'paypal')),
    provider_order_id TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed')),
    amount NUMERIC(10, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'INR',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_order_id ON payment_orders(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_user_id ON payment_orders(user_id);

ALTER TABLE payment_orders ENABLE ROW LEVEL SECURITY;

-- Users can see their own order history (for support/debugging purposes);
-- they cannot see other people's orders.
CREATE POLICY "Users can view their own payment orders"
    ON payment_orders FOR SELECT
    USING (auth.uid() = user_id);

-- Deliberately NO insert/update policy for authenticated users here.
-- All writes to this table happen via /api/create-order.js and
-- /api/verify-order.js using SUPABASE_SERVICE_ROLE_KEY, which bypasses RLS
-- entirely. This means a user can never mark their own order 'paid' by
-- calling supabase.from('payment_orders').insert(...) from the browser.

CREATE TRIGGER update_payment_orders_updated_at
    BEFORE UPDATE ON payment_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- CLOSE THE MOCK-PAYMENT HOLE
-- ============================================
-- Remove the original policy that let any authenticated user insert
-- directly into user_courses with payment_status='completed'.
DROP POLICY IF EXISTS "Users can insert their own course purchases" ON user_courses;

-- No replacement INSERT policy is added for authenticated clients.
-- Course access is now only ever granted by:
--   - /api/verify-order.js, after independently confirming payment with
--     Razorpay or PayPal (never trusting client-supplied payment status)
--   - /api/enroll-free.js, for courses priced at $0
-- Both use the service-role key, which bypasses RLS.
