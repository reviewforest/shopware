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

    function showResult(container, consent) {
        var text = consent === 'yes' ? container.getAttribute('data-thanks-yes') : container.getAttribute('data-thanks-no');
        var body = container.querySelector('.card-body') || container;
        var result = document.createElement('p');
        result.className = 'reviewforest-consent-result mb-0';
        result.textContent = text;
        while (body.firstChild) {
            body.removeChild(body.firstChild);
        }
        body.appendChild(result);
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
                source: 'finish_dialog',
                consent: consent,
            })
                .then(function (result) {
                    showResult(container, result.consent || consent);
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
                })
            );
        });
    }

    /* Finish page, mode "checkbox": store the remembered answer on the new order. */
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
        store.removeItem(STORAGE_KEY);
        if (!saved || (saved.consent !== 'yes' && saved.consent !== 'no') || Date.now() - saved.at > MAX_AGE_MS) {
            return;
        }
        var container = form.closest('[data-reviewforest-consent]');
        postConsent(form.getAttribute('action'), {
            orderId: form.elements.orderId.value,
            source: 'checkout_checkbox',
            consent: saved.consent,
        })
            .then(function (result) {
                if ((result.consent || saved.consent) === 'yes' && container) {
                    container.hidden = false;
                    showResult(container, 'yes');
                }
            })
            .catch(function () {
                /* no answer stored means no invitation */
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
