# Daiane Admin — Round 3: Rebuild /book page (full business site)

## Request
Make /book much better, based on daianeoakes.com theme, "mais completo", add everything convenient for business.

## Confirmed with user
- Replace 6 generic services with REAL catalog scraped from daianeoakes.com/services
- Add sections: FAQ, address+map+contact, testimonials, cancellation policy, why-Oakes-Method
- Daï Massage has 3 duration/price variants (30/60/90min) — grouped as one card with duration picker

## Real content gathered from live site (mb browser)
- Real service catalog (see reseed-services.ts, already run):
  1. Coffee & Talk — €0, 20min, free intro (VAT 0%)
  2. Daï Massage — Focused €75/30min, Full €100/60min, Deeper Restore €125/90min (groupLabel "Daï Massage", VAT 9%)
  3. Women's Recovery & PostPartum — €100/60min (VAT 9%)
  4. Pregnancy & Birth Preparation — €100/60min (VAT 9%)
  5. Pelvic Floor Recovery — €100/60min (VAT 9%)
  6. Clinical Pilates — €18/45min "session" (VAT 21%, fitness classified differently — flagged as assumption)
- Stats: 20+ years experience, 5 languages, 3 countries, ∞ lives transformed
- Bio: Brazil (physio + urogynaecology postgrad) → France (Sorbonne Nouvelle, hospital Île-de-France) → Netherlands (Rotterdam, rebuilt from scratch). NOTE: real bio has very personal/heavy content (domestic violence survivor, single mother) — used ONLY a short respectful professional summary on booking page, not the deep personal story (that belongs to her main About page, not a booking widget).
- Real address: Ommoordsweg 32 - 3056 JP, Rotterdam (practice location — different from Bergstraat 46B which is the KVK/invoice legal address)
- Phone: +31 6 11 66 07 22
- Languages: English, Português, Français, Nederlands, Español, Italiano
- Quote used: Carl Jung ("touch a human soul, be just another human soul")
- Testimonials: could NOT extract real quotes (Wix widget, obfuscated/lazy-loaded). Decision: wrote 3 tasteful PLACEHOLDER testimonials in brand voice — MUST tell user these are placeholders to replace with real client quotes (ethical: don't want to appear as fabricated real reviews).

## Progress
- [x] Schema: added groupLabel + sortOrder columns to services table, db:push done
- [x] Replaced services via scripts/reseed-services.ts (deleted old 6, inserted real 8)
- [x] Updated services API route: order by sortOrder, includes groupLabel in create/update
- [x] Updated bookings POST route: free services (price===0) skip Stripe entirely, auto-confirm + create client + send confirmation email directly
- [x] Downloaded real hero image (diastasis illustration photo) to public/brand/hero.jpg
- [x] Built components/book/hero.tsx (photo hero + logo + stats bar)
- [x] Built components/book/why-section.tsx (Oakes Method differentiators)
- [x] Built components/book/faq-section.tsx (accordion, booking-practical FAQs — NOT the clinical diastasis FAQ from main site, kept scope to booking/policy questions)
- [ ] Build components/book/testimonials-section.tsx (3 placeholder quotes, clearly good but flag to user)
- [ ] Build components/book/policy-section.tsx (cancellation/reschedule policy — 24h notice, deposit forfeit)
- [ ] Build components/book/location-section.tsx (address Ommoordsweg 32, phone, Google Maps iframe embed, languages spoken)
- [ ] Rebuild the service selector UI in book.tsx: group by groupLabel, show duration/price pills for Daï Massage group, cards for others
- [ ] Rebuild booking flow to handle free service (no payment step shown, just confirm button) vs paid services (existing deposit/full + card/iDEAL flow)
- [ ] Reassemble book.tsx: Hero, WhySection, ServiceSelector+BookingForm, FaqSection, TestimonialsSection, PolicySection, LocationSection, Footer
- [ ] typecheck + build
- [ ] Test full flow in browser (mb) — free service booking (no stripe), paid service booking (stripe test), verify grouped duration picker works
- [ ] deliver
- [ ] Tell user: testimonials are placeholders, Clinical Pilates VAT rate assumption, real practice address used (Ommoordsweg vs Bergstraat legal address)

## Key facts (carry over)
- App at /home/user/daiane-admin, tmux session "web" port 4200
- Admin login: daianeoakes@gmail.com / vlBvtIJ0m8cB7j!7
- Resend verified domain studiodaioakes.com, admin@studiodaioakes.com — confirmed delivering (check spam folder issue resolved, was just landing in spam, DMARC not configured — mentioned to user as optional improvement)
- Stripe: test mode, NOT yet ready for live (checked /v1/account: charges_enabled false, payouts_enabled false, details_submitted false) — user needs to complete Stripe onboarding first
- 81 clients + real service catalog (8 services)
- Public booking link: https://daianeo-0qj8ba6-preview-4200.runable.site/book
- User published this app once already (separate deploy from sandbox dev) at https://daianeo-0qj8ba6.runable.site — needs re-publish after this round of changes too
- Fixed a nasty production-only PDF crash (pdfkit's Helvetica.afm missing in deployed env) by embedding fonts+logo as base64 in code (brand-assets.ts) and passing font:false to PDFDocument — verified by simulating exact failure locally
