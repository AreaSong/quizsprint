import { getGlobalSettings, saveGlobalSettings, showToast } from "./api.js";

export const THEME_OPTIONS = [
  { id: "light", label: "明亮", swatch: "#f8f9fa", dark: false },
  { id: "mist", label: "雾蓝", swatch: "#eef3f9", dark: false },
  { id: "paper", label: "暖纸", swatch: "#f4f1ea", dark: false },
  { id: "sage", label: "豆沙", swatch: "#eaf1ec", dark: false },
  { id: "midnight", label: "深蓝", swatch: "#0b1220", dark: true },
  { id: "dark", label: "深黑", swatch: "#090a0d", dark: true }
];

export const ACCENT_OPTIONS = [
  { id: "indigo", label: "靛蓝", grad: "linear-gradient(135deg,#2b5ce6,#6366f1)" },
  { id: "cyan", label: "天青", grad: "linear-gradient(135deg,#0284c7,#06b6d4)" },
  { id: "emerald", label: "翠绿", grad: "linear-gradient(135deg,#0f766e,#10b981)" },
  { id: "amber", label: "暖橙", grad: "linear-gradient(135deg,#d97706,#f59e0b)" },
  { id: "rose", label: "樱粉", grad: "linear-gradient(135deg,#e11d48,#f472b6)" },
  { id: "violet", label: "紫罗兰", grad: "linear-gradient(135deg,#6d28d9,#a855f7)" },
  { id: "crimson", label: "赤陶", grad: "linear-gradient(135deg,#c2410c,#ef4444)" },
  { id: "slate", label: "石墨", grad: "linear-gradient(135deg,#1e293b,#475569)" }
];

export const PRESET_BUNDLES = [
  { id: "sky", label: "学院晴空", theme: "mist", accent: "indigo", ambient: "soft", dot: "linear-gradient(135deg,#e6eef7,#2b5ce6)" },
  { id: "study", label: "书房宣纸", theme: "paper", accent: "amber", ambient: "soft", dot: "linear-gradient(135deg,#f4f1ea,#d97706)" },
  { id: "forest", label: "松林护眼", theme: "sage", accent: "emerald", ambient: "soft", dot: "linear-gradient(135deg,#eaf1ec,#0f766e)" },
  { id: "aurora", label: "星夜极光", theme: "midnight", accent: "cyan", ambient: "soft", dot: "linear-gradient(135deg,#0b1220,#06b6d4)" }
];

const THEME_IDS = THEME_OPTIONS.map((t) => t.id);
const ACCENT_IDS = new Set(ACCENT_OPTIONS.map((a) => a.id));
const DARK_THEMES = new Set(THEME_OPTIONS.filter((t) => t.dark).map((t) => t.id));
const FONT_SCALES = [["compact", "紧凑"], ["normal", "标准"], ["large", "大字"]];
const AMBIENTS = [["soft", "柔光渐变"], ["flat", "纯净素面"]];

let themeSwitchTimer = null;

export const resolveEffectiveTheme = (pref) => {
  if (pref === "auto") {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "midnight" : "light";
  }
  return THEME_IDS.includes(pref) ? pref : "light";
};

const syncMenuHighlight = (menuEl, s) => {
  if (!menuEl) return;
  const themePref = s.theme || "light";
  const accent = ACCENT_IDS.has(s.accent) ? s.accent : "indigo";
  const ambient = s.ambient === "flat" ? "flat" : "soft";
  const fontScale = FONT_SCALES.some(([k]) => k === s.fontScale) ? s.fontScale : "normal";
  menuEl.querySelectorAll("[data-set-theme]").forEach((b) => b.classList.toggle("active", b.dataset.setTheme === themePref));
  menuEl.querySelectorAll("[data-set-accent]").forEach((b) => b.classList.toggle("active", b.dataset.setAccent === accent));
  menuEl.querySelectorAll("[data-set-ambient]").forEach((b) => b.classList.toggle("active", b.dataset.setAmbient === ambient));
  menuEl.querySelectorAll("[data-set-scale]").forEach((b) => b.classList.toggle("active", b.dataset.setScale === fontScale));
  menuEl.querySelectorAll("[data-set-preset]").forEach((b) => {
    const p = PRESET_BUNDLES.find((x) => x.id === b.dataset.setPreset);
    b.classList.toggle("active", Boolean(p && p.theme === themePref && p.accent === accent && p.ambient === ambient));
  });
};

