// www.tizcat.com's only script: the menu button on small screens. Without
// it the menu simply shows in full, so the site works with scripts off.
document.documentElement.classList.add("js");
document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.querySelector(".menu-toggle");
  const header = document.querySelector(".site-header");
  if (!toggle || !header) {
    return;
  }
  toggle.addEventListener("click", () => {
    const open = header.classList.toggle("menu-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
});
