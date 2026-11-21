import { useImperativeHandle, useRef, useState, type Ref } from "react";
import { FIELD_SIZES, BOARD_MARKER_DURATION, type BoardMarkerDuration, type FieldSize } from "@web-pazle/shared";
import { Icon } from "../../../shared/ui/Icon";
import type { PuzzleScreenState, PuzzleViewModel } from "../viewmodels/PuzzleViewModel";

export interface PuzzleSettingsHandle { open(): void }

interface PuzzleSettingsProps {
  ref: Ref<PuzzleSettingsHandle>;
  vm: PuzzleViewModel;
  state: PuzzleScreenState;
  touchControls: boolean;
  isHost: boolean;
  compareReference: boolean;
  setCompareReference(enabled: boolean): void;
}

export function PuzzleSettingsDialog({
  ref, vm, state, touchControls, isHost, compareReference, setCompareReference,
}: PuzzleSettingsProps) {
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const [markerDurationDraft, setMarkerDurationDraft] = useState<BoardMarkerDuration>(BOARD_MARKER_DURATION);
  const [markerShortcutDraft, setMarkerShortcutDraft] = useState(false);
  const [markerKeyDraft, setMarkerKeyDraft] = useState("M");
  const [capturingMarkerKey, setCapturingMarkerKey] = useState(false);
  const [slideDraft,setSlideDraft] = useState(false);
  const [fieldDraft,setFieldDraft] = useState<FieldSize>(1);
  const [traysDraft,setTraysDraft] = useState(true);
  function openSettings() {
    setTraysDraft(state.traysEnabled);
    setFieldDraft(state.fieldSize);
    setSlideDraft(state.slideToEdge);
    setMarkerDurationDraft(state.markerDuration);
    setMarkerShortcutDraft(state.markerShortcut);
    setMarkerKeyDraft(state.markerKey);
    setCapturingMarkerKey(false);
    settingsDialog.current?.querySelector("details")?.removeAttribute("open");
    settingsDialog.current?.showModal();
  }
  useImperativeHandle(ref, () => ({ open: openSettings }));
  return <dialog ref={settingsDialog} className="delete-puzzle-dialog" aria-labelledby="puzzle-settings-title">
    <h2 id="puzzle-settings-title">Налаштування пазла</h2>
    <form onSubmit={event => {
      event.preventDefault();
      if (isHost && fieldDraft !== state.fieldSize) vm.resizeField(fieldDraft);
      vm.setSlideToEdge(slideDraft);
      vm.setTraysEnabled(traysDraft);
      vm.setMarkerPreferences(markerDurationDraft, markerShortcutDraft, markerKeyDraft);
      settingsDialog.current?.close();
    }}>
      <div className="marker-settings">
        <label className="puzzle-feature">
          Лотки для деталей
          <input type="checkbox" role="switch" checked={traysDraft} onChange={event => setTraysDraft(event.target.checked)}/>
        </label>
        <div className="marker-duration">
          <span id="field-margin">Простір навколо пазла</span>
          <div className="marker-duration-options" role="group" aria-labelledby="field-margin">
            {FIELD_SIZES.map(size => <button key={size} type="button" disabled={!isHost || !state.connected}
              aria-pressed={(isHost ? fieldDraft : state.fieldSize) === size}
              onClick={() => setFieldDraft(size)}>{String(size).replace(".",",")}×</button>)}
          </div>
        </div>
        <label className="puzzle-feature">
          Фізика деталей
          <input type="checkbox" role="switch" checked={slideDraft} onChange={event => setSlideDraft(event.target.checked)}/>
        </label>
        <div className="marker-duration">
          <span id="marker-duration-label">Час показу мітки іншим гравцям</span>
          <div className="marker-duration-options" role="group" aria-labelledby="marker-duration-label">
            {([BOARD_MARKER_DURATION, 10000] as const).map(duration =>
              <button key={duration} type="button" aria-pressed={markerDurationDraft === duration}
                onClick={() => setMarkerDurationDraft(duration)}>
                {duration / 1000} с
              </button>)}
          </div>
        </div>
        {!touchControls && <><label className="puzzle-feature">
          Мітка з клавіатури
          <input type="checkbox" role="switch" checked={markerShortcutDraft}
            onChange={event => setMarkerShortcutDraft(event.target.checked)}/>
        </label>
        {markerShortcutDraft && <div className="marker-key-setting">
          <span aria-live="polite">{capturingMarkerKey ? "Натисни літеру на клавіатурі" : "Клавіша мітки"}</span>
          <button type="button" className="button secondary-button marker-key"
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
            <input type="checkbox" role="switch" checked={state.edgesOnly}
              onChange={() => {
                vm.toggleEdges();
                settingsDialog.current?.close();
              }}/>
          </label>
          <label className="puzzle-feature">
            Порівняти зі зразком
            <input type="checkbox" role="switch" checked={compareReference}
              onChange={event => {
                const enabled = event.target.checked;
                setCompareReference(enabled);
                if (enabled && !state.showReference) vm.toggleReference();
                settingsDialog.current?.close();
              }}/>
          </label>
          <div className="puzzle-cheats-arrange">
            <div className="puzzle-cheats-actions">
              <button type="button" className="button secondary-button" disabled={!state.connected}
                onClick={() => {
                  settingsDialog.current?.close();
                  vm.arrangePieces();
                }}>Розкласти вільні деталі</button>
              <button type="button" className="button secondary-button" disabled={!state.connected}
                onClick={() => {
                  settingsDialog.current?.close();
                  vm.undoArrange();
                }}>Скасувати розкладання</button>
            </div>
          </div>
        </div>
      </details>
      <div className="delete-puzzle-actions">
        <button type="button" className="button secondary-button"
          onClick={() => settingsDialog.current?.close()}>Скасувати</button>
        <button type="submit" className="button primary-button">Застосувати</button>
      </div>
    </form>
  </dialog>;
}
