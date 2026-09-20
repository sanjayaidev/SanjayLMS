# AICreator prebooking

Landing page (sanjaymeher.online) -> `/api/prebook` -> Razorpay Checkout -> `/api/prebook-verify`
(+ webhook as backup) -> `prebookings` row marked `paid` -> buyer signs up / logs in with the
same email -> `claim_prebookings()` creates `user_courses` rows.

## Setup (in order)

1. **Run `supabase/prebooking.sql`** in the Supabase SQL editor (steps 1-4; step 5 is commented out).
2. **Vercel env vars** (Project -> Settings -> Environment Variables), then redeploy:

   | Name | Value |
   |---|---|
   | `SUPABASE_URL` | your project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase -> Settings -> API -> service_role. Server only. |
   | `RAZORPAY_KEY_ID` | `rzp_test_...` while testing, `rzp_live_...` later |
   | `RAZORPAY_KEY_SECRET` | matching secret |
   | `RAZORPAY_WEBHOOK_SECRET` | any long random string; paste the same one into Razorpay |
   | `ALLOWED_ORIGINS` | optional; defaults to `https://sanjaymeher.online,https://www.sanjaymeher.online` |

3. **Razorpay webhook**: Dashboard -> Webhooks -> Add.
   URL `https://sanjay-lms.vercel.app/api/razorpay-webhook`, events `payment.captured` and `order.paid`,
   secret = `RAZORPAY_WEBHOOK_SECRET`.
4. **Claim on login.** Wherever the LMS establishes a session (after login in `login.html` and on
   page load in `index.html` / `my-courses.html`), add:

   ```js
   const { data: claimed } = await supabase.rpc('claim_prebookings');
   if (claimed > 0) { /* re-fetch the user's courses so they appear immediately */ }
   ```

   (Use whatever your Supabase client variable is called.) It is safe to call on every load.
5. **Landing page**: apply `aicreator-landing-prebooking.patch` (or use `aicreator-landing-v2.html`).
   `API_BASE` in its script must match your Vercel domain.
6. **Activate the courses** (`is_active = true`) in the admin panel as you upload each module's lessons.
   Prebooked buyers see them the moment they go live.

## Test in Razorpay test mode before going live

- Buy Module 1 only -> `prebookings` row goes `pending` -> `paid`.
- Select 6 modules -> charged exactly 1499, `course_ids` has 8 entries.
- Sign up with the same email (confirm it) -> `claim_prebookings()` returns 1, `user_courses` has the rows, status `claimed`.
- Sign up with a different email -> nothing is claimed.
- Pay, then close the tab before the success screen -> the webhook should still flip it to `paid`
  (use Razorpay's "Send test webhook" if the raw-body signature check fails; see caveats).

## Close the free-course hole

The existing RLS policy "Users can insert their own course purchases" lets a logged-in user insert
`user_courses` with `payment_status = 'completed'` from the browser, without paying. Once the
LMS's own `purchaseCourse()` no longer relies on client-side inserts, run step 5 of the SQL file:

```sql
DROP POLICY "Users can insert their own course purchases" ON user_courses;
```

Doing this earlier will break the current (mock) purchase button, which is why it is a separate step.

## Caveats: things I could not see

I could read `schema.sql` and the README but not `lms.js`, `api-routes.js`, `vercel.json` or `package.json`.

- If `vercel.json` has a catch-all rewrite, exclude `/api/*` from it.
- If `package.json` has `"type": "module"` or not, the `.mjs` files work either way. No new dependencies are needed.
- `razorpay-webhook.mjs` relies on `config.api.bodyParser = false` to get the raw body. If Razorpay's test webhook
  fails the signature check, the normal flow still works through `/api/prebook-verify`; only the closed-tab backup is affected.
- Bundle buyers get `user_courses` rows for m1-m8 with no per-course `purchased_price`.
