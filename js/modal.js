/* =========================================================
   FENÊTRES MODALES RÉUTILISABLES (animation ouverture/fermeture)
   Utilisé par la fenêtre d'identité et le classement.
   ========================================================= */
const DURATION = 240; // doit correspondre à l'animation CSS .modal.closing

export function isModalOpen(el) {
  return !!el && el.classList.contains("open");
}

export function openModal(el) {
  if (!el || isModalOpen(el)) return;
  el.classList.remove("hidden", "closing");
  void el.offsetWidth; // relance l'animation
  el.classList.add("open");
  document.body.classList.add("modal-open");
}

export function closeModal(el) {
  return new Promise((resolve) => {
    if (!el || !isModalOpen(el)) return resolve();
    el.classList.remove("open");
    el.classList.add("closing");
    setTimeout(() => {
      el.classList.add("hidden");
      el.classList.remove("closing");
      if (!document.querySelector(".modal.open")) document.body.classList.remove("modal-open");
      resolve();
    }, DURATION);
  });
}
