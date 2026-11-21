import { PuzzleEngine, DEFAULT_IMAGE_ID, TABLE_WIDTH, TABLE_HEIGHT } from '@web-pazle/shared';
import { createPuzzleRenderer } from '../src/features/puzzle/rendering/PuzzleRenderer.ts';

const host=document.querySelector('#board'),result=document.querySelector('#result');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
async function until(check,message){
  const deadline=performance.now()+8000;
  while(!check()){if(performance.now()>deadline)throw new Error(message);await delay(32);}
}
document.querySelector('#run').onclick=async()=>{
  document.querySelector('#run').disabled=true;
  result.textContent='Running…\n';
  let renderer,traffic;
  const descriptor=Object.getOwnPropertyDescriptor(window,'devicePixelRatio');
  try{
    for(const [count,density] of [[1,2],[997,1.25],[1000,1],[3000,1]]){
      Object.defineProperty(window,'devicePixelRatio',{configurable:true,value:density});
      const engine=new PuzzleEngine({id:'render-test',imageId:DEFAULT_IMAGE_ID,pieceCount:count,seed:42});
      // Put at least one piece at the center of the viewport for crop assertions.
      const tile=engine.tiles[0],group=engine.groups.get('0');
      group.dx=800-tile.x-tile.width/2;group.dy=500-tile.y-tile.height/2;
      let notify=()=>{}, viewingTray=false;
      const vm={
        board:{tiles:engine.tiles,groups:engine.groups,selfId:'test',imageId:DEFAULT_IMAGE_ID},
        getSnapshot:()=>({connected:true,viewingTray}),isGroupVisible:()=>true,
        onBoardChange:listener=>{notify=listener;return()=>{notify=()=>{};};},
        grab(){},move(){},release(){},cancelDrag(){},
      };
      const views = new Map();
      const preferences = { read: area => views.get(area), save: (area, view) => views.set(area, view) };
      renderer=await createPuzzleRenderer(host,vm,preferences);
      renderer.refreshPalette();
      const canvas=host.querySelector('canvas');
      await until(()=>Number(canvas.dataset.atlasResolution)>0,'Atlas did not render');
      assert(canvas.width===1000*density,'Canvas does not match display density');
      if (count === 1) {
        canvas.dispatchEvent(new WheelEvent("wheel", { clientX: 180, clientY: 150, deltaY: -450 }));
        // Switch before the save timer fires to catch writing the view under the wrong area.
        viewingTray=true; notify({kind:'visibility'});
        const tableView = views.get('table');
        canvas.dispatchEvent(new WheelEvent("wheel", { clientX: 750, clientY: 470, deltaY: -780 }));
        viewingTray=false; notify({kind:'visibility'});
        const trayView = views.get('tray');
        assert(tableView.scale !== trayView.scale,'The areas should have different zoom levels');
        assert(Math.abs(tableView.center.x-trayView.center.x)>1,'The areas should have different pan positions');
        await until(() => Number(canvas.dataset.zoom) === tableView.scale,'Table zoom was lost');
        assert(Math.abs(Number(canvas.dataset.cameraX)-(500-tableView.center.x*tableView.scale))<.001,'Table pan was lost');
        viewingTray=true; notify({kind:'visibility'});
        await until(() => Number(canvas.dataset.zoom) === trayView.scale,'Tray zoom was lost');
        assert(Math.abs(Number(canvas.dataset.cameraY)-(host.clientHeight/2-trayView.center.y*trayView.scale))<.001,'Tray pan was lost');
        viewingTray=false; notify({kind:'visibility'}); renderer.fit();
        const fit = Math.min((host.clientWidth-64)/TABLE_WIDTH, (host.clientHeight-64)/TABLE_HEIGHT);
        await until(() => Math.abs(Number(canvas.dataset.zoom)-fit)<.00001,'Table did not refit');
        result.textContent+='PASS separate table and tray cameras\n';
      }
      assert(Number(canvas.dataset.atlasResolution)>=Number(canvas.dataset.zoom)*density*2,'Distant atlas undersampled');
      assert(canvas.dataset.refinedPieces==='0','Distant pieces lost shared batching');
      // Updates every 16ms used to restart a 120ms debounce indefinitely.
      traffic=setInterval(()=>notify({kind:'motion',groupId:'0'}),16);
      renderer.zoom(100);
      await until(()=>Number(canvas.dataset.refinedPieces)>0,'Refinement starved during continuous motion');
      clearInterval(traffic);traffic=undefined;
      renderer.zoom(.8);await delay(150);renderer.fit();
      await until(()=>canvas.dataset.refinedPieces==='0','Zoom-out did not restore atlas batching');
      await delay(200);
      const frames=canvas.dataset.renderedFrames;await delay(200);
      assert(canvas.dataset.renderedFrames===frames,'Idle puzzle keeps rendering');
      // Assemble the same pieces to exercise shared group surfaces at high zoom.
      engine.groups.clear();engine.groups.set('assembled',{id:'assembled',pieces:engine.tiles.map(tile=>tile.id),dx:0,dy:0,owner:null,placed:true});
      notify({kind:'structure'});renderer.zoom(100);
      if(count>1)await until(()=>Number(canvas.dataset.groupSurfaces)===1,'Joined group did not refine');
      host.style.setProperty('--board-background','#efefe7');renderer.refreshPalette();
      await delay(100);
      assert(canvas.width===1000*density,'Theme switch altered pixel density');
      result.textContent+=`PASS ${count} pieces, simulated DPR ${density}: atlas, zoom, continuous motion, idle, joined group, theme\n`;
      renderer.dispose();renderer=undefined;
    }
    result.textContent+='PASS all rendering checks';
  }catch(error){result.textContent+=`FAIL ${error.stack}`;console.error(error);}
  finally{
    clearInterval(traffic);renderer?.dispose();
    if(descriptor)Object.defineProperty(window,'devicePixelRatio',descriptor);
    else delete window.devicePixelRatio;
    document.querySelector('#run').disabled=false;
  }
};
