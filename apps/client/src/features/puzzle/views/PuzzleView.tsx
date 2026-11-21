import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DEFAULT_IMAGE_ID, BOARD_MARKER_DURATION, puzzleImageUrl, type Tile } from "@web-pazle/shared";
import type { PuzzleViewModel } from "../viewmodels/PuzzleViewModel";
import type { BoardControls, PuzzleRenderer } from "../rendering/PuzzleRenderer";
import { Icon } from "../../../shared/ui/Icon";
import { ThemeToggle, type ThemeControls } from "../../../shared/ui/ThemeToggle";
import { PuzzleReference } from "./PuzzleReference";
import { PuzzleRoomPanel } from "./PuzzleRoomPanel";
import { PuzzleSettingsDialog, type PuzzleSettingsHandle } from "./PuzzleSettingsDialog";
import { pieceNoun } from "../../../shared/format";

const LOCAL_MARKER_DURATION = 1400;

export function PuzzleView({viewModel:vm, ...theme}:{viewModel:PuzzleViewModel} & ThemeControls){
  const state=useSyncExternalStore(vm.subscribe,vm.getSnapshot);
  const host=useRef<HTMLDivElement>(null),renderer=useRef<PuzzleRenderer|null>(null);
  const shell = useRef<HTMLDivElement>(null);
  const boardMenu = useRef<HTMLDivElement>(null);
  const settingsDialog = useRef<PuzzleSettingsHandle>(null);
  const [compareReference, setCompareReference] = useState(false);
  const [comparedTile, setComparedTile] = useState<Tile>();

  const [touchControls] = useState(() => window.matchMedia("(any-pointer: coarse)").matches);
  const [controls, setControls] = useState<BoardControls>({ cameraLocked: false, clickToCarry: !touchControls });
  const currentControls = useRef(controls);
  const [trayMode, setTrayMode] = useState<"auto" | "open" | "closed">("auto");
  const [collecting, setCollecting] = useState(false);
  const [counts, setCounts] = useState({picked:0,stored:0});

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
  const [panelOpen, setPanelOpen] = useState(() => !window.matchMedia("(max-width: 900px), (pointer: coarse)").matches);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");
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
    renderer.current?.showMarker(marker,
      marker?.local ? LOCAL_MARKER_DURATION : marker?.duration);
  }, [state.marker]);
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
    setTrayMode("auto");
    setCollecting(false); setCounts({picked:0,stored:0});
    const element=host.current;
    const preferences = vm.cameraPreferences();
    void import("../rendering/PuzzleRenderer").then(module=>module.createPuzzleRenderer(element,vm,preferences,(picked,stored) => {
      if (!cancelled) setCounts(previous => previous.picked===picked && previous.stored===stored ? previous : {picked,stored});
    })).then(result=>{
      if(cancelled)result.dispose();
      else {
        renderer.current=result;
        result.setControls(currentControls.current);
        result.refreshPalette();
        if (comparisonActive.current) result.setReferenceComparison(setComparedTile);
        const { marker } = vm.getSnapshot();
        result.showMarker(marker,
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
  const canPoint = state.connected && state.players.some(player => player.id !== state.selfId && player.connected);
  const isHost = state.players.some(player => player.id === state.selfId && player.isHost);
  const panelLabel = panelOpen ? "Сховати панель кімнати" : "Показати панель кімнати";
  const fullscreenLabel = fullscreen ? "Вийти з повноекранного режиму" : "На весь екран";
  const imageName = state.imageId === DEFAULT_IMAGE_ID ? "Тиха затока" : "Власне фото";
  const trayOpen = trayMode === "open" || (trayMode === "auto" && (collecting || counts.picked > 0 || counts.stored > 0));
  function setCollectionMode(active: boolean) {
    renderer.current?.setCollectionMode(active);
    setCollecting(active);
    if (active) {
      vm.showTray(false);
      if (state.traysEnabled) setTrayMode("open");
    }
  }
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
          <button type="button" className="collection-menu-item" aria-pressed={collecting} onClick={() => {
            setCollectionMode(!collecting);
            boardMenu.current?.hidePopover();
          }}><span>Зібрати добірку</span>{collecting && <Icon name="check"/>}{!touchControls && <kbd>Shift</kbd>}</button>
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
        </div>
        {state.traysEnabled && <div className="collection-tools" data-tray-drop={!state.viewingTray ? "" : undefined} role="group" aria-label="Лотки для деталей">
          {trayOpen && <div className="collection-tabs" role="group" aria-label="Ділянка столу">
            <button type="button" className="button quiet-button" aria-pressed={!state.viewingTray}
              onClick={() => vm.showTray(false)}>Стіл</button>
            <button type="button" className="button quiet-button" aria-pressed={state.viewingTray}
              onClick={() => { setCollectionMode(false); vm.showTray(true); }}>Лоток{counts.stored ? ` (${counts.stored})` : ""}</button>
          </div>}
          <button type="button" className="button quiet-button collection-tray-toggle"
            aria-expanded={trayOpen} aria-controls="collection-tray"
            onClick={() => setTrayMode(trayOpen ? "closed" : "open")}>
            {trayOpen ? "Згорнути лоток" : counts.stored ? `Лоток (${counts.stored})` : "Лоток"}
            <Icon name={trayOpen ? "chevronUp" : "chevronDown"}/>
          </button>
          <span className="collection-drop-label" aria-hidden="true">Відпустіть у лоток</span>
          <div id="collection-tray" className="collection-tray-body" hidden={!trayOpen}>
            {state.viewingTray ? <>
              {counts.stored > 0 ? <button type="button" className="button quiet-button" disabled={!state.connected}
                onClick={() => { renderer.current?.restoreTray(); vm.showTray(false); }}>Повернути всі деталі на стіл</button>
                : <span>Лоток порожній</span>}
            </> : <>
            {(collecting || counts.picked > 0) && <span role="status">{counts.picked
              ? `Вибрано: ${counts.picked} · ${touchControls ? "Натисніть місце на столі" : "Перетягніть на стіл або в лоток"}`
              : touchControls ? "Натискайте деталі, щоб додати їх до добірки" : "Клацайте по деталях або тягніть рамку з вільного місця"}</span>}
            {counts.picked > 0 && <button type="button" className="button secondary-button" disabled={!state.connected}
              onClick={() => renderer.current?.storeSelected()}>У лоток</button>}
            {!collecting && counts.picked === 0 && <button type="button" className="button quiet-button" disabled={!state.connected}
                  onClick={() => setCollectionMode(true)}>Зібрати добірку</button>}
            </>}
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
          <button type="button" aria-haspopup="true" aria-label="Керування столом" title="Керування столом"
            onClick={event => {
              const rect = event.currentTarget.getBoundingClientRect();
              openBoardMenu(rect.left, rect.bottom + 4);
            }}>⋯</button>
          {state.canUndoCollection && <button type="button" disabled={!state.connected}
            aria-label="Скасувати переміщення добірки" title="Скасувати переміщення добірки"
            onClick={vm.undoCollection}><Icon name="undo"/></button>}
          <button type="button" className="board-settings-button" aria-haspopup="dialog"
            aria-label="Налаштування пазла" title="Налаштування пазла" onClick={() => settingsDialog.current?.open()}>
            <Icon name="settings"/>
          </button>
        </div>
        {state.showReference && <PuzzleReference src={puzzleImageUrl(state.imageId)} name={imageName}
          comparedTile={compareReference ? comparedTile : undefined} onClose={vm.toggleReference}/>}
        {(pointing || (state.marker && !state.marker.local) || state.boardNotice) && <div className="board-feedback">
          {pointing && <p role="status">{touchControls ? "Торкнись деталі або столу, щоб показати місце напарнику" : "Клацни по деталі або по столу, щоб показати місце напарнику"}</p>}
          {state.marker && !state.marker.local && <div className="board-marker-notice">
            <span className="board-marker-label" role="status"><Icon name="mapPin"/> Гравець позначив місце</span>
            <button type="button" className="button quiet-button" disabled={controls.cameraLocked}
              onClick={() => {
                const marker = state.marker;
                if (!marker) return;
                vm.showTray(false);
                renderer.current?.centerOnMarker(marker);
              }}>Показати</button>
          </div>}
          {state.boardNotice && !pointing && <p role="status">{state.boardNotice}</p>}
        </div>}
        {state.placed===state.pieceCount&&<div className="completion" role="status">Картина готова <span>Зібрано: {state.pieceCount} {pieceNoun(state.pieceCount)}</span></div>}
        <PuzzleSettingsDialog ref={settingsDialog} vm={vm} state={state} touchControls={touchControls}
          isHost={isHost} compareReference={compareReference} setCompareReference={setCompareReference}/>
      </section>
      <PuzzleRoomPanel vm={vm} state={state} panelOpen={panelOpen} closePanel={() => setPanelOpen(false)}
        touchControls={touchControls} controls={controls} isHost={isHost}/>
    </div>
  </div>;
}
