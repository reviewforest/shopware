/*
 * ReviewForest app for Shopware: consent handling in the storefront.
 *
 * Plain JavaScript without build step or dependencies. Everything works without it too:
 * - Finish page question: the form posts normally and the script endpoint redirects back.
 * - Checkout checkbox: without JavaScript no answer is stored, so no invitation is sent (fail-safe).
 */
(function () {
    'use strict';

    var STORAGE_KEY = 'reviewforest-checkout-consent';
    var MAX_AGE_MS = 2 * 60 * 60 * 1000; // a checkout answer is only used for an order placed within 2 hours
    var CLOCK_TOLERANCE_MS = 15 * 60 * 1000;

    function storage() {
        try {
            return window.sessionStorage;
        } catch {
            return null;
        }
    }

    function postConsent(action, payload) {
        return window.fetch(action, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload),
        }).then(function (response) {
            if (!response.ok) {
                throw new Error('ReviewForest consent request failed with ' + response.status);
            }
            return response.json();
        });
    }

    function clear(element) {
        while (element.firstChild) {
            element.removeChild(element.firstChild);
        }
    }

    function hiddenInput(name, value) {
        var input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        return input;
    }

    /**
     * Replaces the question with the answer. After a yes the buyer gets the withdraw button right away
     * (orderId and deepLinkCode come from the form that was just answered).
     */
    function showResult(container, consent, answeredForm, withdrawn) {
        var body = container.querySelector('.card-body') || container;
        var text = withdrawn
            ? container.getAttribute('data-withdrawn')
            : consent === 'yes'
              ? container.getAttribute('data-thanks-yes')
              : container.getAttribute('data-thanks-no');
        var result = document.createElement('p');
        result.className = 'reviewforest-consent-result mb-0';
        result.textContent = text;
        clear(body);

        if (consent !== 'yes' || !answeredForm || !answeredForm.elements.deepLinkCode) {
            body.appendChild(result);
            return;
        }
        var form = document.createElement('form');
        form.method = 'post';
        form.action = answeredForm.getAttribute('action');
        form.className = 'd-flex flex-wrap align-items-center gap-2';
        form.setAttribute('data-reviewforest-consent-form', '');
        form.appendChild(hiddenInput('orderId', answeredForm.elements.orderId.value));
        form.appendChild(hiddenInput('deepLinkCode', answeredForm.elements.deepLinkCode.value));
        form.appendChild(hiddenInput('source', 'withdrawal'));
        form.appendChild(hiddenInput('redirect', '1'));
        form.appendChild(result);
        var button = document.createElement('button');
        button.type = 'submit';
        button.name = 'consent';
        button.value = 'no';
        button.className = 'btn btn-link p-0';
        button.textContent = container.getAttribute('data-withdraw-label');
        form.appendChild(button);
        body.appendChild(form);
        initFinishDialog(form);
    }

    /* Finish page, mode "question": send the answer in the background, fall back to a normal post. */
    function initFinishDialog(form) {
        var container = form.closest('[data-reviewforest-consent]');
        form.addEventListener('submit', function (event) {
            var submitter = event.submitter;
            var consent = submitter && submitter.value;
            if (!window.fetch || (consent !== 'yes' && consent !== 'no')) {
                return; // normal form post
            }
            event.preventDefault();
            var buttons = form.querySelectorAll('button');
            for (var i = 0; i < buttons.length; i++) {
                buttons[i].disabled = true;
            }
            postConsent(form.getAttribute('action'), {
                orderId: form.elements.orderId.value,
                deepLinkCode: form.elements.deepLinkCode.value,
                source: form.elements.source.value,
                consent: consent,
            })
                .then(function (result) {
                    var answer = result.consent || consent;
                    showResult(container, answer, form, form.elements.source.value === 'withdrawal' && answer === 'no');
                })
                .catch(function () {
                    // Let the server handle it the classic way. form.submit() drops the clicked button,
                    // so its answer is added as a hidden field first.
                    var hidden = document.createElement('input');
                    hidden.type = 'hidden';
                    hidden.name = 'consent';
                    hidden.value = consent;
                    form.appendChild(hidden);
                    form.submit();
                });
        });
    }

    /* Confirm page, mode "checkbox": remember the answer when the order is submitted. */
    function initCheckoutCheckbox(wrapper) {
        var input = wrapper.querySelector('[data-reviewforest-checkbox-input]');
        var orderForm =
            document.getElementById('confirmOrderForm') ||
            wrapper.closest('form') ||
            document.querySelector('form[action*="/checkout/order"]');
        var store = storage();
        if (!input || !orderForm || !store) {
            // Without the order form no answer can be carried over, so no invitation is sent. Make it visible.
            if (window.console) {
                window.console.warn('ReviewForest: order form not found, the consent checkbox cannot be saved.');
            }
            return;
        }
        orderForm.addEventListener('submit', function () {
            store.setItem(
                STORAGE_KEY,
                JSON.stringify({
                    consent: input.checked ? 'yes' : 'no',
                    at: Date.now(),
                    // Binds the answer to this checkout: the finish page only uses it for an order with the same
                    // total that was placed after the answer.
                    total: wrapper.getAttribute('data-cart-total'),
                })
            );
        });
    }

    /* Finish page, mode "checkbox": store the remembered answer on the order it belongs to. */
    function submitCheckboxAnswer(form) {
        var store = storage();
        if (!store || !window.fetch) {
            return;
        }
        var saved = null;
        try {
            saved = JSON.parse(store.getItem(STORAGE_KEY) || 'null');
        } catch {
            saved = null;
        }
        var container = form.closest('[data-reviewforest-consent]');
        var orderCreatedMs = Number(container && container.getAttribute('data-order-created')) * 1000;
        var orderTotal = container && container.getAttribute('data-order-total');
        var valid =
            saved &&
            (saved.consent === 'yes' || saved.consent === 'no') &&
            Number.isFinite(saved.at) &&
            Date.now() - saved.at <= MAX_AGE_MS &&
            Number.isFinite(orderCreatedMs) &&
            // the order was placed after the answer (15 minutes tolerance for clock differences) ...
            orderCreatedMs >= saved.at - CLOCK_TOLERANCE_MS &&
            orderCreatedMs - saved.at <= MAX_AGE_MS &&
            // ... and is the checkout the answer was given in
            saved.total === orderTotal;
        if (!valid) {
            // An answer for another checkout, or an old one, is never used.
            if (saved && Date.now() - saved.at > MAX_AGE_MS) {
                store.removeItem(STORAGE_KEY);
            }
            return;
        }
        postConsent(form.getAttribute('action'), {
            orderId: form.elements.orderId.value,
            deepLinkCode: form.elements.deepLinkCode.value,
            source: 'checkout_checkbox',
            consent: saved.consent,
        })
            .then(function (result) {
                store.removeItem(STORAGE_KEY);
                if ((result.consent || saved.consent) === 'yes' && container) {
                    container.hidden = false;
                    showResult(container, 'yes', form, false);
                }
            })
            .catch(function () {
                // Kept for the next visit of this page (reload); without a stored answer no invitation is sent.
            });
    }

    function init() {
        var forms = document.querySelectorAll('[data-reviewforest-consent-form]');
        for (var i = 0; i < forms.length; i++) {
            initFinishDialog(forms[i]);
        }
        var checkboxes = document.querySelectorAll('[data-reviewforest-checkbox]');
        for (var j = 0; j < checkboxes.length; j++) {
            initCheckoutCheckbox(checkboxes[j]);
        }
        var checkboxSubmits = document.querySelectorAll('[data-reviewforest-checkbox-submit]');
        for (var k = 0; k < checkboxSubmits.length; k++) {
            submitCheckboxAnswer(checkboxSubmits[k]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
