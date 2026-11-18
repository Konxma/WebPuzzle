import { isPuzzleFileId } from "@web-pazle/shared";
import { useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";
import { LobbyView } from "../features/lobby/views/LobbyView";
import { LobbyViewModel } from "../features/lobby/viewmodels/LobbyViewModel";
import { HttpHealthGateway } from "../infrastructure/http/HttpHealthGateway";
import { copyInvite } from "../infrastructure/http/copyInvite";
import { ColyseusRoomGateway } from "../infrastructure/realtime/ColyseusRoomGateway";
import { PuzzleViewModel } from "../features/puzzle/viewmodels/PuzzleViewModel";
import { PuzzleView } from "../features/puzzle/views/PuzzleView";
import { BrowserSavedPuzzles } from "../infrastructure/http/BrowserSavedPuzzles";
import { PuzzlePhotos } from "../infrastructure/http/PuzzlePhotos";
import { BrowserPuzzleViewPreferences } from "../infrastructure/http/BrowserPuzzleViewPreferences";
const saves = new BrowserSavedPuzzles();
const puzzle=new PuzzleViewModel(new ColyseusRoomGateway(),copyInvite,saves,new BrowserPuzzleViewPreferences());
const launcherImage = document.querySelector<HTMLMetaElement>('meta[name="webpuzzle-launcher-image"]')?.content;
const lobby=new LobbyViewModel(new HttpHealthGateway(),{create:puzzle.create,join:puzzle.join,resume:puzzle.resume},new PuzzlePhotos(),saves,
  isPuzzleFileId(launcherImage) ? launcherImage : undefined);
let initialized=false;
const themeKey = "webpazle-theme";
export function App(){
  const state=useSyncExternalStore(puzzle.subscribe,puzzle.getSnapshot);
  useEffect(() => { if (state.screen === "lobby") lobby.refreshSaves(); }, [state.screen]);
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem(themeKey) === "dark"; }
    catch { return false; }
  });
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    try { localStorage.setItem(themeKey, dark ? "dark" : "light"); }
    catch { /* The theme still works when storage is blocked. */ }
  }, [dark]);
  useEffect(()=>{
    if(initialized)return;initialized=true;void lobby.checkConnection();
    const room=new URL(location.href).searchParams.get("room");if(room)void puzzle.join(room);
  },[]);
  useEffect(()=>{
    if(state.screen==="game"){const url=new URL(location.href);url.searchParams.set("room",state.roomId);history.replaceState(null,"",url);}
    else if(state.screen==="lobby" || (state.screen==="error" && !state.roomId)){const url=new URL(location.href);url.searchParams.delete("room");history.replaceState(null,"",url);}
  },[state.screen,state.roomId]);
  const theme = { dark, toggleTheme: () => setDark(value => !value) };
  return state.screen==="lobby"?<LobbyView viewModel={lobby} {...theme}/>:<PuzzleView viewModel={puzzle} {...theme}/>;
}
