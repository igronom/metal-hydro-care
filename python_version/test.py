"""
Розрахунок коефіцієнта дифузії важких металів
Графічний інтерфейс — tkinter + matplotlib
Автор: Зіньковський А.О.
"""

import tkinter as tk
from tkinter import ttk, messagebox
import numpy as np
from scipy.special import erfcinv, erfc
import matplotlib.pyplot as plt
import matplotlib.gridspec as gridspec
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg
from matplotlib.figure import Figure


# ═══════════════════════════════════════════════════════════════════════════
#  КОЛЬОРОВА ПАЛІТРА
# ═══════════════════════════════════════════════════════════════════════════

THEME = {
    "bg":         "#0f1117",   # фон вікна
    "bg2":        "#1a1f2e",   # фон панелей
    "bg3":        "#242938",   # фон полів вводу
    "border":     "#2e3548",   # рамки
    "accent":     "#3b82f6",   # синій акцент 
    "accent2":    "#f59e0b",   # золотий акцент
    "green":      "#22c55e",   # успіх
    "red":        "#ef4444",   # помилка
    "yellow":     "#eab308",   # попередження
    "text":       "#e2e8f0",   # основний текст
    "muted":      "#64748b",   # другорядний текст
    "white":      "#ffffff",
}

METAL_COLORS = [
    "#3b82f6", "#ef4444", "#22c55e", "#f59e0b",
    "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16",
]


# ═══════════════════════════════════════════════════════════════════════════
#  МАТЕМАТИКА
# ═══════════════════════════════════════════════════════════════════════════

def calc_D_single(z, t, C, C0):
    u = C / C0
    if not (0.001 < u < 0.999):
        return None, u, "поза зоною"
    xi  = erfcinv(u)
    D_i = z**2 / (4 * xi**2 * t)
    if u < 0.05:
        label = "низька"
    elif u <= 0.40:
        label = "оптимум"
    else:
        label = "висока"
    return D_i, u, label


def calc_D_all(probes, C0):
    D_vals, details = [], []
    for z, t, C in probes:
        D_i, u, label = calc_D_single(z, t, C, C0)
        details.append({"z": z, "t": t, "C": C, "u": u, "D_i": D_i, "label": label})
        if D_i is not None:
            D_vals.append(D_i)
    D_avg = np.mean(D_vals) if D_vals else None
    return D_avg, details


# ═══════════════════════════════════════════════════════════════════════════
#  КАСТОМНІ ВІДЖЕТИ
# ═══════════════════════════════════════════════════════════════════════════

class StyledEntry(tk.Entry):
    def __init__(self, master, **kw):
        kw.setdefault("bg",              THEME["bg3"])
        kw.setdefault("fg",              THEME["text"])
        kw.setdefault("insertbackground",THEME["accent"])
        kw.setdefault("relief",          "flat")
        kw.setdefault("highlightthickness", 1)
        kw.setdefault("highlightcolor",  THEME["accent"])
        kw.setdefault("highlightbackground", THEME["border"])
        kw.setdefault("font",            ("Courier New", 11))
        kw.setdefault("bd",              6)
        super().__init__(master, **kw)


class StyledButton(tk.Button):
    def __init__(self, master, variant="primary", **kw):
        bg = THEME["accent"] if variant == "primary" else THEME["bg3"]
        fg = THEME["white"]
        kw.setdefault("bg",              bg)
        kw.setdefault("fg",              fg)
        kw.setdefault("relief",          "flat")
        kw.setdefault("cursor",          "hand2")
        kw.setdefault("font",            ("Segoe UI", 10, "bold"))
        kw.setdefault("padx",            16)
        kw.setdefault("pady",            8)
        kw.setdefault("bd",              0)
        kw.setdefault("activebackground", "#2563eb" if variant == "primary" else THEME["border"])
        kw.setdefault("activeforeground", THEME["white"])
        super().__init__(master, **kw)
        self.bind("<Enter>", lambda e: self._hover(True))
        self.bind("<Leave>", lambda e: self._hover(False))
        self._bg = bg

    def _hover(self, on):
        if str(self["state"]) == "normal":
            self.config(bg="#2563eb" if on else self._bg)


