# Changelog

## 0.2.0 (unreleased)

- Tree per order: every order that reaches the chosen state (shipped, paid or completed) gets a tree in your Bewertungswald. The trees of a day are ordered together once a day as additional trees, usually one invoice a day. Cancelled, returned or refunded orders get no tree.
- On the order confirmation page buyers choose how their tree appears: with their name, initials only, a dedication or without a name. The choice and the tree status are stored on the order.
- The ReviewForest fields on the order show translated labels: status, reason and date of the invitation and of the tree, the buyer's answer and where it was given. Dates are shown in the merchant's time zone.
- Invitation emails carry a subject with the shop name ("Ihre Bewertung für <Shop> pflanzt einen Baum").
- New setting "one of my flows schedules it": no automatic invitations, only Flow Builder flows invite. The Flow Builder action can be added to flows again (its settings did not open).
- Buyers in excluded customer groups are no longer asked for consent; their orders show why they are not invited.
- The widget fields accept the whole embed code.
- Cookie consent for the widgets (new setting "When the widgets load"): by default the widget script loads only after the visitor allowed "ReviewForest" under comfort features in the cookie settings, right after saving and without a reload; withdrawing consent hides the widgets on the page. With "Always" the widgets load as before and the entry is not offered. Adding the entry changes Shopware's cookie configuration, so Shopware 6.7.3 and later ask visitors for consent once more after the update (from 6.7.14 not in shops that load the widgets always).
- Settings texts address the merchant with "du", like the Shopware admin; the default consent texts are shown in the empty fields.

## 0.1.0 (unreleased)

- Widgets on every storefront page without template changes: floating badge, footer widget and further widget IDs, configurable per sales channel.
- Review invitations a set number of days after shipping, payment or completion, only for buyers who agreed.
- Consent either as a question with Yes and No on the order confirmation page or as an unchecked checkbox in the checkout; the answer, its time, source and text version are stored on the order.
- Cancelled, returned or refunded orders cancel the waiting invitation; the invitation status is shown on the order.
- Excluded customer groups.
