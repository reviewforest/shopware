# Changelog

## 1.0.0 (unreleased)

- **Admin overview page (Extensions > ReviewForest, also via "Open" in My extensions):** shows per sales channel whether the API key and forest ID work (with a link to the connected Bewertungswald), checks configured widget IDs and warns when a map widget is set to load without cookie consent, shows what is enabled, the additional-tree price with monthly estimate, review invitations of the last 30 days, trees of this month and the latest orders with a problem. The app now also reads sales channels (new permission) to show their settings and names.
- **Tree per order:** every order that reaches the chosen state (shipped, paid or completed) plants an additional tree in your Bewertungswald on the following day, billed together on your regular ReviewForest subscription invoice (monthly or annual). Cancelled, returned or refunded orders get no tree.
- **Optional monthly limit for tree per order** ("At most this many trees per month"), per sales channel. Orders beyond the limit get no tree and show the reason "Monthly limit reached".
- **Order confirmation tree card:** shows buyers that a tree is planted for their order with a link to your Bewertungswald (and to the planted tree once planted), even when naming is switched off. When naming is enabled, buyers choose their name, initials, a dedication (up to 40 characters with live counter) or no name. A planted order also receives "Link zum Baum" in the admin.
- **Checkout checkbox with Express Checkout fallback:** checkbox answers are captured immediately on change as well as on submit (so JS payment buttons on the confirm page keep the buyer's choice), and totals are matched with 1-cent rounding tolerance. If an express checkout (such as PayPal Express or Apple Pay) skips the confirm page or a payment redirect clears browser storage, the order confirmation page automatically falls back to the consent question.
- **Translated order custom fields:** status, reason and date of the invitation and the tree, plus the buyer's consent record, show translated labels in the merchant's admin language and time zone.
- **Sender, subject and reply-to:** invitation emails carry "<Shop> über ReviewForest" ("<Shop> via ReviewForest" in English) as sender and "<Shop>" in the subject, sent from noreply-invite@reviewforest.org with replies going to the shop owner's email address from Settings > Basic information.
- **Consent record integrity:** ReviewForest keeps its own copy of the consent record when scheduling an invitation. If the time, source or text version is changed on the order before sending, the invitation is skipped ("Consent record on the order was changed"). A withdrawal always stops the invitation.
- **Flow Builder mode:** new setting "one of my flows schedules it" disables automatic invitations so only Flow Builder flows invite. Fixed Flow Builder action settings dialog.
- **Test mode for test and staging shops** ("Test mode: no invitations, no trees", per sales channel): buyers see the storefront cards as usual, but ReviewForest sends no invitations and plants no trees (and never catches them up later). Orders show "Test mode: nothing sent" / "Test mode: no tree".
- **Excluded customer groups:** buyers in excluded groups are no longer asked for consent; their orders show why they are not invited.
- **Widgets & optional cookie consent:** widget fields accept the full embed code. By default ("Always") V2 widgets load directly on every page without setting cookies and the unused cookie entry is hidden/omitted. With "Only after consent" the loader waits for "ReviewForest" under comfort features in Shopware's cookie settings without a reload, and withdrawing consent hides the widgets.
- **Merchant language:** German settings texts consistently address the merchant with "du", and default consent texts are shown as placeholders in the empty fields.

## 0.1.0 (unreleased)

- Widgets on every storefront page without template changes: floating badge, footer widget and further widget IDs, configurable per sales channel.
- Review invitations a set number of days after shipping, payment or completion, only for buyers who agreed.
- Consent either as a question with Yes and No on the order confirmation page or as an unchecked checkbox in the checkout; the answer, its time, source and text version are stored on the order.
- Cancelled, returned or refunded orders cancel the waiting invitation; the invitation status is shown on the order.
- Excluded customer groups.
