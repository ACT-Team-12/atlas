"use client";

import { useEffect, useRef, useState } from "react";
import { NAME_MAX, progress, type SavedPlan } from "@/lib/savedPlans";
import { useUi } from "./UiLang";

type Props = {
  plans: SavedPlan[];
  activeId: string | null;
  /** A read or a plan is running: opening another plan waits. */
  busy: boolean;
  saveFailed: boolean;
  /** The last delete (or Clear) did not reach this device's storage, so the plan is still there. */
  deleteFailed: boolean;
  onOpen: (id: string) => void;
  onRename: (id: string, name: string) => void;
  /** False when storage still holds the plan: then nothing was deleted. */
  onDelete: (id: string) => boolean;
  onNew: () => void;
};

/** Shown when a delete or Clear did not reach this device's storage. */
export const DELETE_FAILED =
  "This plan could not be deleted from this device and is still saved here. Try again. If it still will not go, clear this site's data in your browser settings.";

const savedDate = (iso: string, locale?: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(locale === "en" ? undefined : locale, { month: "short", day: "numeric", year: "numeric" });
};

/** "My saved plans": a personal file on this device. Open, rename and delete; progress per plan. */
export function SavedPlans({ plans, activeId, busy, saveFailed, deleteFailed, onOpen, onRename, onDelete, onNew }: Props) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [said, setSaid] = useState("");
  const toggle = useRef<HTMLButtonElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const focusAfter = useRef<string | null>(null);
  const { t, code } = useUi();

  useEffect(() => { if (renaming) renameInput.current?.focus(); }, [renaming]);
  // Put focus back on a sensible control after the row it was on changes or goes away.
  useEffect(() => {
    const id = focusAfter.current;
    if (!id) return;
    focusAfter.current = null;
    (document.getElementById(id) ?? toggle.current)?.focus();
  });

  if (plans.length === 0 && !saveFailed && !deleteFailed) return null;
  const active = plans.find((p) => p.id === activeId);

  function saveName(p: SavedPlan) {
    onRename(p.id, draft);
    setSaid(t("saved.said.renamed", { name: draft.trim() || p.name }));
    setRenaming(null);
    focusAfter.current = `saved-rename-${p.id}`;
  }

  return (
    <div className="mt-6 rounded-2xl border-2 border-ink bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button ref={toggle} type="button" aria-expanded={open} aria-controls="saved-plans-list" onClick={() => setOpen((o) => !o)}
          className="rounded-full border-2 border-ink bg-sun px-4 py-2 text-sm font-extrabold shadow-[0_2px_0_var(--ink)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-deep">
          📁 {t("saved.toggle", { n: plans.length })} {open ? "▴" : "▾"}
        </button>
        <p className="text-sm font-bold text-ink/70">{active ? <>{t("saved.openNow")} <span className="text-ink">{active.name}</span></> : t("saved.noneOpen")}</p>
      </div>
      <p className="sr-only" role="status" aria-live="polite">{said}</p>
      {saveFailed && <p role="alert" className="mt-3 rounded-xl bg-red-soft p-2 text-sm font-bold text-red">{t("saved.saveFailed")}</p>}
      {deleteFailed && <p role="alert" className="mt-3 rounded-xl bg-red-soft p-2 text-sm font-bold text-red" data-delete-failed>{code === "en" ? DELETE_FAILED : t("saved.deleteFailed")}</p>}
      <div id="saved-plans-list" hidden={!open} className="mt-4">
        <p className="text-xs font-semibold text-ink/70">{t("saved.onlyHere")}</p>
        <ul className="mt-3 space-y-3" aria-label={t("saved.list")}>
          {plans.map((p) => {
            const { done, total } = progress(p);
            const isActive = p.id === activeId;
            return (
              <li key={p.id} className={`rounded-2xl border-2 p-3 ${isActive ? "border-teal bg-mint-soft" : "border-ink/40"}`} aria-current={isActive ? "true" : undefined}>
                {renaming === p.id ? (
                  <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); saveName(p); }}>
                    <label className="text-sm font-bold" htmlFor={`saved-name-${p.id}`}>{t("saved.nameLabel")}
                      <input ref={renameInput} id={`saved-name-${p.id}`} value={draft} maxLength={NAME_MAX} onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); setRenaming(null); focusAfter.current = `saved-rename-${p.id}`; } }}
                        placeholder={t("saved.nameExample")} className="mt-1 block w-48 rounded-xl border-2 border-ink/70 bg-paper p-2" />
                    </label>
                    <button type="submit" className="rounded-full bg-ink px-4 py-2 text-sm font-bold text-paper">{t("saved.saveName")}</button>
                    <button type="button" className="rounded-full border-2 border-ink px-4 py-2 text-sm font-bold" onClick={() => { setRenaming(null); focusAfter.current = `saved-rename-${p.id}`; }}>{t("saved.cancel")}</button>
                  </form>
                ) : (
                  <>
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <p className="font-extrabold">{p.name}{isActive && <span className="ml-2 chip bg-teal text-paper">{t("saved.openChip")}</span>}</p>
                      <p className="text-xs font-bold text-ink/70">{t("saved.savedOn", { date: savedDate(p.savedAt, code) })}</p>
                      <p className="text-xs font-bold text-ink/70">{total > 0 ? t("saved.progress", { done, total }) : p.plan ? t("saved.planOnly") : t("saved.noSteps")}</p>
                    </div>
                    {confirming === p.id ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm font-bold" role="group" aria-label={t("saved.deleteAsk", { name: p.name })}>
                        <span>{t("saved.deleteConfirm", { name: p.name })}</span>
                        <button id={`saved-yes-${p.id}`} type="button" className="rounded-full border-2 border-red bg-red-soft px-3 py-1.5 text-red"
                          onClick={() => {
                            const deleted = onDelete(p.id);
                            setSaid(deleted ? t("saved.said.deleted", { name: p.name }) : `${t("saved.said.notDeleted", { name: p.name })} ${code === "en" ? DELETE_FAILED : t("saved.deleteFailed")}`);
                            setConfirming(null);
                            focusAfter.current = deleted ? "saved-plans-toggle-fallback" : `saved-delete-${p.id}`;
                          }}>{t("saved.yesDelete")}</button>
                        <button type="button" className="rounded-full border-2 border-ink px-3 py-1.5"
                          onClick={() => { setConfirming(null); focusAfter.current = `saved-delete-${p.id}`; }}>{t("saved.keep")}</button>
                      </div>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-2 text-sm font-bold">
                        <button type="button" disabled={busy || isActive} onClick={() => { onOpen(p.id); setSaid(t("saved.said.opened", { name: p.name })); }}
                          className="rounded-full bg-ink px-3 py-1.5 text-paper disabled:opacity-40" aria-label={isActive ? t("saved.isOpen", { name: p.name }) : t("saved.openName", { name: p.name })}>{isActive ? t("saved.openNowButton") : t("saved.open")}</button>
                        <button id={`saved-rename-${p.id}`} type="button" onClick={() => { setDraft(p.name); setRenaming(p.id); }}
                          className="rounded-full border-2 border-ink px-3 py-1" aria-label={t("saved.renameName", { name: p.name })}>{t("saved.rename")}</button>
                        <button id={`saved-delete-${p.id}`} type="button" onClick={() => { setConfirming(p.id); focusAfter.current = `saved-yes-${p.id}`; }}
                          className="rounded-full border-2 border-ink px-3 py-1 hover:bg-red-soft" aria-label={t("saved.deleteName", { name: p.name })}>{t("saved.delete")}</button>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
        <button type="button" disabled={busy || !activeId} onClick={() => { onNew(); setSaid(t("saved.said.new")); }}
          className="mt-4 rounded-full border-2 border-ink bg-mint px-4 py-2 text-sm font-bold disabled:opacity-40">{t("saved.new")}</button>
      </div>
    </div>
  );
}
