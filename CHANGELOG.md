# Changelog

## 0.2.0 (unreleased)

- New page under Extensions > ReviewForest, also opened with "Open" in My extensions: whether the API key and forest ID work, with the connected Bewertungswald and a link to it, what is switched on per sales channel, the price per additional tree with an estimate for the month, the invitations of the last 30 days, the trees of this month and the latest orders with a problem. The app now also reads the sales channels (new permission), to show their settings and names.
- Tree per order: every order that reaches the chosen state (shipped, paid or completed) gets a tree in your Bewertungswald. The trees of a day are ordered together once a day as additional trees, usually one invoice a day. Cancelled, returned or refunded orders get no tree.
- On the order confirmation page buyers choose how their tree appears: with their name, initials only, a dedication or without a name. The choice and the tree status are stored on the order.
- The ReviewForest fields on the order show translated labels: status, reason and date of the invitation and of the tree, the buyer's answer and where it was given. Dates are shown in the merchant's time zone.
- Invitation emails carry a subject with the shop name ("Ihre Bewertung für <Shop> pflanzt einen Baum").
- New setting "one of my flows schedules it": no automatic invitations, only Flow Builder flows invite. The Flow Builder action can be added to flows again (its settings did not open).
- Buyers in excluded customer groups are no longer asked for consent; their orders show why they are not invited.
- The widget fields accept the whole embed code.
- Settings texts address the merchant with "du", like the Shopware admin; the default consent texts are shown in the empty fields.

## 0.1.0 (unreleased)

- Widgets on every storefront page without template changes: floating badge, footer widget and further widget IDs, configurable per sales channel.
- Review invitations a set number of days after shipping, payment or completion, only for buyers who agreed.
- Consent either as a question with Yes and No on the order confirmation page or as an unchecked checkbox in the checkout; the answer, its time, source and text version are stored on the order.
- Cancelled, returned or refunded orders cancel the waiting invitation; the invitation status is shown on the order.
- Excluded customer groups.