class Label(tk.Label):
    def __init__(self, master, style="normal", **kw):
        styles = {
            "normal":  {"fg": THEME["text"],   "font": ("Segoe UI", 10)},
            "muted":   {"fg": THEME["muted"],  "font": ("Segoe UI", 9)},
            "title":   {"fg": THEME["white"],  "font": ("Segoe UI", 13, "bold")},
            "section": {"fg": THEME["accent"], "font": ("Segoe UI", 10, "bold")},
            "mono":    {"fg": THEME["text"],   "font": ("Courier New", 10)},
            "result":  {"fg": THEME["accent2"],"font": ("Courier New", 14, "bold")},
        }
        for k, v in styles.get(style, styles["normal"]).items():
            kw.setdefault(k, v)
        kw.setdefault("bg", THEME["bg2"])
        super().__init__(master, **kw)


# ═══════════════════════════════════════════════════════════════════════════
#  РЯДОК ПРОБИ
# ═══════════════════════════════════════════════════════════════════════════

class ProbeRow(tk.Frame):
    def __init__(self, master, index, on_remove, **kw):
        super().__init__(master, bg=THEME["bg3"],
                         highlightbackground=THEME["border"],
                         highlightthickness=1, **kw)
        self.index = index

        # Номер
        tk.Label(self, text=f"#{index+1}", bg=THEME["bg3"],
                 fg=THEME["muted"], font=("Courier New", 10),
                 width=3).pack(side="left", padx=(8, 4))

        # Поля z, t, C
        self.z_var = tk.StringVar()
        self.t_var = tk.StringVar()
        self.C_var = tk.StringVar()

        for var, hint in [(self.z_var, "z, см"),
                          (self.t_var, "t, діб"),
                          (self.C_var, "C, мг/л")]:
            frame = tk.Frame(self, bg=THEME["bg3"])
            frame.pack(side="left", padx=4, pady=6)
            tk.Label(frame, text=hint, bg=THEME["bg3"],
                     fg=THEME["muted"], font=("Segoe UI", 8)).pack(anchor="w")
            e = StyledEntry(frame, textvariable=var, width=9)
            e.pack()

        # Індикатор якості
        self.quality_label = tk.Label(
            self, text="", bg=THEME["bg3"],
            font=("Segoe UI", 9, "bold"), width=10
        )
        self.quality_label.pack(side="left", padx=6)

        # Результат D_i
        self.di_label = tk.Label(
            self, text="", bg=THEME["bg3"],
            fg=THEME["muted"], font=("Courier New", 10), width=12
        )
        self.di_label.pack(side="left", padx=4)

        # Кнопка видалення
        tk.Button(
            self, text="✕", bg=THEME["bg3"], fg=THEME["muted"],
            font=("Segoe UI", 11), relief="flat", cursor="hand2",
            bd=0, padx=8, command=lambda: on_remove(self)
        ).pack(side="right", padx=4)

    def get_values(self):
        try:
            return float(self.z_var.get()), float(self.t_var.get()), float(self.C_var.get())
        except ValueError:
            return None

    def set_result(self, D_i, u, label):
        colors = {
            "оптимум":   THEME["green"],
            "низька":    THEME["yellow"],
            "висока":    THEME["yellow"],
            "поза зоною": THEME["red"],
        }
        col = colors.get(label, THEME["muted"])
        self.quality_label.config(text=label, fg=col)
        if D_i is not None:
            self.di_label.config(text=f"{D_i:.5f}", fg=THEME["text"])
        else:
            self.di_label.config(text="—", fg=THEME["red"])

    def clear_result(self):
        self.quality_label.config(text="")
        self.di_label.config(text="")


# ═══════════════════════════════════════════════════════════════════════════
#  ПАНЕЛЬ ОДНОГО МЕТАЛУ
# ═══════════════════════════════════════════════════════════════════════════

