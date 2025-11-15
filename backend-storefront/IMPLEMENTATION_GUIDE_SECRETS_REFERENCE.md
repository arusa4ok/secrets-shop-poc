# Secrets Shop Reference Integration Guide

Comprehensive instructions for reproducing key UX/UI patterns from the legacy Secrets Shop storefront (HTML snapshots located in `backend-storefront/ss_reference/`). Use this guide together with `FRONTEND_DEVELOPMENT_GUIDE.md` when planning and executing the rebuild inside the Next.js storefront.

---

## 1. Global Design & Infrastructure

### 1.1 Design Tokens
- Primary palette: `#ff1872` (magenta) + shades/tints (`--bs-theme-shade-20`, `--bs-theme-tint-90` etc. extracted from `<style>` variables).
- Accent: `#43525a`, success badge color `#7FD856`, warning badge `#FFC107` (approx. from warning badge class `text-bg-warning`).
- Rounded corners: 8px (see `--bs-border-radius`).
- Typography: Montserrat (weights 300–700). Preload fonts or use Google Fonts with matching weights.

**Action:** ensure Tailwind config includes these colors, font family, and radius utilities. Override Medusa UI defaults where required.

### 1.2 Layout System
- Full-width containers (`container-fluid container-xxl`) with responsive paddings.
- Frequent usage of cards with subtle shadows (`shadow`, `shadow-lg`).
- Section wrappers follow pattern `pt-* pb-*` combined with `border-bottom` dividers.

**Action:** create utility components (e.g., `Section`, `Card`, `Badge`) reusing Tailwind classes.

### 1.3 JavaScript Enhancements Identified
- Diginetica search script (autocomplete/recommendations).
- Trustpilot widgets, Klarna placements, PayPal messages, countdown timers.
- Lazy loading via custom `data-src`, `b-lazyload` (we will replicate using Next/Image + IntersectionObserver if needed).

**Action:** document integration points but defer heavy third-party scripts until core UI is complete. Stub with placeholders.

---

## 2. Navigation & Header

### 2.1 Desktop Header Structure
1. Top utility bar (`b-nav-pages`) with informational links.
2. Middle zone with logo, mega-menu trigger (`Shop All`), search, phone/chat CTA, wishlist/cart buttons.
3. Announcement/promotional banner sections above/below header (empty placeholders in snapshot but reserved).
4. Sticky behavior (`l-desktop-header--fixed` with `fixed-top shadow border-bottom`).

### 2.2 Mega Menu Pattern
- Trigger button (Shop All) toggles full-width dropdown.
- Content arranged in columns with category image thumbnail + nested links.
- `More` overflow button reveals additional categories.

**Implementation Steps**
- Extend existing `nav` component: replicate multi-level data schema (can reuse categories from Medusa). Build `MegaMenu` client component with portal & focus trapping.
- Introduce `NavUtilityBar` for top links and `CustomerCare` block (phone, live chat, Q&A, shipping icons).
- Use `cmd/ctrl + k` friendly search overlay later (phase 2).

### 2.3 Mobile Navigation
- Mobile menu is off-canvas sliding from left with categories & utility links.
- Provide search input just below nav for mobile (already in current nav but style to match reference).

### 2.4 Persistent Header Product Bar
- Product page adds sticky mini-header (image, title, price, CTA). Plan to implement using our product template.

---

## 3. Homepage Modules (ordering from top to bottom)

1. **Hero Slider (`home__slider`)**
   - Full-width slides with background images, gradient overlay, CTA button.
   - Swiper configs: no pagination nav by default, manual navigation optional. Autoplay disabled in snapshot but implement toggled autoplay 5s as per `WINDSURF_BEST_TECHNIQUES`.

2. **Category Promo Badges (`home__banner`)**
   - Row of icon cards with gradient backgrounds and CTA text.

3. **Featured Product Carousels**
   - Multiple sections using Swiper (SW 8) with `spaceBetween` 12–24, 4 cards per row desktop, 2 mobile.
   - Each block includes header with CTA link (`View All`).

4. **USP Strip**
   - 3–4 columns with icons (discreet packaging, free delivery, secure payments). Use `bg-white-dark` card style.

5. **Video/Editorial Blocks**
   - Possibly in other snapshots. Provide placeholders for CMS-driven content (YouTube embed, blog).

6. **Hot Deals with Countdown**
   - Product cards featuring discount badge and countdown timer (autobadge plugin). Provide design for limited-time deals using our context.

7. **Testimonials / Trustpilot**
   - Embed Trustpilot carousels (iframe). Provide placeholder component until integration.

8. **Viewed Products & Recently Added**
   - Carousels at end of page; replicate using reviews context or Medusa endpoints.

**Action:** Build reusable `SectionHeader` and `ProductCarousel` components to mirror structure. Configure them to accept data from CMS/Medusa.

---

## 4. Product Card & Carousel Details
- Card layout: image ratio square, hover swap image, badges (discount %, `bonuses`, etc.), rating stars, price w/ strike, `Add to Basket` + `Free Delivery` sublabel.
- Badges include: `-14%` (warning), loyalty/bonus badge (rounded pill with icon), `Free Delivery` text overlay on CTA.
- Countdown badge (if available) may display `Ends In: 01h 37m`.

**Action:** Extend `ProductPreview` component:
1. Support multiple badge types (discount, loyalty, new). Provide props for text + icon.
2. Append `Free Delivery` message under button when qualifies (order-level logic).
3. If product participates in loyalty program, show pill with icon (use placeholder until backend ready).

---

