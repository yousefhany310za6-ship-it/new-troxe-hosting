/**
 * Scroll intent carried across a route change.
 *
 * The 404 page has no sections to scroll to, so its navbar links ask for a
 * section first and navigate home; the scroll manager (rendered once, next to
 * the routes) performs the scroll once the landing page is on screen.
 */
let request = { type: 'top' };

export function requestTopScroll() {
    request = { type: 'top' };
}

export function requestSectionScroll(id) {
    request = { type: 'section', id };
}

export function takeScrollRequest() {
    const taken = request;
    request = { type: 'top' };
    return taken;
}
