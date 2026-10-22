# Changelog

## 0.2.0 (unreleased)

- Tree per order: every order that reaches the chosen state (shipped, paid or completed) gets a tree in your Bewertungswald. The trees of a day are ordered together once a day as additional trees, usually one invoice a day. Cancelled, returned or refunded orders get no tree.
- Tree per order can be billed once a month instead of once a day (setting "Order and bill the trees"): the trees of a calendar month (UTC) are ordered together at the start of the next month, usually one invoice a month. The order confirmation page tells buyers when their tree is planted.
- Optional monthly limit for tree per order ("At most this many trees per month"), per sales channel. Orders beyond it get no tree and show the reason "Monthly limit reached".
- On the order confirmation page buyers choose how their tree appears: with their name, initials only, a dedication or without a name. The choice and the tree status are stored on the order.
- The tree card on the order confirmation page links to the shop's Bewertungswald, and once the tree is planted to the tree itself. A planted order shows "Link zum Baum", for the merchant to send to the buyer.
- The ReviewForest fields on the order show translated labels: status, reason and date of the invitation and of the tree, the buyer's answer and where it was given. Dates are shown in the merchant's time zone.
- Invitation emails carry a subject with the shop name ("Ihre Bewertung für <Shop> pflanzt einen Baum").
- Invitation emails come from "<Shop> über ReviewForest" ("<Shop> via ReviewForest" in English), still sent from noreply-invite@reviewforest.org. Replies go to the shop's email address from Settings > Basic information.
- ReviewForest keeps its own copy of the consent record when it schedules an invitation. If the time of the answer, where it was given or the text version is changed on the order before sending, the invitation is not sent (reason "Consent record on the order was changed"). A withdrawal time on the order always stops the invitation.
- New setting "one of my flows schedules it": no automatic invitations, only Flow Builder flows invite. The Flow Builder action can be added to flows again (its settings did not open).
- Test mode for test and staging shops ("Test mode: no invitations, no trees", per sales channel): buyers see the consent question and the tree choice as usual and the orders get their status, but no invitation is sent and no tree is ordered or billed, also none that was already waiting. The orders show "Test mode: nothing sent" and "Test mode: no tree".
- Buyers in excluded customer groups are no longer asked for consent; their orders show why they are not invited.
- The widget fields accept the whole embed code.
- Settings texts address the merchant with "du", like the Shopware admin; the default consent texts are shown in the empty fields.

## 0.1.0 (unreleased)

- Widgets on every storefront page without template changes: floating badge, footer widget and further widget IDs, configurable per sales channel.
- Review invitations a set number of days after shipping, payment or completion, only for buyers who agreed.
- Consent either as a question with Yes and No on the order confirmation page or as an unchecked checkbox in the checkout; the answer, its time, source and text version are stored on the order.
- Cancelled, returned or refunded orders cancel the waiting invitation; the invitation status is shown on the order.
- Excluded customer groups.
