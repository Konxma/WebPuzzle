import { QRCodeCanvas } from "qrcode.react";
import { useState } from "react";
import { MAX_ROOM_PLAYERS } from "@web-pazle/shared";
import { Icon } from "../../../shared/ui/Icon";
import type { BoardControls } from "../rendering/PuzzleRenderer";
import type { PuzzleScreenState, PuzzleViewModel } from "../viewmodels/PuzzleViewModel";

interface PuzzleRoomPanelProps {
  vm: PuzzleViewModel;
  state: PuzzleScreenState;
  panelOpen: boolean;
  closePanel(): void;
  touchControls: boolean;
  controls: BoardControls;
  isHost: boolean;
}

export function PuzzleRoomPanel({
  vm, state, panelOpen, closePanel, touchControls, controls, isHost,
}: PuzzleRoomPanelProps) {
  const [qrOpen, setQrOpen] = useState(false);
  const [pendingKick, setPendingKick] = useState<string | null>(null);
  const canScanInvite = !!state.shareUrl && !/^https?:\/\/(?:localhost|127\.|\[::1\])/i.test(state.shareUrl);
  const freeSeats = Math.max(0, MAX_ROOM_PLAYERS - state.players.length);
  const percent=Math.round(state.placed/state.pieceCount*100);
  return <aside className="game-sidebar" id="room-panel" aria-label="Панель кімнати" hidden={!panelOpen}>
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
      if (!state.showReference && window.matchMedia("(max-width: 900px), (pointer: coarse)").matches) closePanel();
    }}>{state.showReference?"Сховати зразок":"Показати зразок"}</button>
    <div className="instructions"><p>{touchControls ? "Торкніться деталі, перетягніть і відпустіть." : "Потягніть деталь до її сусіда або до місця в рамці"}</p><p>{controls.cameraLocked ? "Вид зафіксовано" : <>{touchControls ? "Два пальці — масштаб" : "Коліщатко — масштаб"}<br/>Порожній стіл — переміщення</>}</p>
      {touchControls && <p>Три швидкі дотики одним пальцем у тому самому місці ставлять мітку.</p>}
      {!touchControls && controls.clickToCarry && <p>Клікніть деталь, щоб узяти, і ще раз, щоб покласти. Esc повертає її назад.</p>}</div>
    {state.error&&<p className="field-error" role="alert">{state.error}</p>}
  </aside>;
}
