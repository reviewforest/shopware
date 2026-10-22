/*
 * ReviewForest app for Shopware: consent and tree name handling in the storefront, and the widget loader after
 * cookie consent.
 *
 * Plain JavaScript without build step or dependencies. Everything works without it too:
 * - Finish page question: the form posts normally and the script endpoint redirects back.
 * - Checkout checkbox: without JavaScript no answer is stored, so no invitation is sent (fail-safe).
 * - Tree name (tree per order): the form posts normally and the script endpoint redirects back.
 * - Widgets that wait for cookie consent: without JavaScript they do not load at all (fail-safe).
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

    function postJson(action, payload) {
        return window.fetch(action, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload),
        }).then(function (response) {
            if (!response.ok) {
                throw new Error('ReviewForest request failed with ' + response.status);
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
            postJson(form.getAttribute('action'), {
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
        postJson(form.getAttribute('action'), {
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

    /** Tree per order: sends the name choice in the background and shows what was saved. */
    function initTreeForm(form) {
        var container = form.closest('[data-reviewforest-tree]');
        var result = form.querySelector('.reviewforest-tree-result');
        var button = form.querySelector('button[type="submit"]');
        var dedication = form.elements.dedication;
        var dedicationChoice = form.querySelector('input[name="treeChoice"][value="dedication"]');
        if (dedication && dedicationChoice) {
            // Typing a dedication selects that option.
            dedication.addEventListener('input', function () {
                dedicationChoice.checked = true;
            });
        }
        form.addEventListener('submit', function (event) {
            if (!window.fetch || !container || !result) {
                return;
            }
            event.preventDefault();
            var checked = form.querySelector('input[name="treeChoice"]:checked');
            if (button) {
                button.disabled = true;
            }
            postJson(form.getAttribute('action'), {
                orderId: form.elements.orderId.value,
                deepLinkCode: form.elements.deepLinkCode.value,
                treeChoice: checked ? checked.value : 'none',
                dedication: dedication ? dedication.value : '',
            })
                .then(function (answer) {
                    result.textContent = answer.name
                        ? container.getAttribute('data-saved-named') + ' ' + answer.name
                        : container.getAttribute('data-saved-anonymous');
                })
                .catch(function () {
                    result.textContent = container.getAttribute('data-error');
                })
                .then(function () {
                    if (button) {
                        button.disabled = false;
                    }
                });
        });
    }

    /*
     * Widgets and cookie consent (setting "When the widgets load", RF-12254).
     * By default the page only carries the widget placeholders and a hidden marker. The ReviewForest loader is added
     * once the visitor allowed "ReviewForest" in Shopware's cookie settings (comfort features): on page load when
     * the consent cookie is set, and right after the visitor saves the cookie settings, without a reload. Shopware
     * dispatches "CookieConfiguration_Update" on the document with the changed cookies ({ name: true|false }).
     */
    var WIDGET_LOADER_URL = 'https://widgets.reviewforest.org/main.js';
    var WIDGET_CONSENT_COOKIE = 'reviewforest-widgets'; // the cookie entry in manifest.xml, set by Shopware on consent
    var COOKIE_CONFIGURATION_UPDATE = 'CookieConfiguration_Update';
    var WIDGET_PLACEHOLDER_SELECTOR = '[class*="reviewforest-app-"]'; // the same selector the loader uses
    var widgetLoaderAdded = false;

    function hasCookie(name) {
        var cookies = document.cookie ? document.cookie.split(';') : [];
        for (var i = 0; i < cookies.length; i++) {
            var cookie = cookies[i].trim();
            if (cookie.indexOf(name + '=') === 0 && cookie.length > name.length + 1) {
                return true;
            }
        }
        return false;
    }

    function loaderPresent() {
        if (widgetLoaderAdded || window.rfapps) {
            return true;
        }
        // An embed code of the merchant (for example in a Shopping Experience) may bring its own loader.
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
            if (scripts[i].src && scripts[i].src.indexOf(WIDGET_LOADER_URL) === 0) {
                return true;
            }
        }
        return false;
    }

    function loadWidgets() {
        if (loaderPresent() || !document.querySelector(WIDGET_PLACEHOLDER_SELECTOR)) {
            return; // already loaded, or no widget on this page
        }
        widgetLoaderAdded = true;
        // The loader reads the placeholders when it runs, so it also works after the page has loaded.
        var script = document.createElement('script');
        script.src = WIDGET_LOADER_URL;
        script.async = true;
        document.head.appendChild(script);
    }

    /*
     * Consent withdrawn after the widgets were loaded: they disappear from this page, and the next page does not load
     * the loader. They are hidden rather than deleted, because the loader reads the placeholders only once: if the
     * visitor agrees again on the same page, for example after Shopware asked again because the cookie configuration
     * changed, the same widgets come back.
     */
    var hiddenWidgets = null;

    function hideWidgets() {
        if (hiddenWidgets) {
            return;
        }
        hiddenWidgets = [];
        var placeholders = document.querySelectorAll(WIDGET_PLACEHOLDER_SELECTOR);
        for (var i = 0; i < placeholders.length; i++) {
            var style = placeholders[i].style;
            hiddenWidgets.push({
                element: placeholders[i],
                display: style.getPropertyValue('display'),
                priority: style.getPropertyPriority('display'),
            });
            style.setProperty('display', 'none', 'important');
        }
    }

    function showWidgets() {
        if (!hiddenWidgets) {
            return;
        }
        for (var i = 0; i < hiddenWidgets.length; i++) {
            var entry = hiddenWidgets[i];
            if (entry.display) {
                entry.element.style.setProperty('display', entry.display, entry.priority);
            } else {
                entry.element.style.removeProperty('display');
            }
        }
        hiddenWidgets = null;
    }

    function initWidgetConsent() {
        document.addEventListener(COOKIE_CONFIGURATION_UPDATE, function (event) {
            var updated = event && event.detail;
            if (!updated || typeof updated[WIDGET_CONSENT_COOKIE] !== 'boolean') {
                return; // other cookies changed
            }
            if (updated[WIDGET_CONSENT_COOKIE]) {
                showWidgets();
                loadWidgets();
            } else if (loaderPresent()) {
                // Only after the widgets were loaded. Shopware also reports "false" for entries that were never
                // allowed (button "Only technically required", or a new consent round after a change of the cookie
                // configuration); then nothing changes, so consent given later on the same page still loads them.
                hideWidgets();
            }
        });
        // For consent tools that replace Shopware's cookie banner: call ReviewForestWidgets.load() after consent.
        window.ReviewForestWidgets = { load: loadWidgets };
        if (hasCookie(WIDGET_CONSENT_COOKIE)) {
            loadWidgets();
        } else if (window.useDefaultCookieConsent !== true && window.console) {
            window.console.warn(
                'ReviewForest: the widgets wait for cookie consent, but the Shopware cookie banner is switched off. ' +
                    'Let your consent tool call ReviewForestWidgets.load(), or set the widgets to load always.'
            );
        }
    }

    /*
     * The cookie entry comes from manifest.xml and is listed in every shop. Shopware 6.7.14 and later drop it when it
     * has no effect (Resources/scripts/cookie-group-collect); on older versions it is hidden here, so visitors are
     * never offered a choice that changes nothing.
     */
    function hideUnusedCookieEntry() {
        var selector = 'input[data-cookie="' + WIDGET_CONSENT_COOKIE + '"]';
        function hideIn(root) {
            var inputs = Array.prototype.slice.call(root.querySelectorAll(selector));
            if (root.matches && root.matches(selector)) {
                inputs.push(root);
            }
            for (var i = 0; i < inputs.length; i++) {
                var entry = inputs[i].closest('.offcanvas-cookie-entry') || inputs[i].parentElement;
                if (entry) {
                    entry.style.display = 'none';
                }
            }
        }
        hideIn(document);
        if (!window.MutationObserver || !document.body) {
            return;
        }
        // The cookie settings are loaded into an off-canvas panel when the visitor opens them.
        new window.MutationObserver(function (mutations) {
            for (var i = 0; i < mutations.length; i++) {
                var added = mutations[i].addedNodes;
                for (var j = 0; j < added.length; j++) {
                    if (added[j].nodeType === 1) {
                        hideIn(added[j]);
                    }
                }
            }
        }).observe(document.body, { childList: true, subtree: true });
    }

    function init() {
        if (document.querySelector('[data-reviewforest-widgets-consent]')) {
            initWidgetConsent();
        }
        if (document.querySelector('[data-reviewforest-cookie-entry-unused]')) {
            hideUnusedCookieEntry();
        }
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
        var treeForms = document.querySelectorAll('[data-reviewforest-tree-form]');
        for (var m = 0; m < treeForms.length; m++) {
            initTreeForm(treeForms[m]);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
