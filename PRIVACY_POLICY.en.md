# Privacy Policy — Strive

[🇫🇷 Français](./PRIVACY_POLICY.md) · 🇬🇧 English

**Last updated: June 13, 2026**

---

## Preamble

This Privacy Policy describes how the publisher of the Strive mobile application (the "**Publisher**", "**we**") collects, uses, shares and protects the personal data of users (the "**User**", "**you**"), in accordance with Regulation (EU) 2016/679 ("**GDPR**") and applicable data-protection law.

Strive is a decision-support tool for self-employed VTC drivers: at the User's request, the Application reads a ride offer displayed on screen in order to estimate its profitability. Protecting your privacy is at the core of the Service's design (*privacy by design*).

> 🔒 **Our core commitments.** Strive is **fully independent and has no connection with Uber, Bolt, Heetch** or any other VTC platform. We **do not exploit, resell or transfer any of your data**, nor that of passengers who may appear on screen. **No advertising, no ad tracking, no data brokering.** Your data is used solely to provide the Service you request.

## 1. Data controller

The data controller is the publisher of Strive:

> **[TO BE COMPLETED: company name or individual, legal form, registration number, registered office]**

**Contact (and to exercise your rights):** supportstriveapp@gmail.com — **[TO BE COMPLETED: Data Protection Officer details, if any]**

## 2. Data we process

We apply the principle of minimisation: we only process data necessary for the Service.

**2.1 — Account data**: email address, account identifier; sign-in method (email, Google, Apple).

**2.2 — Profile & vehicle**: make, model, year, fuel type and average consumption of your vehicle; device language and time zone; preferences (minimum €/h and €/km thresholds, day-reset time, display options).

**2.3 — Scanned rides**: platform, proposed fare, distance, duration, status (accepted / declined), timestamp; pickup and drop-off addresses present in the offer (used to compute real distance/duration and feed your history); driving sessions (start, end, duration).

**2.4 — Subscription data**: subscription status and type, Scan credits, technical identifier from our subscription-management provider. **We have no access to any banking data**: payments are handled by the App Store or Google Play.

**2.5 — Technical data & notifications**: push notification token; technical logs of sensitive actions and error/crash reports (security, stability).

**2.6 — Quality measurement & diagnostics**
- **Non-identifying telemetry**: per Scan, aggregatable indicators (platform, number of addresses detected, price bracket, verdict, whether cloud fallback was used). **Never the exact amount, addresses or coordinates.**
- **Diagnostic capture (beta, with consent)**: when local analysis fails to read an address, the Application may store the OCR text blocks of the scanned screen (which may contain addresses) to improve reliability. These captures are **private, visible to you only, kept for 30 days maximum**, and limited to the testing phase.

## 3. OCR technology: how it works and our safeguards

- **Voluntary, one-off reading**: OCR is only triggered by a deliberate action (the Scan). The Application does not read the screen continuously and does not monitor your activity in the background.
- **Mainly local processing**: analysis runs on your device (ML Kit on Android, Vision on iOS). **No screenshot is stored.**
- **Cloud fallback**: where local reading fails, the offer image may be securely transmitted, for the duration of the analysis only, to our image-analysis provider (Google Gemini API).
- **No exploitation of passenger data**: any third-party data visible on screen (a passenger's first name or exact address) is **neither exploited nor resold**, and is used only for the profitability calculation you request. It is never included in telemetry.

## 4. Purposes and legal bases

| Purpose | Legal basis (GDPR) |
|---|---|
| Provide the Service (scan, verdict, history, statistics, subscription) | Performance of the contract (Art. 6.1.b) |
| Improve OCR reliability, prevent fraud and abuse, ensure security | Legitimate interest (Art. 6.1.f) |
| Push notifications and diagnostic capture (beta) | Consent (Art. 6.1.a), revocable at any time |
| Comply with legal obligations | Legal obligation (Art. 6.1.c) |

## 5. Recipients and processors

We **sell no data** and display **no advertising**. We use technical processors (Art. 28 GDPR) strictly necessary for the Service:

- **Supabase** — hosting, database and authentication;
- **Google (Gemini API)** — cloud image-analysis fallback;
- **Google (Firebase, Sign-In, Play)** — notifications, sign-in, distribution;
- **TomTom** — geolocation, geocoding and route calculation;
- **RevenueCat** — technical subscription management (via the stores);
- **Apple** — sign-in and App Store distribution;
- **Sentry** — error and crash monitoring.

## 6. Transfers outside the European Union

**[TO BE COMPLETED: data-hosting location (Supabase region).]** Some providers (Google, Sentry…) may process data outside the EU; such transfers are framed by appropriate safeguards (Standard Contractual Clauses or an equivalent mechanism) under Articles 44 et seq. of the GDPR.

## 7. Retention periods

- **Account, profile, rides, sessions**: kept while your account is active; deleted upon account deletion;
- **Ride addresses**: automatically erased after **12 months** (the ride and its metrics are kept for your history, but the pickup and drop-off addresses are removed);
- **Diagnostic captures (beta)**: 30 days maximum;
- **Non-identifying telemetry**: kept in aggregated form;
- **Error reports (Sentry)**: per the service's retention (typically 90 days).

## 8. Your rights

Under the GDPR, you have the rights of access (Art. 15), rectification (Art. 16), erasure (Art. 17), data portability (Art. 20), objection and restriction (Arts. 18 and 21), and the right to withdraw consent at any time. You can:

- view and edit your data from the application;
- **delete your account and all your data in a single action** from Profile → Account (rides, sessions, vehicles, preferences, profile, photo and account);
- contact us at supportstriveapp@gmail.com.

You may also lodge a complaint with the French data-protection authority (CNIL — <https://www.cnil.fr>) or your local supervisory authority.

## 9. Security

Data in transit is encrypted (HTTPS); data access is partitioned per user (each driver accesses only their own data); authentication tokens are stored in the operating system's secure vault (Keychain / Keystore); sensitive operations are enforced server-side.

## 10. Cookies (website)

The marketing website uses no advertising cookies or profiling trackers. **[TO BE COMPLETED if an analytics tool is added.]**

## 11. Minors

The Service is intended for professional VTC drivers and is not directed at persons under 18.

## 12. Changes

We may update this Policy. In the event of a material change, you will be informed in the application or by email.

## 13. Contact

For any question regarding your data: **supportstriveapp@gmail.com**.