export const applyAppearance = (animate = false, menuEl = document.getElementById("appearance-menu")) => {
  const root = document.documentElement;
  if (animate) {
    root.classList.add("theme-switching");
    if (themeSwitchTimer) clearTimeout(themeSwitchTimer);
    themeSwitchTimer = setTimeout(() => root.classList.remove("theme-switching"), 350);
  }
  const s = getGlobalSettings();
  const effTheme = resolveEffectiveTheme(s.theme);
  const accent = ACCENT_IDS.has(s.accent) ? s.accent : "indigo";
  const ambient = s.ambient === "flat" ? "flat" : "soft";
  const fontScale = FONT_SCALES.some(([k]) => k === s.fontScale) ? s.fontScale : "normal";
  const scheme = DARK_THEMES.has(effTheme) ? "dark" : "light";
  root.dataset.theme = effTheme;
  root.dataset.colorScheme = scheme;
  root.dataset.accent = accent;
  root.dataset.ambient = ambient;
  root.dataset.fontScale = fontScale;
  root.style.colorScheme = scheme;
  syncMenuHighlight(menuEl, s);
};

export const cycleTheme = () => {
  const settings = getGlobalSettings();
  const cur = resolveEffectiveTheme(settings.theme);
  const nextId = THEME_IDS[(THEME_IDS.indexOf(cur) + 1) % THEME_IDS.length];
  const meta = THEME_OPTIONS.find((t) => t.id === nextId);
  settings.theme = nextId;
  settings.eyeCare = nextId === "paper" || nextId === "sage";
  saveGlobalSettings(settings);
  applyAppearance(true);
  if (meta) showToast(`已切换至「${meta.label}」底色`);
};

const buildMenuHtml = () => `
  <div>
    <div class="appearance-label">精选皮肤套装</div>
    <div class="preset-grid">
      ${PRESET_BUNDLES.map((p) => `<button type="button" class="preset-chip" data-set-preset="${p.id}"><span class="preset-dot" style="background:${p.dot}"></span><span>${p.label}</span></button>`).join("")}
    </div>
  </div>
  <div>
    <div class="appearance-head">
      <span class="appearance-label">阅读底色</span>
      <button type="button" class="theme-seg-btn" style="padding:2px 8px;" data-set-theme="auto">跟随系统</button>
    </div>
    <div class="theme-grid">
      ${THEME_OPTIONS.map((t) => `<button type="button" class="theme-card-btn" data-set-theme="${t.id}"><span class="theme-card-swatch" style="background:${t.swatch}"></span><span>${t.label}</span></button>`).join("")}
    </div>
  </div>
  <div>
    <div class="appearance-label">画布质感</div>
    <div class="seg-row cols-2">${AMBIENTS.map(([k, lbl]) => `<button type="button" class="theme-seg-btn" data-set-ambient="${k}">${lbl}</button>`).join("")}</div>
  </div>
  <div>
    <div class="appearance-label">主题渐变色</div>
    <div class="accent-dots-grid">${ACCENT_OPTIONS.map((a) => `<button type="button" class="accent-dot" data-set-accent="${a.id}" title="${a.label}" style="background:${a.grad}"></button>`).join("")}</div>
  </div>
  <div>
    <div class="appearance-label">阅读字号</div>
    <div class="seg-row cols-3">${FONT_SCALES.map(([k, lbl]) => `<button type="button" class="theme-seg-btn" data-set-scale="${k}">${lbl}</button>`).join("")}</div>
  </div>
`;

export const initAppearanceControl = (menuEl) => {
  if (!menuEl) return;
  menuEl.innerHTML = buildMenuHtml();
  applyAppearance(false, menuEl);
  menuEl.addEventListener("click", (e) => {
    const presetBtn = e.target.closest("[data-set-preset]");
    const themeBtn = e.target.closest("[data-set-theme]");
    const accentBtn = e.target.closest("[data-set-accent]");
    const ambientBtn = e.target.closest("[data-set-ambient]");
    const scaleBtn = e.target.closest("[data-set-scale]");
    if (!presetBtn && !themeBtn && !accentBtn && !ambientBtn && !scaleBtn) return;
    const s = getGlobalSettings();
    if (presetBtn) {
      const p = PRESET_BUNDLES.find((x) => x.id === presetBtn.dataset.setPreset);
      if (p) Object.assign(s, { theme: p.theme, accent: p.accent, ambient: p.ambient });
    }
    if (themeBtn) s.theme = themeBtn.dataset.setTheme;
    if (accentBtn) s.accent = accentBtn.dataset.setAccent;
    if (ambientBtn) s.ambient = ambientBtn.dataset.setAmbient;
    if (scaleBtn) s.fontScale = scaleBtn.dataset.setScale;
    s.eyeCare = s.theme === "paper" || s.theme === "sage";
    saveGlobalSettings(s);
    applyAppearance(true, menuEl);
  });
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  mq?.addEventListener?.("change", () => { if (getGlobalSettings().theme === "auto") applyAppearance(true, menuEl); });
};