class MetalPanel(tk.Frame):
    def __init__(self, master, index, on_remove, on_change, **kw):
        super().__init__(master, bg=THEME["bg2"],
                         highlightbackground=THEME["border"],
                         highlightthickness=1, **kw)
        self.index     = index
        self.on_remove = on_remove
        self.on_change = on_change
        self.probe_rows = []
        self._build()

    def _build(self):
        color = METAL_COLORS[self.index % len(METAL_COLORS)]

        # ── Заголовок панелі ─────────────────────────────────────────────
        header = tk.Frame(self, bg=color, height=3)
        header.pack(fill="x")

        top = tk.Frame(self, bg=THEME["bg2"])
        top.pack(fill="x", padx=12, pady=(10, 6))

        tk.Label(top, text=f"МЕТАЛ {self.index+1}",
                 bg=THEME["bg2"], fg=color,
                 font=("Segoe UI", 9, "bold")).pack(side="left")

        # Кнопка видалення металу
        tk.Button(
            top, text="Видалити метал", bg=THEME["bg2"],
            fg=THEME["muted"], font=("Segoe UI", 8),
            relief="flat", cursor="hand2", bd=0,
            command=lambda: self.on_remove(self)
        ).pack(side="right")

        # ── Поля назви та C0 ─────────────────────────────────────────────
        fields = tk.Frame(self, bg=THEME["bg2"])
        fields.pack(fill="x", padx=12, pady=4)

        # Назва
        f1 = tk.Frame(fields, bg=THEME["bg2"])
        f1.pack(side="left", padx=(0, 16))
        tk.Label(f1, text="Назва металу", bg=THEME["bg2"],
                 fg=THEME["muted"], font=("Segoe UI", 8)).pack(anchor="w")
        self.name_var = tk.StringVar()
        e_name = StyledEntry(f1, textvariable=self.name_var, width=12)
        e_name.pack()
        self.name_var.trace_add("write", lambda *a: self.on_change())

        # C0
        f2 = tk.Frame(fields, bg=THEME["bg2"])
        f2.pack(side="left")
        tk.Label(f2, text="C₀ (поверхня, мг/л)", bg=THEME["bg2"],
                 fg=THEME["muted"], font=("Segoe UI", 8)).pack(anchor="w")
        self.c0_var = tk.StringVar(value="1.0")
        e_c0 = StyledEntry(f2, textvariable=self.c0_var, width=10)
        e_c0.pack()
        self.c0_var.trace_add("write", lambda *a: self.on_change())

        # ── Заголовок таблиці проб ───────────────────────────────────────
        sep = tk.Frame(self, bg=THEME["border"], height=1)
        sep.pack(fill="x", padx=12, pady=(8, 0))

        hdr = tk.Frame(self, bg=THEME["bg2"])
        hdr.pack(fill="x", padx=12, pady=(2, 0))
        for txt, w in [("№", 3), ("Глибина z", 9), ("Час t", 9),
                       ("Концентрація C", 9), ("Зона C/C₀", 10), ("Dᵢ (см²/добу)", 12)]:
            tk.Label(hdr, text=txt, bg=THEME["bg2"], fg=THEME["muted"],
                     font=("Segoe UI", 8), width=w, anchor="w").pack(side="left", padx=4)

        # ── Контейнер рядків проб ────────────────────────────────────────
        self.probes_frame = tk.Frame(self, bg=THEME["bg2"])
        self.probes_frame.pack(fill="x", padx=12, pady=4)

        # Мінімум 2 проби за замовчуванням
        self._add_probe()
        self._add_probe()

        # ── Кнопка + результат ───────────────────────────────────────────
        bottom = tk.Frame(self, bg=THEME["bg2"])
        bottom.pack(fill="x", padx=12, pady=(0, 10))

        StyledButton(
            bottom, variant="secondary", text="+ Додати пробу",
            command=self._add_probe, font=("Segoe UI", 9)
        ).pack(side="left")

        # D_avg результат
        self.result_frame = tk.Frame(bottom, bg=THEME["bg2"])
        self.result_frame.pack(side="right")
        tk.Label(self.result_frame, text="D_avg =",
                 bg=THEME["bg2"], fg=THEME["muted"],
                 font=("Segoe UI", 9)).pack(side="left", padx=(0, 6))
        self.davg_label = tk.Label(
            self.result_frame, text="—",
            bg=THEME["bg2"], fg=color,
            font=("Courier New", 14, "bold")
        )
        self.davg_label.pack(side="left")
        tk.Label(self.result_frame, text="см²/добу",
                 bg=THEME["bg2"], fg=THEME["muted"],
                 font=("Segoe UI", 9)).pack(side="left", padx=(4, 0))

    def _add_probe(self):
        idx = len(self.probe_rows)
        row = ProbeRow(self.probes_frame, idx, self._remove_probe)
        row.pack(fill="x", pady=2)
        self.probe_rows.append(row)
        self.on_change()

    def _remove_probe(self, row):
        if len(self.probe_rows) <= 2:
            messagebox.showwarning("Увага", "Потрібно щонайменше 2 проби!")
            return
        self.probe_rows.remove(row)
        row.destroy()
        self.on_change()

    def get_data(self):
        name = self.name_var.get().strip()
        try:
            C0 = float(self.c0_var.get())
        except ValueError:
            return None
        probes = []
        for row in self.probe_rows:
            vals = row.get_values()
            if vals:
                probes.append(list(vals))
        if not name or C0 <= 0 or len(probes) < 2:
            return None
        return {"name": name, "C0": C0, "probes": probes}

    def set_results(self, D_avg, details):
        for row, det in zip(self.probe_rows, details):
            row.set_result(det["D_i"], det["u"], det["label"])
        if D_avg is not None:
            self.davg_label.config(text=f"{D_avg:.5f}")
        else:
            self.davg_label.config(text="помилка", fg=THEME["red"])