## 5. Product Detail Page (PDP)
- Sticky product header appears after scroll with image, title, price, add-to-cart.
- Gallery uses vertical thumbnail list + main image slider.
- Info panel structure:
  1. Price block w/ discount badge & loyalty badge.
  2. Stock indicator per SKU (with color-coded bullet).
  3. Klarna & PayPal message widgets.
  4. Delivery info card with ETA, countdown timer (order cut-off), modal for details.
  5. Trust pilot rating widget.
  6. Key features bullet list.
  7. Accordions for description/specs (likely below).
  8. Tabbed reviews, Q&A etc.

**Action:** For Next.js version:
- Introduce `ProductStickyBar` client component triggered on scroll.
- Expand `ProductActions` to display shipping estimator & third-party banners.
- Add `DeliveryCountdown` component (inputs: timezone, shipping schedule).
- Build `LoyaltyBadge`, `PaymentMessaging` components with provider toggles.

---

## 6. Reviews & UGC
- Legacy site uses `reviewsplus`. UI includes rating summary, review cards with verified badges, helpful buttons.
- Already implemented new reviews system; align visuals to reference: verify star colors (#ffbd2d), card backgrounds (white with subtle shadow), `Helpful (0)` button style.

**Action:** adjust Tailwind classes to match (some already done in compact variant). Add `Verified Purchase` pill and date format `3 November 2025` (already matches).

---

## 7. Footer & Trust Blocks
- Footer includes newsletter, help center, store info, payment icons, social icons, trust badges.
- Contains collapsible sections for mobile.

**Action:** Plan a new `Footer` template replicating layout: multi-column w/ CTAs, and global `TrustBanner` prior to footer.

---

## 8. Third-Party/Marketing Integrations Checklist
| Feature | Source | Notes |
| --- | --- | --- |
| Trustpilot widgets | `<div class="trustpilot-widget" ...>` | Provide integration stub; ensure script loaded once. |
| Klarna badge | `<klarna-placement data-key="credit-promotion-badge">` | Use Klarna SDK for placements on PDP and cart. |
| PayPal credit messaging | `<script src="https://www.paypal.com/sdk/js?...&components=messages">` | Render via `<div data-pp-message>`. |
| Diginetica search | `cdn.diginetica.net/2537/client.js` | Evaluate replacement with Algolia? Document for future decision. |
| Autobadge countdown | `jquerycountdowntimer.min.js` | Replace with React countdown component hooking into promo metadata. |
| Loyalty bonuses | Data attributes `data-rate="10"` | Determine backend support; placeholder UI until loyalty program defined. |

---

## 9. Implementation Roadmap (Aligned with Next.js Modules)

### Phase A – Global Foundation
1. Update Tailwind tokens (`#ff1872`, fonts). Ensure Montserrat loaded.
2. Create shared UI primitives: `Button`, `Badge`, `Card`, `SectionHeader`, `IconList`, `TrustBadge`.
3. Build layout wrappers for `container-xxl` spacing.

### Phase B – Navigation & Header
1. Rebuild header with utility bar, sticky main nav, mega menu.
2. Implement `MegaMenu` data model pulling categories from Medusa.
3. Add `SupportBar` (phone, live chat, store info). Add `StickyProductHeader` logic.

### Phase C – Homepage Modules
1. Hero slider (Swiper) with gradient overlay.
2. Category promo cards + USP strip.
3. Reusable product carousels (New Arrivals, Best Sellers, Staff Picks, etc.).
4. Testimonials + Blog preview + Featured video sections.
5. Recently viewed / loyalty highlight.

### Phase D – Product Detail Enhancements
1. Gallery improvements (vertical thumbs, hero image). Consider `keen-slider` or Swiper.
2. Expand product info cards: price, loyalty, stock, shipping, payment messages.
3. Delivery countdown & modal.
4. Key features bullet list + icons.
5. Reviews UI alignment (already partial).

### Phase E – Footer & Global Banners
1. Top trust banner (free delivery, discreet packaging, secure checkout).
2. Newsletter CTA bar.
3. Footer restructure with collapsible sections on mobile.

### Phase F – Advanced Integrations
1. Loyalty program UI (bonus points) – depends on backend.
2. Trustpilot, Klarna, PayPal scripts integrated via Next.js dynamic import.
3. Autocomplete search (Diginetica or alternative service).
4. Autobadge countdown for promos.

---

## 10. Documentation & Tracking
- Maintain tasks in TODO list using `todo_list` tool (per CASCADE instructions).
- For each major module, create design notes referencing relevant CSS classes from reference HTML (e.g., `b-product-price`, `b-mega-menu`).
- When implementing, cross-link PR descriptions to sections in this guide for traceability.

---

## 11. Appendix: Component-to-Module Mapping
| Reference Block | Target Module/File | Notes |
| --- | --- | --- |
| Header (mega menu) | `src/modules/layout/templates/nav/` | Replace current nav; separate into `NavTopBar`, `MegaMenu`, `ActionButtons`. |
| Hero slider | `src/modules/home/components/hero/` | Use Swiper, gradient overlays from HTML example. |
| Product carousels | `src/modules/products/components/carousels/` | Build generic `ProductCarousel` hooking into data fetchers. |
| USP strip / Trust badges | `src/modules/common/components/trust-strip/` | Card grid with icons. |
| PDP sticky header & cards | `src/modules/products/templates/product-info` & `product-actions` | Extend existing structures. |
| Delivery countdown | New component under `src/modules/shipping/components/`. |
| Footer | `src/modules/layout/templates/footer/` | Rebuild multi-column layout. |

---

### Usage Notes
- Treat this document as the living blueprint for aligning the Next.js storefront with the legacy Secrets Shop experience.
- Update the guide as new insights appear or when designs differ from the reference (e.g., due to backend constraints or performance considerations).
- Use `FRONTEND_DEVELOPMENT_GUIDE.md` for Windsurf prompts and general workflow; use this guide specifically when replicating Secrets Shop look & feel.
