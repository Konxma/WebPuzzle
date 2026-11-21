import { useEffect, useSyncExternalStore } from "react";
import { DEFAULT_IMAGE_ID, DEMO_PIECE_COUNT, MAX_ROOM_PLAYERS, PUZZLE_SHAPES } from "@web-pazle/shared";
import { Icon } from "../../../shared/ui/Icon";
import { ThemeToggle, type ThemeControls } from "../../../shared/ui/ThemeToggle";
import { PuzzlePreview } from "./PuzzlePreview";
import type { LobbyViewModel } from "../viewmodels/LobbyViewModel";
import { SavedPuzzles } from "./SavedPuzzles";
import { shapeLabels } from "./puzzleShapeLabels";

const piecePresets = [DEMO_PIECE_COUNT, 100, 500, 1000];
const labels = {
  idle: "З’єднання ще не перевірено",
  checking: "Перевіряємо з’єднання…",
  online: "Сервер доступний",
  offline: "Немає з’єднання із сервером",
};
export function LobbyView({ viewModel, ...theme }: { viewModel: LobbyViewModel } & ThemeControls) {
  const state = useSyncExternalStore(viewModel.subscribe, viewModel.getSnapshot);
  const busyCreating = state.busy && !state.removingSave;
  const customPhoto = state.imageSource === "photo";
  const defaultName = state.defaultImageId === DEFAULT_IMAGE_ID ? "Тиха затока" : "Фото з лаунчера";
  const previewName = customPhoto ? state.photo?.name || "Власне фото" : defaultName;
  useEffect(() => {
    function pastePhoto(event: ClipboardEvent) {
      if (viewModel.getSnapshot().busy || document.querySelector("dialog.delete-puzzle-dialog[open]")) return;
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
          <p className="eyebrow">Пазли для 1–{MAX_ROOM_PLAYERS} гравців</p>
          <h1 id="hero-title">Одна картина.<br/>Збирайте<br className="desktop-break"/> разом</h1>
          <p className="description">Влаштуйте собі тихий вечір за пазлом.<br className="desktop-break"/> Грайте з друзями за одним столом, кожен зі свого пристрою</p>
          <fieldset className="puzzle-setup" disabled={state.busy}>
            <legend>Налаштування пазла</legend>
            <div className="setup-options" role="group" aria-label="Зображення">
              <button type="button" className="button secondary-button" aria-pressed={!customPhoto}
                onClick={() => viewModel.setImageSource("default")}>{defaultName}</button>
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
          name={previewName} defaultImageId={state.defaultImageId} customPhoto={customPhoto} photo={customPhoto ? state.photo : null}/>
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
          <SavedPuzzles viewModel={viewModel} state={state}/>
        </div>
      </section>
    </main>
    <footer className="footer">
      <span>Від першої деталі до останньої</span>
      <span className="desktop-note"><Icon name="monitor"/>Працює в браузері</span>
    </footer>
  </div>;
}
