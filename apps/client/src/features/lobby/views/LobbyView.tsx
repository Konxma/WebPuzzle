import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_IMAGE_ID, DEMO_PIECE_COUNT, PUZZLE_SHAPES, puzzleImageUrl, type PuzzleShape } from "@web-pazle/shared";
import { Icon } from "../../../shared/ui/Icon";
import { ThemeToggle, type ThemeControls } from "../../../shared/ui/ThemeToggle";
import { PuzzlePreview } from "./PuzzlePreview";
import type { LobbyViewModel } from "../viewmodels/LobbyViewModel";
import { MAX_SAVED_PUZZLE_NAME, type SavedPuzzle } from "../models/PuzzleFiles";
import { pieceNoun } from "../../../shared/format";

const piecePresets = [DEMO_PIECE_COUNT, 100, 500, 1000];
const shapeLabels: Record<PuzzleShape, string> = {
  classic: "Класична",
  "classic-wide": "Широкі виступи",
  "classic-narrow": "Вузькі виступи",
  wave: "Хвиляста",
  angular: "Кутова",
};

const labels = {
  idle: "З’єднання ще не перевірено",
  checking: "Перевіряємо з’єднання…",
  online: "Сервер доступний",
  offline: "Немає з’єднання із сервером",
};
function savedPuzzleName(save: SavedPuzzle) {
  return save.name || (save.imageId === DEFAULT_IMAGE_ID ? "Тиха затока" : "Власне фото");
}

function savedPuzzleDetails(save: SavedPuzzle) {
  return `${save.pieceCount} ${pieceNoun(save.pieceCount)} · ${new Date(save.openedAt).toLocaleDateString("uk-UA")}`;
}

