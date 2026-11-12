// jsdom has no page to scroll: the router's scroll to the top on a new page is a no-op here,
// not a "Not implemented" warning on every test. Tests that care spy on it.
window.scrollTo = () => {};