# ═══════════════════════════════════════════════════════════════════════════
#  ГОЛОВНЕ ВІКНО
# ═══════════════════════════════════════════════════════════════════════════

class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Коефіцієнт дифузії важких металів")
        self.configure(bg=THEME["bg"])
        self.geometry("1100x750")
        self.minsize(900, 600)

        self.metal_panels = []
        self._build_ui()

    def _build_ui(self):

        # ── Заголовок ──────────────────────────────────────────────────
        hdr = tk.Frame(self, bg=THEME["bg"], pady=0)
        hdr.pack(fill="x")

        # Кольорова смужка зверху
        tk.Frame(self, bg=THEME["accent"], height=3).pack(fill="x")

        title_bar = tk.Frame(self, bg=THEME["bg2"], pady=14)
        title_bar.pack(fill="x")

        tk.Label(
            title_bar,
            text="КОЕФІЦІЄНТ ДИФУЗІЇ ВАЖКИХ МЕТАЛІВ",
            bg=THEME["bg2"], fg=THEME["white"],
            font=("Segoe UI", 14, "bold")
        ).pack(side="left", padx=20)

        tk.Label(
            title_bar,
            text="D = z² / ( 4 · [erfc⁻¹(C/C₀)]² · t )",
            bg=THEME["bg2"], fg=THEME["accent"],
            font=("Courier New", 11)
        ).pack(side="right", padx=20)

        # ── Головний layout: ліво = ввід, право = графік ───────────────
        main = tk.Frame(self, bg=THEME["bg"])
        main.pack(fill="both", expand=True, padx=0, pady=0)

        # Ліва панель — ввід
        left = tk.Frame(main, bg=THEME["bg"], width=480)
        left.pack(side="left", fill="both", padx=(12, 6), pady=12)
        left.pack_propagate(False)
        self._build_left(left)

        # Права панель — графік
        right = tk.Frame(main, bg=THEME["bg2"],
                         highlightbackground=THEME["border"],
                         highlightthickness=1)
        right.pack(side="left", fill="both", expand=True, padx=(6, 12), pady=12)
        self._build_right(right)

    def _build_left(self, parent):

        # Скролований контейнер для металів
        scroll_frame = tk.Frame(parent, bg=THEME["bg"])
        scroll_frame.pack(fill="both", expand=True)

        canvas = tk.Canvas(scroll_frame, bg=THEME["bg"],
                           highlightthickness=0)
        scrollbar = ttk.Scrollbar(scroll_frame, orient="vertical",
                                   command=canvas.yview)
        self.metals_container = tk.Frame(canvas, bg=THEME["bg"])

        self.metals_container.bind(
            "<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all"))
        )
        canvas.create_window((0, 0), window=self.metals_container, anchor="nw")
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        # Прокрутка мишею
        canvas.bind_all("<MouseWheel>",
                        lambda e: canvas.yview_scroll(-1*(e.delta//120), "units"))

        # ── Кнопки знизу ─────────────────────────────────────────────
        btn_bar = tk.Frame(parent, bg=THEME["bg"], pady=8)
        btn_bar.pack(fill="x")

        StyledButton(
            btn_bar, text="+ Додати метал",
            command=self._add_metal
        ).pack(side="left", padx=(0, 8))

        StyledButton(
            btn_bar, text="⟳ Розрахувати",
            command=self._calculate,
            bg=THEME["accent2"], activebackground="#d97706"
        ).pack(side="left")

        StyledButton(
            btn_bar, variant="secondary", text="✕ Очистити все",
            command=self._clear_all
        ).pack(side="right")

        # Додаємо перший метал
        self._add_metal()

    def _build_right(self, parent):
        tk.Label(
            parent, text="ГРАФІКИ",
            bg=THEME["bg2"], fg=THEME["muted"],
            font=("Segoe UI", 9, "bold")
        ).pack(anchor="nw", padx=12, pady=(10, 0))

        self.fig = Figure(facecolor=THEME["bg2"], tight_layout=True)
        self.canvas_plot = FigureCanvasTkAgg(self.fig, master=parent)
        self.canvas_plot.get_tk_widget().pack(fill="both", expand=True,
                                              padx=8, pady=(4, 8))
        self._draw_placeholder()

    def _draw_placeholder(self):
        self.fig.clear()
        ax = self.fig.add_subplot(111)
        ax.set_facecolor(THEME["bg2"])
        ax.text(
            0.5, 0.5,
            "Введи дані і натисни\n«Розрахувати»",
            ha="center", va="center",
            transform=ax.transAxes,
            color=THEME["muted"], fontsize=13,
            fontfamily="Segoe UI"
        )
        for sp in ax.spines.values():
            sp.set_color(THEME["border"])
        ax.tick_params(colors=THEME["border"])
        self.canvas_plot.draw()

    # ── Керування металами ────────────────────────────────────────────

    def _add_metal(self):
        idx   = len(self.metal_panels)
        panel = MetalPanel(
            self.metals_container, idx,
            on_remove=self._remove_metal,
            on_change=lambda: None
        )
        panel.pack(fill="x", pady=(0, 10))
        self.metal_panels.append(panel)

    def _remove_metal(self, panel):
        if len(self.metal_panels) <= 1:
            messagebox.showwarning("Увага", "Потрібен хоча б один метал!")
            return
        self.metal_panels.remove(panel)
        panel.destroy()

    def _clear_all(self):
        for p in self.metal_panels[:]:
            p.destroy()
        self.metal_panels.clear()
        self._add_metal()
        self._draw_placeholder()

    # ── Розрахунок ────────────────────────────────────────────────────

    def _calculate(self):
        all_metals = []

        for panel in self.metal_panels:
            data = panel.get_data()
            if data is None:
                messagebox.showerror(
                    "Помилка вводу",
                    f"Перевір дані в панелі металу {panel.index+1}.\n"
                    "Назва, C₀ і щонайменше 2 проби — обов'язкові."
                )
                return

            D_avg, details = calc_D_all(data["probes"], data["C0"])
            data["D_avg"]   = D_avg
            data["details"] = details
            panel.set_results(D_avg, details)
            all_metals.append(data)

        self._draw_plots(all_metals)

    # ── Графіки ──────────────────────────────────────────────────────

    def _draw_plots(self, metals):
        self.fig.clear()
        n = len(metals)

        # Layout: профілі ліворуч, порівняння праворуч
        if n == 1:
            gs = gridspec.GridSpec(1, 2, figure=self.fig,
                                   width_ratios=[2, 1], wspace=0.35)
        else:
            rows = (n + 1) // 2
            gs   = gridspec.GridSpec(rows, 3, figure=self.fig,
                                     width_ratios=[1, 1, 1.1],
                                     hspace=0.5, wspace=0.38)

        z_arr = np.linspace(0, 20, 400)

        # ── Профілі для кожного металу ───────────────────────────────
        for i, metal in enumerate(metals):
            if n == 1:
                ax = self.fig.add_subplot(gs[0, 0])
            else:
                row = i // 2
                col = i % 2
                ax  = self.fig.add_subplot(gs[row, col])

            color  = METAL_COLORS[i % len(METAL_COLORS)]
            D_avg  = metal["D_avg"]
            C0     = metal["C0"]
            name   = metal["name"]

            ax.set_facecolor(THEME["bg"])
            for sp in ax.spines.values():
                sp.set_color(THEME["border"])
            ax.tick_params(colors=THEME["muted"], labelsize=7)
            ax.set_xlabel("C / C₀", color=THEME["muted"], fontsize=8)
            ax.set_ylabel("Глибина z, см", color=THEME["muted"], fontsize=8)

            if D_avg is None:
                ax.text(0.5, 0.5, f"{name}\nНемає даних",
                        ha="center", va="center", color=THEME["muted"],
                        transform=ax.transAxes)
                ax.set_title(name, color=color, fontsize=9, fontweight="bold")
                continue

            # Профілі в різні часи
            t_max = max(d["t"] for d in metal["details"])
            for j, t_plot in enumerate(np.linspace(t_max*0.25, t_max, 4)):
                alpha = 0.3 + 0.7 * (j / 3)
                lw    = 1.0 + j * 0.5
                prof  = C0 * erfc(z_arr / (2 * np.sqrt(D_avg * t_plot)))
                ax.plot(prof / C0, z_arr,
                        color=color, alpha=alpha, lw=lw,
                        label=f"t={t_plot:.0f}д")

            # Точки вимірювань
            for det in metal["details"]:
                if det["D_i"] is not None:
                    mc = THEME["green"] if det["label"] == "оптимум" else THEME["yellow"]
                    ax.scatter(det["u"], det["z"], color=mc, s=50,
                               zorder=5, edgecolors="white", linewidths=0.8)

            # Оптимальна зона
            ax.axvspan(0.05, 0.40, alpha=0.07, color=THEME["green"])
            ax.axvline(0.20, color=THEME["green"], lw=0.7,
                       alpha=0.4, linestyle="--")

            ax.invert_yaxis()
            ax.set_xlim(-0.02, 1.05)
            ax.set_title(f"{name}   D={D_avg:.4f} см²/добу",
                         color=color, fontsize=9, fontweight="bold", pad=6)
            ax.legend(fontsize=6, loc="lower right",
                      facecolor=THEME["bg3"], edgecolor=THEME["border"],
                      labelcolor=THEME["muted"])

        # ── Порівняльний графік ──────────────────────────────────────
        if n == 1:
            ax_cmp = self.fig.add_subplot(gs[0, 1])
        else:
            ax_cmp = self.fig.add_subplot(gs[:, 2])

        valid  = [(m["name"], m["D_avg"]) for m in metals if m["D_avg"]]
        ax_cmp.set_facecolor(THEME["bg"])
        for sp in ax_cmp.spines.values():
            sp.set_color(THEME["border"])
        ax_cmp.tick_params(colors=THEME["muted"], labelsize=8)

        if valid:
            names_ = [v[0] for v in valid]
            dvals  = [v[1] for v in valid]
            cols_  = [METAL_COLORS[i % len(METAL_COLORS)]
                      for i in range(len(valid))]

            bars = ax_cmp.barh(names_, dvals, color=cols_,
                               height=0.5, edgecolor=THEME["bg2"],
                               linewidth=1.5)

            max_d = max(dvals)
            for bar, val in zip(bars, dvals):
                ax_cmp.text(
                    val + max_d * 0.03,
                    bar.get_y() + bar.get_height() / 2,
                    f"{val:.5f}",
                    va="center", fontsize=8,
                    color=THEME["text"], fontweight="bold"
                )

            # Виділяємо максимум
            idx_max = dvals.index(max_d)
            bars[idx_max].set_edgecolor(THEME["accent2"])
            bars[idx_max].set_linewidth(2)

            ax_cmp.set_xlim(0, max_d * 1.4)
            ax_cmp.set_xlabel("D, см²/добу",
                               color=THEME["muted"], fontsize=8)

        ax_cmp.set_title("Порівняння D",
                         color=THEME["white"], fontsize=9,
                         fontweight="bold", pad=6)

        self.canvas_plot.draw()


# ═══════════════════════════════════════════════════════════════════════════
#  ЗАПУСК
# ═══════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    # Стиль для ttk scrollbar
    style = ttk.Style()
    try:
        style.theme_use("clam")
    except Exception:
        pass

    app = App()
    app.mainloop()