export function LobbyView({ viewModel, ...theme }: { viewModel: LobbyViewModel } & ThemeControls) {
  const state = useSyncExternalStore(viewModel.subscribe, viewModel.getSnapshot);
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
  const busyCreating = state.busy && !state.removingSave;
  const customPhoto = state.imageSource === "photo";
  const previewName = customPhoto ? state.photo?.name || "Власне фото" : "Тиха затока";
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

  useEffect(() => {
    function pastePhoto(event: ClipboardEvent) {
      if (viewModel.getSnapshot().busy || deleteDialog.current?.open || renameDialog.current?.open) return;
      const photo = Array.from(event.clipboardData?.files ?? []).find(file => file.type.startsWith("image/"));
      if (!photo) return;
      event.preventDefault();
      viewModel.choosePhoto(photo);
    }
    window.addEventListener("paste", pastePhoto);
    return () => window.removeEventListener("paste", pastePhoto);
  }, [viewModel]);
  return <div className="page">
    <a className="skip-link" href="#main">До основного вмісту</a>
    <header className="header">
      <div className="header-inner">
        <div className="brand"><span className="brand-symbol"><Icon name="puzzle"/></span>WebPuzzle</div>
        <div className="header-actions">
          <span className="header-caption">Неспішний час разом</span>
          <ThemeToggle {...theme}/>
        </div>
      </div>
    </header>
    <main id="main" className="main">
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">Пазли для 1–3 гравців</p>
          <h1 id="hero-title">Одна картина.<br/>Збирайте<br className="desktop-break"/> разом</h1>
          <p className="description">Влаштуйте собі тихий вечір за пазлом.<br className="desktop-break"/> Грайте з друзями за одним столом, кожен зі свого пристрою</p>
          <fieldset className="puzzle-setup" disabled={state.busy}>
            <legend>Налаштування пазла</legend>
            <div className="setup-options" role="group" aria-label="Зображення">
              <button type="button" className="button secondary-button" aria-pressed={!customPhoto}
                onClick={() => viewModel.setImageSource("default")}>Тиха затока</button>
              <button type="button" className="button secondary-button" aria-pressed={customPhoto}
                onClick={() => viewModel.setImageSource("photo")}>Власне фото</button>
            </div>
            {customPhoto && <div className="photo-setting">
              <label className="button secondary-button photo-picker">
                <input type="file" accept=".jpg,.jpeg,.png,.webp" onChange={event => {
                  const file = event.currentTarget.files?.[0];
                  if (file) viewModel.choosePhoto(file);
                  event.currentTarget.value = "";
                }}/>
                {state.photo ? "Змінити файл" : "Вибрати файл"}
              </label>
              <span className="photo-name" title={state.photo?.name}>
                {state.photo ? previewName : "JPG, PNG або WebP"}
              </span>
            </div>}
            <div className="piece-setting">
              <label htmlFor="piece-count">Кількість деталей</label>
              <div className="setup-options" role="group" aria-label="Готові варіанти кількості">
                {piecePresets.map(count => <button key={count} type="button" className="button secondary-button"
                  aria-pressed={!state.pieceCountError && state.pieceCount === count}
                  onClick={() => viewModel.setPieceCountInput(String(count))}>
                  {count === DEMO_PIECE_COUNT ? `${count} · Демо` : count}
                </button>)}
              </div>
              <input id="piece-count" name="pieceCount" type="number" step="1"
                min={state.minPieceCount} max={state.maxPieceCount}
                value={state.pieceCountInput}
                onChange={event => viewModel.setPieceCountInput(event.target.value)}
                aria-invalid={!!state.pieceCountError}
                aria-describedby={state.pieceCountError ? "piece-error piece-hint" : "piece-hint"}/>
              <span id="piece-hint" className="setting-hint">Можна ввести будь-яке ціле число від {state.minPieceCount} до {state.maxPieceCount}</span>
              {state.pieceCountError && <p id="piece-error" className="field-error" role="alert">{state.pieceCountError}</p>}
            </div>
            <div className="shape-setting">
              <span className="setting-label" id="shape-label">Форма деталей</span>
              <div className="setup-options" role="group" aria-labelledby="shape-label">
                {PUZZLE_SHAPES.map(shape => <button key={shape} type="button" className="button secondary-button"
                  aria-pressed={state.shape === shape} onClick={() => viewModel.setShape(shape)}>{shapeLabels[shape]}</button>)}
              </div>
            </div>
            {state.photoError && <p className="field-error" role="alert">{state.photoError}</p>}
            <div className="create-actions">
              <button type="button" className="button primary-button" onClick={viewModel.createRoom}
                disabled={!!state.pieceCountError || state.busy || (customPhoto && !state.photo)}>
                <Icon name="puzzle"/>{busyCreating && customPhoto ? "Готуємо фото…" : "Створити пазл"}
              </button>
            </div>
          </fieldset>
        </div>
        <PuzzlePreview pieceCount={state.pieceCount} shape={state.shape} shapeLabel={shapeLabels[state.shape]}
          name={previewName} customPhoto={customPhoto} photo={customPhoto ? state.photo : null}/>
        <div className="lobby-access">
          <div className="connection-actions">
            <button className="button quiet-button" onClick={viewModel.checkConnection} disabled={state.connection === "checking"}>
              <Icon name="refresh"/>{state.connection === "checking" ? "Перевіряємо…" : "Перевірити з’єднання"}
            </button>
            <span className={`connection ${state.connection}`} role="status">
              <span className="status-dot" aria-hidden="true"/>{labels[state.connection]}
            </span>
          </div>
          <form className="join-room" onSubmit={event=>{event.preventDefault();viewModel.joinRoom();}}>
<label htmlFor="room-code">Є запрошення?</label><div><input id="room-code" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={state.roomCode} placeholder="Посилання або код кімнати" onChange={event=>viewModel.setRoomCode(event.target.value)} aria-invalid={!!state.roomCodeError} aria-describedby={state.roomCodeError?"room-error":undefined}/><button className="button secondary-button" type="submit" disabled={state.busy}>Приєднатися</button></div>
{state.roomCodeError&&<p className="field-error" id="room-error" role="alert">{state.roomCodeError}</p>}</form>
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
        </div>
      </section>
    </main>
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
    <footer className="footer">
      <span>Від першої деталі до останньої</span>
      <span className="desktop-note"><Icon name="monitor"/>Працює в браузері</span>
    </footer>
  </div>;
}
