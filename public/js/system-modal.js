/** 绑定全局页脚与注册框中的免责声明弹窗交互 */
export const initSystemAndDisclaimerModals = () => {
  const disclaimerModal = document.getElementById("disclaimer-modal");
  if (!disclaimerModal) return;
  document.addEventListener("click", (e) => {
    if (e.target.closest(".js-open-disclaimer")) {
      e.preventDefault();
      disclaimerModal.hidden = false;
    }
  });
  document.getElementById("disclaimer-close")?.addEventListener("click", () => { disclaimerModal.hidden = true; });
  document.getElementById("disclaimer-ok")?.addEventListener("click", () => { disclaimerModal.hidden = true; });
};
