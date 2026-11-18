import { QRCodeCanvas } from "qrcode.react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_IMAGE_ID, isPuzzleTray, BOARD_MARKER_DURATION, MAX_ROOM_PLAYERS, MAX_PUZZLE_TRAYS, MAX_TRAY_NAME_LENGTH, puzzleImageUrl, type BoardMarkerDuration, type PuzzleFeatures, type PuzzleTray, type Tile } from "@web-pazle/shared";
import type { PuzzleViewModel } from "../viewmodels/PuzzleViewModel";
import type { BoardControls, PuzzleRenderer } from "../rendering/PuzzleRenderer";
import { Icon } from "../../../shared/ui/Icon";
import { ThemeToggle, type ThemeControls } from "../../../shared/ui/ThemeToggle";
import { PuzzleFeatureFields } from "../../../shared/ui/PuzzleFeatureFields";
import { PuzzleReference } from "./PuzzleReference";
import { pieceNoun } from "../../../shared/format";

const LOCAL_MARKER_DURATION = 1400;

function trayAtPointer(x: number, y: number): PuzzleTray | null | undefined {
  const tray = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-puzzle-tray]")?.dataset.puzzleTray;
  if (tray === "table") return null;
  return isPuzzleTray(tray) ? tray : undefined;
}
export function PuzzleView({viewModel:vm, ...theme}:{viewModel:PuzzleViewModel} & ThemeControls){
  const state=useSyncExternalStore(vm.subscribe,vm.getSnapshot);
  const host=useRef<HTMLDivElement>(null),renderer=useRef<PuzzleRenderer|null>(null);
  const shell = useRef<HTMLDivElement>(null);
  const boardMenu = useRef<HTMLDivElement>(null);
  const boardMenuButton = useRef<HTMLButtonElement>(null);
  const deleteTrayDialog = useRef<HTMLDialogElement>(null);
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const [featureDraft, setFeatureDraft] = useState<PuzzleFeatures | null>(null);
  const [markerDurationDraft, setMarkerDurationDraft] = useState<BoardMarkerDuration>(BOARD_MARKER_DURATION);
  const [markerShortcutDraft, setMarkerShortcutDraft] = useState(false);
  const [markerKeyDraft, setMarkerKeyDraft] = useState("M");
  const [capturingMarkerKey, setCapturingMarkerKey] = useState(false);
  const [compareReference, setCompareReference] = useState(false);
  const [comparedTile, setComparedTile] = useState<Tile>();
  const [savingFeatures, setSavingFeatures] = useState(false);
  const [settingsError, setSettingsError] = useState("");

  useEffect(() => {
    if (!savingFeatures || !featureDraft) return;
    if (state.features.trays === featureDraft.trays) {
      vm.setMarkerPreferences(markerDurationDraft, markerShortcutDraft, markerKeyDraft);
      setSavingFeatures(false);
      settingsDialog.current?.close();
      return;
    }
    const timer = window.setTimeout(() => {
      setSavingFeatures(false);
      setSettingsError("Кімната не підтвердила зміни. Перевірте з’єднання або перезапустіть гру через Start.cmd.");
    }, 3500);
    return () => window.clearTimeout(timer);
  }, [featureDraft, markerDurationDraft, markerShortcutDraft, markerKeyDraft, savingFeatures, state.features, vm]);

  function openSettings() {
    setFeatureDraft({ ...state.features });
    setMarkerDurationDraft(state.markerDuration);
    setMarkerShortcutDraft(state.markerShortcut);
    setMarkerKeyDraft(state.markerKey);
    setCapturingMarkerKey(false);
    setSavingFeatures(false);
    setSettingsError("");
    settingsDialog.current?.querySelector("details")?.removeAttribute("open");
    settingsDialog.current?.showModal();
  }
  const renameTrayDialog = useRef<HTMLDialogElement>(null);
  const [trayRename, setTrayRename] = useState<{ id: PuzzleTray; name: string; error: boolean } | null>(null);
  const [trayToDelete, setTrayToDelete] = useState<PuzzleTray | null>(null);
  const [dropTarget, setDropTarget] = useState<PuzzleTray | null | undefined>(undefined);
  const [touchControls] = useState(() => window.matchMedia("(any-pointer: coarse)").matches);
  const [controls, setControls] = useState<BoardControls>({ cameraLocked: false, clickToCarry: !touchControls });
  const currentControls = useRef(controls);

  function toggleControl(control: keyof BoardControls) {
    const next = { ...currentControls.current, [control]: !currentControls.current[control] };
    currentControls.current = next;
    setControls(next);
    renderer.current?.setControls(next);
    boardMenu.current?.hidePopover();
  }

  function openBoardMenu(x: number, y: number) {
    const menu = boardMenu.current;
    if (!menu) return;
    if (!menu.matches(":popover-open")) menu.showPopover();
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
    menu.querySelector("button")?.focus({ preventScroll: true });
  }
  const [pointing, setPointing] = useState(false);
  const [renderError,setRenderError]=useState("");
  const [qrOpen, setQrOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(() => !window.matchMedia("(max-width: 900px), (pointer: coarse)").matches);
  const [extrasMode, setExtrasMode] = useState<"open" | "collapsed" | "closed">("open");
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
  const [pendingKick, setPendingKick] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setFullscreen(document.fullscreenElement !== null && document.fullscreenElement === shell.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  useEffect(() => renderer.current?.refreshPalette(), [theme.dark]);
  useEffect(() => {
    renderer.current?.setReferenceComparison(compareReference && state.showReference ? setComparedTile : undefined);
    setComparedTile(undefined);
  }, [compareReference, state.showReference]);
  const comparisonActive = useRef(false);
  comparisonActive.current = compareReference && state.showReference;
  useEffect(() => {
    const marker = state.marker;
    renderer.current?.showMarker(marker && marker.tray === state.trayView ? marker : null,
      marker?.local ? LOCAL_MARKER_DURATION : marker?.duration);
  }, [state.marker, state.trayView]);
  useEffect(() => {
    const marker = state.marker;
    if (!marker) return;
    const timer = window.setTimeout(() => vm.clearMarker(marker),
      marker.local ? LOCAL_MARKER_DURATION : marker.duration ?? BOARD_MARKER_DURATION);
    return () => window.clearTimeout(timer);
  }, [state.marker, vm]);
  async function toggleFullscreen() {
    const element = shell.current;
    if (!element) return;
    setFullscreenError("");
    try {
      if (document.fullscreenElement === element) await document.exitFullscreen();
      else await element.requestFullscreen();
    } catch {
      setFullscreenError("Браузер не дозволив повноекранний режим. Спробуйте F11.");
    }
  }
  useEffect(()=>{
    if(state.screen!=="game"||!host.current)return;
    let cancelled=false;
    setDropTarget(undefined);
    const element=host.current;
    const preferences = vm.cameraPreferences();
    void import("../rendering/PuzzleRenderer").then(module=>module.createPuzzleRenderer(element,vm,trayAtPointer,setDropTarget,preferences)).then(result=>{
      if(cancelled)result.dispose();
      else {
        renderer.current=result;
        result.setControls(currentControls.current);
        result.refreshPalette();
        if (comparisonActive.current) result.setReferenceComparison(setComparedTile);
        const { marker, trayView } = vm.getSnapshot();
        result.showMarker(marker && marker.tray === trayView ? marker : null,
          marker?.local ? LOCAL_MARKER_DURATION : marker?.duration);
      }
    }).catch(()=>{if (!cancelled) setRenderError("Не вдалося відкрити поле. Перевірте підтримку WebGL у браузері.");});
    return()=>{cancelled=true;renderer.current?.dispose();renderer.current=null;};
  },[vm,state.screen,state.roomId]);
  if(state.screen!=="game")return <main className="game-message">
    <span className="brand">WebPuzzle</span><h1>{state.screen==="connecting"?"Відкриваємо стіл…":"Кімната недоступна"}</h1>
    <p role="status">{state.error??"Готуємо деталі та підключення"}</p>
    <div className="game-message-actions">
      {state.screen === "error" && state.roomId && <button type="button" className="button primary-button"
        onClick={() => void vm.join(state.roomId)}>Спробувати ще раз</button>}
      <button type="button" className="button secondary-button" onClick={()=>void vm.leave()}>На головну</button>
    </div>
  </main>;
  const canScanInvite = !!state.shareUrl && !/^https?:\/\/(?:localhost|127\.|\[::1\])/i.test(state.shareUrl);
  const freeSeats = Math.max(0, MAX_ROOM_PLAYERS - state.players.length);
  const percent=Math.round(state.placed/state.pieceCount*100);
  const trays = [{ id: null, label: "Стіл" },
    ...state.trays.map((id, index) => ({ id, label: state.trayNames[id] ?? `Лоток ${index + 1}` }))];
  const canPoint = state.connected && state.players.some(player => player.id !== state.selfId && player.connected);
  const trayLimitReached = state.trays.length >= MAX_PUZZLE_TRAYS;
  const activeTrayLabel = trays.find(tray => tray.id === state.trayView)?.label ?? "Стіл";
  const deleteTarget = trayToDelete && trays.find(tray => tray.id === trayToDelete);
  const isHost = state.players.some(player => player.id === state.selfId && player.isHost);
  const panelLabel = panelOpen ? "Сховати панель кімнати" : "Показати панель кімнати";
  const fullscreenLabel = fullscreen ? "Вийти з повноекранного режиму" : "На весь екран";
  const imageName = state.imageId === DEFAULT_IMAGE_ID ? "Тиха затока" : "Власне фото";
  return <div className="game-shell" ref={shell}>
    <header className="game-header">
      <button className="button quiet-button" onClick={()=>void vm.leave()} aria-label="Вийти з кімнати">← На головну</button>
      <span className="game-title">{imageName} <span>{state.pieceCount} {pieceNoun(state.pieceCount)}</span></span>
      <div className="header-actions">
        <span className="connection game-connection" role="status"><span className={state.connected?"status-dot online-dot":"status-dot"}/>{state.connected?"На зв’язку":"Відновлюємо зв’язок…"}</span>
        <ThemeToggle {...theme}/>
        <button type="button" className="button quiet-button view-control" aria-label={panelLabel} title={panelLabel}
          aria-controls="room-panel" aria-expanded={panelOpen} onClick={() => setPanelOpen(open => !open)}>
          <Icon name={panelOpen ? "sidebarClose" : "sidebarOpen"}/>
        </button>
        <button type="button" className="button quiet-button view-control" aria-label={fullscreenLabel} title={fullscreenLabel}
          onClick={() => void toggleFullscreen()}>
          <Icon name={fullscreen ? "minimize" : "maximize"}/>
        </button>
      </div>
    </header>
    <div className="game-content">
      <section className="board-section" aria-label="Стіл для пазлів">
        <div className="board-host" ref={host} onContextMenu={event => {
          event.preventDefault();
          openBoardMenu(event.clientX, event.clientY);
        }}/>
        <div className="board-menu" ref={boardMenu} popover="auto" role="group" aria-label="Керування столом"
          onKeyDown={event => { if (event.key === "Escape") event.stopPropagation(); }}>
          {!touchControls && <button type="button" className="board-menu-toggle" aria-pressed={controls.clickToCarry}
            onClick={() => toggleControl("clickToCarry")}>
            Перенесення кліками
            {controls.clickToCarry && <Icon name="check"/>}
          </button>}
          <button type="button" onClick={() => toggleControl("cameraLocked")}>
            {controls.cameraLocked ? "Розблокувати вид" : "Зафіксувати вид"}
          </button>
          <button type="button" onClick={() => {
            boardMenu.current?.hidePopover();
            if (!canPoint) return vm.showBoardNotice(state.connected
              ? "Запроси напарника, щоб показувати йому місця на столі"
              : "Зачекай, поки відновиться зв’язок із кімнатою");
            if (!renderer.current) return vm.showBoardNotice("Зачекай, поки відкриється поле");
            if (pointing || renderer.current.armMarker(() => setPointing(false))) setPointing(true);
            else vm.showBoardNotice("Спочатку відпусти деталь або заверши рух столу");
          }}>Дивись сюди</button>
          {state.features.trays && extrasMode === "closed" && <button type="button" onClick={() => {
            setExtrasMode("open");
            boardMenu.current?.hidePopover();
            boardMenuButton.current?.focus();
          }}>Показати панель лотків</button>}
        </div>
        {state.features.trays && extrasMode !== "closed" && <div className="tray-toolbar">
          <div id="board-extras" hidden={extrasMode !== "open"} role="group" aria-label="Лотки для деталей"
            aria-describedby={state.features.trays ? "tray-hint" : undefined}>
            <div className="tray-tabs">
                {state.features.trays && trays.map(tray => <button key={tray.id ?? "table"} type="button" data-puzzle-tray={tray.id ?? "table"}
                  title={tray.id === null ? "Перетягніть сюди деталь, щоб повернути її на стіл" : "Перетягніть сюди деталь або натисніть, щоб відкрити лоток"}
                  aria-pressed={state.trayView === tray.id} data-drop-target={dropTarget === tray.id ? "true" : undefined}
                  onClick={() => {
                    if (!renderer.current?.dropOnTray(tray.id)) vm.showTray(tray.id);
                  }}>{tray.label}</button>)}
              </div>
              {state.features.trays && <>
              <div className="tray-actions">
                <button type="button" disabled={!state.connected || trayLimitReached} onClick={vm.createTray}>+ Додати лоток</button>
                {state.trayView && <button type="button" disabled={!state.connected} aria-haspopup="dialog"
                  onClick={() => {
                    if (!state.trayView) return;
                    setTrayRename({ id: state.trayView, name: activeTrayLabel, error: false });
                    renameTrayDialog.current?.showModal();
                  }}>Перейменувати</button>}
                {state.trayView && <button type="button" className="tray-delete" disabled={!state.connected} aria-haspopup="dialog"
                  onClick={() => {
                    setTrayToDelete(state.trayView);
                    deleteTrayDialog.current?.showModal();
                  }}>Видалити лоток</button>}
              </div>
              <p id="tray-hint" className="tray-hint" role="status">
                {trayLimitReached ? `Лотки: ${MAX_PUZZLE_TRAYS} з ${MAX_PUZZLE_TRAYS} · Перетягніть деталь на лоток`
                  : state.trays.length
                    ? (controls.clickToCarry ? "Візьміть деталь і натисніть на потрібний лоток" : "Відпустіть деталь над потрібним лотком")
                    : "Додайте лоток, щоб відкласти деталі"}
              </p>
              </>}
          </div>
          <div className="board-extras-actions">
            <button type="button" className="button board-extras-toggle" aria-controls="board-extras"
              aria-expanded={extrasMode === "open"}
              onClick={() => setExtrasMode(mode => mode === "open" ? "collapsed" : "open")}>
              {extrasMode === "open" ? "Згорнути" : "Показати панель"}
              <Icon name={extrasMode === "open" ? "chevronUp" : "chevronDown"}/>
            </button>
            <button type="button" className="button board-extras-close" aria-label="Закрити панель"
              title="Закрити панель" onClick={() => {
                setExtrasMode("closed");
                boardMenuButton.current?.focus();
              }}>
              <Icon name="close"/>
            </button>
          </div>
        </div>}
        {renderError&&<p role="alert" className="board-error">{renderError}</p>}
        {fullscreenError&&<div role="status" className="fullscreen-notice">
          {fullscreenError}<button type="button" className="button quiet-button" onClick={() => setFullscreenError("")}>Закрити</button>
        </div>}
        <div className="board-toolbar" role="group" aria-label="Масштаб і вигляд">
          <button disabled={controls.cameraLocked} onClick={()=>renderer.current?.zoom(.8)} aria-label="Віддалити">−</button>
          <button disabled={controls.cameraLocked} onClick={()=>renderer.current?.fit()}>Увесь стіл</button>
          <button disabled={controls.cameraLocked} onClick={()=>renderer.current?.zoom(1.25)} aria-label="Наблизити">+</button>
          <button ref={boardMenuButton} type="button" aria-haspopup="true" aria-label="Керування столом" title="Керування столом"
            onClick={event => {
              const rect = event.currentTarget.getBoundingClientRect();
              openBoardMenu(rect.left, rect.bottom + 4);
            }}>⋯</button>
          <button type="button" className="board-settings-button" aria-haspopup="dialog"
            aria-label="Налаштування пазла" title="Налаштування пазла" onClick={openSettings}>
            <Icon name="settings"/>
          </button>
        </div>
        {state.showReference && <PuzzleReference src={puzzleImageUrl(state.imageId)} name={imageName}
          comparedTile={compareReference ? comparedTile : undefined} onClose={vm.toggleReference}/>}
        {(pointing || (state.marker && !state.marker.local) || state.boardNotice) && <div className="board-feedback">
          {pointing && <p role="status">Клацни по плитці або по столу, щоб показати місце напарнику</p>}
          {state.marker && !state.marker.local && <div className="board-marker-notice">
            <span className="board-marker-label" role="status"><Icon name="mapPin"/> Гравець позначив місце</span>
            <button type="button" className="button quiet-button" disabled={controls.cameraLocked}
              onClick={() => {
                const marker = state.marker;
                if (!marker) return;
                if (marker.tray !== null && (!state.features.trays || !state.trays.includes(marker.tray))) return;
                vm.showTray(marker.tray);
                renderer.current?.centerOnMarker(marker);
              }}>Показати</button>
          </div>}
          {state.boardNotice && !pointing && <p role="status">{state.boardNotice}</p>}
        </div>}
        {state.placed===state.pieceCount&&<div className="completion" role="status">Картина готова <span>Зібрано: {state.pieceCount} {pieceNoun(state.pieceCount)}</span></div>}
        <dialog ref={settingsDialog} className="delete-puzzle-dialog" aria-labelledby="puzzle-settings-title"
          onCancel={event => { if (savingFeatures) event.preventDefault(); }}>
          <h2 id="puzzle-settings-title">Налаштування пазла</h2>
          {featureDraft && <form onSubmit={event => {
            event.preventDefault();
            if (!isHost || (state.features.trays === featureDraft.trays)) {
              vm.setMarkerPreferences(markerDurationDraft, markerShortcutDraft, markerKeyDraft);
              settingsDialog.current?.close();
              return;
            }
            setSettingsError("");
            setSavingFeatures(true);
            vm.configureFeatures(featureDraft);
          }}>
            {isHost && <>
              <fieldset className="puzzle-settings-fields" disabled={!state.connected || savingFeatures}>
                <legend>Додаткові функції</legend>
                <PuzzleFeatureFields features={featureDraft} onChange={setFeatureDraft}/>
              </fieldset>
              {state.features.trays && !featureDraft.trays && <p>Деталі з лотків повернуться на стіл. Назви лотків збережуться.</p>}
              {settingsError && <p className="puzzle-settings-error" role="alert">{settingsError}</p>}
            </>}
            <div className="marker-settings">
              <div className="marker-duration">
                <span id="marker-duration-label">Час показу мітки іншим гравцям</span>
                <div className="marker-duration-options" role="group" aria-labelledby="marker-duration-label">
                  {([BOARD_MARKER_DURATION, 10000] as const).map(duration =>
                    <button key={duration} type="button" aria-pressed={markerDurationDraft === duration}
                      disabled={savingFeatures} onClick={() => setMarkerDurationDraft(duration)}>
                      {duration / 1000} с
                    </button>)}
                </div>
              </div>
              {!touchControls && <><label className="puzzle-feature">
                Мітка з клавіатури
                <input type="checkbox" role="switch" checked={markerShortcutDraft} disabled={savingFeatures}
                  onChange={event => setMarkerShortcutDraft(event.target.checked)}/>
              </label>
              {markerShortcutDraft && <div className="marker-key-setting">
                <span aria-live="polite">{capturingMarkerKey ? "Натисни літеру на клавіатурі" : "Клавіша мітки"}</span>
                <button type="button" className="button secondary-button marker-key" disabled={savingFeatures}
                  aria-label={capturingMarkerKey ? "Натисни літеру на клавіатурі" : `Змінити клавішу мітки. Поточна: ${markerKeyDraft}`}
                  onClick={() => setCapturingMarkerKey(value => !value)} onBlur={() => setCapturingMarkerKey(false)}
                  onKeyDown={event => {
                    if (!capturingMarkerKey || event.key === "Tab") return;
                    event.preventDefault();
                    event.stopPropagation();
                    if (event.key === "Escape") {
                      setCapturingMarkerKey(false);
                    } else if (!event.ctrlKey && !event.altKey && !event.metaKey && /^\p{L}$/u.test(event.key.toUpperCase())) {
                      setMarkerKeyDraft(event.key.toUpperCase());
                      setCapturingMarkerKey(false);
                    }
                  }}><kbd>{capturingMarkerKey ? "…" : markerKeyDraft}</kbd></button>
              </div>}</>}
            </div>
            <details className="puzzle-cheats">
              <summary>Чіти <Icon name="chevronDown"/></summary>
              <div className="puzzle-cheats-body">
                <label className="puzzle-feature">
                  Фільтр «Лише краї»
                  <input type="checkbox" role="switch" checked={state.edgesOnly} disabled={savingFeatures}
                    onChange={() => {
                      vm.toggleEdges();
                      settingsDialog.current?.close();
                    }}/>
                </label>
                <label className="puzzle-feature">
                  Порівняти зі зразком
                  <input type="checkbox" role="switch" checked={compareReference} disabled={savingFeatures}
                    onChange={event => {
                      const enabled = event.target.checked;
                      setCompareReference(enabled);
                      if (enabled && !state.showReference) vm.toggleReference();
                      settingsDialog.current?.close();
                    }}/>
                </label>
                <div className="puzzle-cheats-arrange">
                  <span id="arrange-area">Ділянка: {activeTrayLabel}</span>
                  <div className="puzzle-cheats-actions">
                    <button type="button" className="button secondary-button" disabled={!state.connected || savingFeatures}
                      aria-describedby="arrange-area" onClick={() => {
                        settingsDialog.current?.close();
                        vm.arrangePieces();
                      }}>Розкласти вільні деталі</button>
                    <button type="button" className="button secondary-button" disabled={!state.connected || savingFeatures}
                      aria-describedby="arrange-area" onClick={() => {
                        settingsDialog.current?.close();
                        vm.undoArrange();
                      }}>Скасувати розкладання</button>
                  </div>
                </div>
              </div>
            </details>
            <div className="delete-puzzle-actions">
              <button type="button" className="button secondary-button" disabled={savingFeatures}
                onClick={() => settingsDialog.current?.close()}>Скасувати</button>
              <button type="submit" className="button primary-button" disabled={savingFeatures ||
                (isHost && !state.connected && state.features.trays !== featureDraft.trays)}>
                {savingFeatures ? "Застосовуємо…" : "Застосувати"}
              </button>
            </div>
          </form>}
        </dialog>
        <dialog ref={renameTrayDialog} className="delete-puzzle-dialog" aria-labelledby="rename-tray-title"
          onClose={() => setTrayRename(null)}>
          <h2 id="rename-tray-title">Перейменувати лоток</h2>
          {trayRename && <form className="rename-puzzle-form" onSubmit={event => {
            event.preventDefault();
            if (vm.renameTray(trayRename.id, trayRename.name)) renameTrayDialog.current?.close();
            else setTrayRename({ ...trayRename, error: true });
          }}>
            <label htmlFor="tray-name">Назва лотка</label>
            <input id="tray-name" value={trayRename.name} maxLength={MAX_TRAY_NAME_LENGTH} required
              aria-invalid={trayRename.error} aria-describedby={trayRename.error ? "tray-name-error" : undefined}
              onChange={event => setTrayRename({ ...trayRename, name: event.target.value, error: false })}/>
            {trayRename.error && <p id="tray-name-error" className="field-error" role="alert">Введіть назву й перевірте, чи лоток ще доступний.</p>}
            <div className="delete-puzzle-actions">
              <button type="button" className="button secondary-button" onClick={() => renameTrayDialog.current?.close()}>Скасувати</button>
              <button type="submit" className="button primary-button" disabled={!state.connected || !state.features.trays || !state.trays.includes(trayRename.id)}>Зберегти назву</button>
            </div>
          </form>}
        </dialog>
        <dialog ref={deleteTrayDialog} className="delete-puzzle-dialog" aria-labelledby="delete-tray-title"
          aria-describedby="delete-tray-description" onClose={() => setTrayToDelete(null)}>
          <h2 id="delete-tray-title">{deleteTarget ? `Видалити «${deleteTarget.label}»?` : "Лоток уже видалено"}</h2>
          <p id="delete-tray-description">{deleteTarget ? "Усі деталі з лотка повернуться на стіл." : "Деталі з цього лотка вже на столі."}</p>
          <div className="delete-puzzle-actions">
            <button type="button" className="button secondary-button" onClick={() => deleteTrayDialog.current?.close()}>
              {deleteTarget ? "Скасувати" : "Закрити"}
            </button>
            {deleteTarget && trayToDelete && <button type="button" className="button primary-button delete-puzzle-confirm"
              disabled={!state.connected} onClick={() => {
                vm.deleteTray(trayToDelete);
                deleteTrayDialog.current?.close();
              }}>Видалити</button>}
          </div>
        </dialog>
      </section>
      <aside className="game-sidebar" id="room-panel" aria-label="Панель кімнати" hidden={!panelOpen}>
        <div><p className="panel-label">Ваша кімната · {state.players.length}/{MAX_ROOM_PLAYERS}</p><h2>Збираємо разом</h2><p className="sidebar-copy">{freeSeats ? "Запросіть друзів за посиланням або QR-кодом." : "Ви за одним столом. Кожен може брати вільні деталі."}</p></div>
        <div className="players-list">
          {state.players.map(player => <div key={player.id}>
            <div className="player-row">
              <span className="player-avatar"><Icon name="people"/></span>
              <span className="player-details">{player.name}{player.id===state.selfId?" · ви":""}
                <small>{player.isHost ? "Власник · " : ""}{player.connected ? "На місці" : "Перепідключається"}</small>
              </span>
              {isHost && player.id !== state.selfId && pendingKick !== player.id &&
                <button type="button" className="button quiet-button kick-button" disabled={!state.connected}
                  aria-label={`Видалити ${player.name.toLowerCase()} з кімнати`} onClick={() => setPendingKick(player.id)}>Видалити</button>}
            </div>
            {isHost && pendingKick === player.id && <div className="kick-confirm">
              <p>Видалити гравця з кімнати?</p>
              <div>
                <button type="button" className="button quiet-button" onClick={() => setPendingKick(null)}>Скасувати</button>
                <button type="button" className="button secondary-button kick-button" disabled={!state.connected}
                  onClick={() => { vm.kickPlayer(player.id); setPendingKick(null); }}>Підтвердити</button>
              </div>
            </div>}
          </div>)}
          {freeSeats > 0 && <div className="player-row empty-seat">
            {freeSeats === 1 ? "Вільне місце" : `Вільних місць: ${freeSeats}`}
          </div>}
        </div>
        <label className="panel-label" htmlFor="invite-url">Посилання для гравців</label>
        <input id="invite-url" className="invite-input" readOnly value={state.shareUrl} placeholder="Визначаємо локальну адресу…" onFocus={event=>event.currentTarget.select()}/>
        <button className="button primary-button" onClick={()=>void vm.copyInvite()}>{state.inviteCopied?"Посилання скопійовано":"Копіювати посилання"}</button>
        {canScanInvite && <details className="room-qr" open={qrOpen} onToggle={event => setQrOpen(event.currentTarget.open)}>
          <summary>QR-код запрошення <Icon name="chevronDown"/></summary>
          {qrOpen && <div className="room-qr-body">
            <QRCodeCanvas value={state.shareUrl} size={176} marginSize={4} level="M"
              role="img" aria-label="QR-код для входу в кімнату"/>
            <p>Скануйте камерою телефона в тій самій мережі Wi-Fi.</p>
          </div>}
        </details>}
        <div className="progress-panel"><div><span>На своїх місцях</span><span>{percent}%</span></div><progress max={state.pieceCount} value={state.placed}/><small>{state.placed} / {state.pieceCount}</small></div>
        <button className="button secondary-button" onClick={() => {
          vm.toggleReference();
          if (!state.showReference && window.matchMedia("(max-width: 900px), (pointer: coarse)").matches) setPanelOpen(false);
        }}>{state.showReference?"Сховати зразок":"Показати зразок"}</button>
        <div className="instructions"><p>{touchControls ? "Торкніться деталі, перетягніть і відпустіть." : "Потягніть деталь до її сусіда або до місця в рамці"}</p><p>{controls.cameraLocked ? "Вид зафіксовано" : <>{touchControls ? "Два пальці — масштаб" : "Коліщатко — масштаб"}<br/>Порожній стіл — переміщення</>}</p>
          {!touchControls && controls.clickToCarry && <p>Клікніть деталь, щоб узяти, і ще раз, щоб покласти. Esc повертає її назад.</p>}</div>
        {state.error&&<p className="field-error" role="alert">{state.error}</p>}
      </aside>
    </div>
  </div>;
}
