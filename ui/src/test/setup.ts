import "@testing-library/jest-dom/vitest";

// jsdom lacks these browser APIs; components only need them to exist.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

// Browsers focus a modal dialog's first focusable element as it opens, or the
// dialog itself when it has none, which then keeps Svelte's autofocus away.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
  const first = this.querySelector<HTMLElement>("[autofocus], button, input, select, textarea");
  if (first) first.focus();
  else {
    this.tabIndex = -1;
    this.focus();
    this.removeAttribute("tabindex");
  }
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event("close"));
};

// jsdom hides popovers and can't show them; showing one only has to make it
// visible.
HTMLElement.prototype.showPopover = function (this: HTMLElement) {
  this.style.display = "block";
};
HTMLElement.prototype.hidePopover = function (this: HTMLElement) {
  this.style.display = "";
};

// Svelte transitions run through the Web Animations API, which jsdom lacks.
Element.prototype.animate ??= function () {
  const animation = {
    finished: Promise.resolve(),
    cancel() {},
    finish() {},
    play() {},
    pause() {},
    reverse() {},
    currentTime: 0,
    onfinish: null as null | (() => void),
  };
  queueMicrotask(() => animation.onfinish?.());
  return animation as unknown as Animation;
};

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
