import { useEffect, useRef, useState } from "react";
import { DEFAULT_IMAGE_ID, puzzleImageUrl } from "@web-pazle/shared";
import { MAX_SAVED_PUZZLE_NAME, type SavedPuzzle } from "../models/PuzzleFiles";
import type { LobbyViewModel } from "../viewmodels/LobbyViewModel";
import { pieceNoun } from "../../../shared/format";
import { shapeLabels } from "./puzzleShapeLabels";

function savedPuzzleName(save: SavedPuzzle) {
  return save.name || (save.imageId === DEFAULT_IMAGE_ID ? "Тиха затока" : "Власне фото");
}

function savedPuzzleDetails(save: SavedPuzzle) {
  return `${save.pieceCount} ${pieceNoun(save.pieceCount)} · ${new Date(save.openedAt).toLocaleDateString("uk-UA")}`;
}

export function SavedPuzzles({ viewModel, state }: {
  viewModel: LobbyViewModel;
  state: ReturnType<LobbyViewModel["getSnapshot"]>;
}) {
  const [puzzleToDelete, setPuzzleToDelete] = useState<SavedPuzzle | null>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const renameDialog = useRef<HTMLDialogElement>(null);
  const [rename, setRename] = useState<{ key: string; name: string; error: string | null } | null>(null);
  function closeRenameDialog() {
    renameDialog.current?.close();
    setRename(null);
  }
  function closeDeleteDialog() {
    deleteDialog.current?.close();
    setPuzzleToDelete(null);
  }
  useEffect(() => {
    const dialog = deleteDialog.current;
    if (puzzleToDelete && dialog && !dialog.open) dialog.showModal();
  }, [puzzleToDelete]);

  const renameKey = rename?.key;
  useEffect(() => {
    const dialog = renameDialog.current;
    if (renameKey && dialog && !dialog.open) {
      dialog.showModal();
      dialog.querySelector("input")?.select();
    }
  }, [renameKey]);

  return <>
    {state.savedPuzzles.length > 0 && <section className="saved-puzzles" aria-labelledby="saved-title">
      <h2 id="saved-title">Збережені пазли</h2>
      {state.saveError && <p className="field-error" role="alert">{state.saveError}</p>}
      <ul>{state.savedPuzzles.map(save => {
        const details = state.saveDetails[save.key];
        const name = savedPuzzleName(save);
        return <li key={save.key}>
          <img src={puzzleImageUrl(save.imageId)} alt="" loading="lazy"/>
          <div className="saved-puzzle-label">
            <h3>{name}</h3>
            <small>{save.pieceCount} {pieceNoun(save.pieceCount)}{details && ` · ${shapeLabels[details.shape]}`}</small>
            {details && <div className="saved-puzzle-progress">
              <small>{details.placed === save.pieceCount ? "Пазл зібрано" : `Зібрано ${details.placed} з ${save.pieceCount}`}</small>
              <progress value={details.placed} max={save.pieceCount} aria-label={`Прогрес пазла «${name}»`}/>
            </div>}
            <small>{details ? "Збережено" : "Відкрито"} {new Date(details?.savedAt ?? save.openedAt).toLocaleDateString("uk-UA")}</small>
          </div>
          <div className="saved-puzzle-actions">
            <button type="button" className="button secondary-button" disabled={state.busy} onClick={() => viewModel.continuePuzzle(save.key)}>Продовжити</button>
            <button type="button" className="button quiet-button" disabled={state.busy} aria-haspopup="dialog"
              aria-label={`Перейменувати пазл «${name}»`}
              onClick={() => setRename({ key: save.key, name, error: null })}>Перейменувати</button>
            <button type="button" className="button quiet-button delete-save" disabled={state.busy}
              aria-haspopup="dialog" aria-label={`Видалити пазл «${name}», ${savedPuzzleDetails(save)}`}
              onClick={() => setPuzzleToDelete(save)}>Видалити</button>
          </div>
        </li>;
      })}</ul>
    </section>}
    <dialog ref={renameDialog} className="delete-puzzle-dialog" aria-labelledby="rename-puzzle-title" onCancel={event => {
      event.preventDefault();
      closeRenameDialog();
    }}>
      {rename && <form className="rename-puzzle-form" onSubmit={event => {
        event.preventDefault();
        const error = viewModel.renamePuzzle(rename.key, rename.name);
        if (error) setRename({ ...rename, error });
        else closeRenameDialog();
      }}>
        <h2 id="rename-puzzle-title">Перейменувати пазл</h2>
        <label htmlFor="saved-puzzle-name">Назва пазла</label>
        <input id="saved-puzzle-name" value={rename.name} maxLength={MAX_SAVED_PUZZLE_NAME} required
          aria-invalid={!!rename.error} aria-describedby={rename.error ? "rename-puzzle-error" : undefined}
          onChange={event => setRename({ ...rename, name: event.target.value, error: null })}/>
        {rename.error && <p className="field-error" id="rename-puzzle-error" role="alert">{rename.error}</p>}
        <div className="delete-puzzle-actions">
          <button type="button" className="button secondary-button" onClick={closeRenameDialog}>Скасувати</button>
          <button type="submit" className="button primary-button">Зберегти назву</button>
        </div>
      </form>}
    </dialog>
    <dialog ref={deleteDialog} className="delete-puzzle-dialog" aria-labelledby="delete-puzzle-title"
      aria-describedby="delete-puzzle-warning" onCancel={event => {
        event.preventDefault();
        closeDeleteDialog();
      }}>
      {puzzleToDelete && <>
        <h2 id="delete-puzzle-title">Видалити пазл?</h2>
        <div className="delete-puzzle-preview">
          <img src={puzzleImageUrl(puzzleToDelete.imageId)} alt=""/>
          <span className="saved-puzzle-label">
            {savedPuzzleName(puzzleToDelete)}
            <small>{savedPuzzleDetails(puzzleToDelete)}</small>
          </span>
        </div>
        <p id="delete-puzzle-warning">Після видалення відновити прогрес не вдасться.</p>
        <div className="delete-puzzle-actions">
          <button type="button" className="button secondary-button" onClick={closeDeleteDialog}>Скасувати</button>
          <button type="button" className="button primary-button delete-puzzle-confirm" disabled={state.busy} onClick={() => {
            closeDeleteDialog();
            void viewModel.removePuzzle(puzzleToDelete.key);
          }}>Видалити пазл</button>
        </div>
      </>}
    </dialog>
  </>;
}
