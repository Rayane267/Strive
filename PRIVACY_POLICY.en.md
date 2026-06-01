# Privacy Policy — Strive

[🇫🇷 Français](./PRIVACY_POLICY.md) · 🇬🇧 English

**Last updated: May 29, 2026**

Strive (the "App") is a mobile application for ride-hailing drivers that scans the ride offers displayed in the Uber, Bolt and Heetch apps in order to calculate ride profitability in real time. This policy describes how we process your data.

**Publisher:** [Your name / company]
**Contact:** [your-email@domain.com]
**Hosting:** Supabase (user data), Sentry (errors), Google Firebase (push notifications)

---

## 1. Data collected

### 1.1 Account data
When you create an account, we collect:
- **Email address** (via direct sign-up or Google/Apple OAuth)
- **Anonymous Google/Apple identifier** (if OAuth)
- **User preferences** (€/h and €/km thresholds, pickup inclusion, verdict sound)

### 1.2 Ride data
Each time you scan a ride offer, we record:
- **Platform** (Uber / Bolt / Heetch)
- **Displayed fare** (net)
- **Estimated distance and duration**
- **Pickup and destination addresses**
- **Calculated hourly and per-kilometer rates**
- **Ride status** (accepted, declined, pending)
- **Timestamp**

This data is used to display your history and compute your statistics. It is never sold or shared with commercial third parties.

The **pickup and destination addresses** form your professional logbook (a record of your driving activity). For data minimization, these addresses are **automatically erased after 12 months**; the rest of the ride (fare, distance, duration, status) is kept for your statistics. You can also delete your entire history at any time (see §5).

### 1.3 Technical data
- **Device identifier** (for push notifications via Firebase)
- **Anonymized error logs** (via Sentry, for bug diagnosis)
- **RevenueCat subscription** (active/inactive status, no payment information)

### 1.4 What we do NOT collect
- Content of the Uber, Bolt, Heetch screens beyond the fields extracted by OCR
- Browsing history
- Real-time geolocation (we do not access GPS)
- Contacts, photos, personal files
- Banking data (RevenueCat handles payments directly via the App Store / Play Store)

---

## 2. Android accessibility service

Strive uses the **Android accessibility service** and **screen capture (MediaProjection)** exclusively to:
- Allow the floating bubble to appear over the ride-hailing apps
- Capture the screen, **only when you tap the scan button**, to analyze the offer via OCR (Google ML Kit, on-device analysis)

**No screen capture is performed without your explicit action.** No personal data is read from other apps. OCR analysis runs locally; the captured image is not sent to any third-party server, except when local OCR fails entirely — in that case, and only then, a compressed image is sent to our Supabase Edge Function, which analyzes it via Gemini (Google AI) and then deletes it immediately.

---

## 3. Processors and transfers

Your data may be processed by the following processors:

| Processor | Role | Hosting |
|---|---|---|
| **Supabase** | Database, authentication, edge functions | EU (Frankfurt) |
| **Google Firebase** | Push notifications (FCM) | EU / US |
| **Sentry** | Anonymized error diagnosis | EU |
| **RevenueCat** | Subscription management | US |
| **TomTom** | Address geocoding, route calculation | EU (Amsterdam) |
| **Google Gemini** | OCR fallback (only if local OCR fails) | US |

Transfers outside the EU are governed by the European Commission's Standard Contractual Clauses or the Data Privacy Framework.

---

## 4. Retention period

- **Account data**: as long as the account is active, then 30 days after deletion
- **Ride history**: kept as long as the account is active. **Pickup/destination addresses are automatically erased after 12 months**; other ride data (fare, distance, duration, status) remains available for your statistics. You can delete your entire history at any time from the app (see §5)
- **Sentry error logs**: 90 days maximum
- **RevenueCat billing data**: legal retention period (10 years)

---

## 5. Your rights (GDPR)

In accordance with the GDPR, you have the following rights:
- **Access**: obtain a copy of your data
- **Rectification**: correct inaccurate data
- **Erasure**: delete your account and all associated data
- **Portability**: receive your data in a machine-readable format (JSON)
- **Objection**: object to processing for statistical purposes

To exercise these rights, contact us at **[your-email@domain.com]**. You may also lodge a complaint with your data protection authority (in France, the CNIL — www.cnil.fr).

### Account deletion
You can delete your account directly from the app: **Profile → Settings → Delete account**. Deletion is permanent and irreversible after a 7-day grace period.

### Ride history deletion
You can erase your entire ride history (including addresses) without deleting your account: **Profile → Account information → Delete my history**. This deletion is permanent and immediate.

---

## 6. Security

- Encrypted TLS 1.3 connections to all servers
- Authentication via OAuth 2.0 (Google, Apple) or email + hashed password (bcrypt, via Supabase Auth)
- RLS (Row Level Security) on Supabase: each user can only read/write their own data
- No sensitive API key is stored on the client (Gemini calls routed via an edge function)

---

## 7. Cookies and trackers

The mobile app does not use cookies. No advertising tracker is integrated.

---

## 8. Children

Strive is intended for professional adults (ride-hailing drivers). The app is not designed for minors and does not knowingly collect their data.

---

## 9. Changes

This policy may be updated. The "Last updated" date indicates the version in force. Substantial changes will be notified in the app.

---

## 10. Contact

**Publisher:** [Your name / company]
**Email:** [your-email@domain.com]
**Address:** [Your postal address if sole trader]
